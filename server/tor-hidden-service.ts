/**
 * server/tor-hidden-service.ts
 *
 * Opsiyonel Tor Hidden Service yönetimi.
 * TOR_ENABLED=true env var ile aktif olur.
 *
 * Öncelik sırası:
 *  1. ONION_ADDRESS env var set edilmişse Tor başlatılmaz, sadece o adres döndürülür.
 *  2. TOR_ENABLED=true ise bundled tor binary bulunur ve başlatılır.
 *  3. Hiçbiri yoksa devre dışı — normal HTTP modunda çalışır.
 */

import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";

const log = (msg: string) => console.log(`[Tor] ${msg}`);

let torProcess: ChildProcess | null = null;
let onionAddress: string | null = process.env.ONION_ADDRESS || null;

export function getOnionAddress(): string | null {
  return onionAddress;
}

// ── Bundled tor binary yolu ───────────────────────────────────────────
function getTorBinaryPath(): string | null {
  const exeName = process.platform === "win32" ? "tor.exe" : "tor";
  const arch = process.arch;

  function subdir(): string {
    if (process.platform === "darwin") {
      return arch === "arm64" ? "macos-arm64" : "macos-x64";
    }
    if (process.platform === "win32") return "windows";
    if (process.platform === "linux") {
      return arch === "arm64" ? "linux-arm64" : "linux-x64";
    }
    return "linux-x64";
  }

  // Proje kök dizininden bak
  const candidates = [
    path.resolve(process.cwd(), "tor-bin", subdir(), exeName),
    path.resolve(process.cwd(), "..", "tor-bin", subdir(), exeName),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // Sistem PATH'te tor var mı?
  return "tor"; // spawn hata verirse yakalanır
}

// ── Sistem tor portunu kontrol et ────────────────────────────────────
function isTorPortOpen(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.connect(9050, "127.0.0.1", () => { socket.destroy(); resolve(true); });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
  });
}

// ── torrc ve data dir oluştur ────────────────────────────────────────
function prepareTorConfig(hiddenServicePort: number): { torrcPath: string; dataDir: string } {
  const dataDir = path.join(os.tmpdir(), "ciphernode-tor");
  const hsDir = path.join(dataDir, "hidden_service");
  fs.mkdirSync(hsDir, { recursive: true });

  const torrcPath = path.join(dataDir, "torrc");
  const torrc = [
    `DataDirectory ${dataDir}`,
    `SocksPort 9050`,
    `ControlPort 9051`,
    `HiddenServiceDir ${hsDir}`,
    `HiddenServicePort 80 127.0.0.1:${hiddenServicePort}`,
    `Log notice stdout`,
  ].join("\n");

  fs.writeFileSync(torrcPath, torrc, "utf-8");
  return { torrcPath, dataDir };
}

// ── .onion adresini oku ───────────────────────────────────────────────
function readOnionAddress(dataDir: string): string | null {
  const hostnameFile = path.join(dataDir, "hidden_service", "hostname");
  if (fs.existsSync(hostnameFile)) {
    return fs.readFileSync(hostnameFile, "utf-8").trim();
  }
  return null;
}

// ── Tor bootstrap bekle ───────────────────────────────────────────────
function waitForBootstrap(proc: ChildProcess, timeoutMs = 90_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Tor bootstrap timeout")), timeoutMs);

    const check = (data: Buffer) => {
      const line = data.toString();
      if (line.includes("Bootstrapped 100%") || line.includes("Done")) {
        clearTimeout(timer);
        resolve();
      }
      if (line.includes("Problem bootstrapping")) {
        clearTimeout(timer);
        reject(new Error(`Bootstrap failed: ${line.trim()}`));
      }
    };

    proc.stdout?.on("data", check);
    proc.stderr?.on("data", check);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Tor exited with code ${code}`));
    });
  });
}

// ── Ana başlatma fonksiyonu ───────────────────────────────────────────
export async function startTorHiddenService(serverPort: number): Promise<string | null> {
  // Önceden ONION_ADDRESS set edilmişse Tor başlatma
  if (process.env.ONION_ADDRESS) {
    log(`ONION_ADDRESS env var mevcut: ${process.env.ONION_ADDRESS}`);
    onionAddress = process.env.ONION_ADDRESS;
    return onionAddress;
  }

  // TOR_ENABLED değilse çalıştırma
  if (process.env.TOR_ENABLED !== "true") {
    return null;
  }

  log("Tor Hidden Service başlatılıyor...");

  // Sistem Tor zaten çalışıyor mu?
  const systemTorRunning = await isTorPortOpen();
  if (systemTorRunning) {
    log("Sistem Tor zaten çalışıyor (port 9050 açık).");
  }

  const { torrcPath, dataDir } = prepareTorConfig(serverPort);
  const torBin = getTorBinaryPath();

  log(`Tor binary: ${torBin}`);
  log(`Data dir: ${dataDir}`);

  try {
    torProcess = spawn(torBin, ["-f", torrcPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    torProcess.on("error", (err) => {
      log(`Tor başlatılamadı: ${err.message}`);
      torProcess = null;
    });

    torProcess.on("exit", (code) => {
      log(`Tor kapandı (kod: ${code})`);
      torProcess = null;
    });

    log("Bootstrap bekleniyor (maks 90 saniye)...");
    await waitForBootstrap(torProcess);
    log("Bootstrap tamamlandı!");

    // .onion adresini oku
    onionAddress = readOnionAddress(dataDir);
    if (onionAddress) {
      log(`Onion adresi: ${onionAddress}`);
    } else {
      log("UYARI: .onion adresi okunamadı, birkaç saniye sonra tekrar denenecek.");
      // Tor bazen dosyayı bootstrap sonrası yazar, 3 saniye bekle
      await new Promise((r) => setTimeout(r, 3000));
      onionAddress = readOnionAddress(dataDir);
      if (onionAddress) log(`Onion adresi (gecikme sonrası): ${onionAddress}`);
    }

    return onionAddress;
  } catch (err: any) {
    log(`Tor başlatma hatası: ${err.message}`);
    torProcess?.kill();
    torProcess = null;
    return null;
  }
}

export function stopTor() {
  if (torProcess) {
    torProcess.kill();
    torProcess = null;
    log("Tor durduruldu.");
  }
}
