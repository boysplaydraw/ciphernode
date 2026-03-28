/**
 * tor-manager.ts — Electron ana sürecinde Tor yönetimi
 *
 * Çalışma mantığı:
 * 1. Sistemde zaten Tor çalışıyor mu? (127.0.0.1:9050 kontrol)
 * 2. Çalışmıyorsa bundled Tor binary'sini başlat
 * 3. Bootstrap %100 tamamlanana kadar bekle
 * 4. Hazır olduğunda session.setProxy() ile tüm trafiği Tor'dan geçir
 */

import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as net from "node:net";
import * as https from "node:https";
import * as http from "node:http";
import { app } from "electron";

const TOR_SOCKS_PORT = 9050;
const TOR_CONTROL_PORT = 9051;
const BOOTSTRAP_TIMEOUT_MS = 90_000;

let torProcess: ChildProcess | null = null;
let bootstrapProgress = 0;

// ── Durum bildirimi için callback ─────────────────────────────────────
type StatusCallback = (status: {
  stage: "checking" | "downloading" | "starting" | "bootstrapping" | "ready" | "error" | "stopped";
  progress?: number;
  message?: string;
}) => void;

let statusCallback: StatusCallback | null = null;

export function onTorStatus(cb: StatusCallback) {
  statusCallback = cb;
}

function emit(stage: Parameters<StatusCallback>[0]["stage"], progress?: number, message?: string) {
  statusCallback?.({ stage, progress, message });
}

// ── Sistem Tor kontrolü ───────────────────────────────────────────────
export function isTorPortOpen(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.connect(TOR_SOCKS_PORT, "127.0.0.1", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

// ── Bundled Tor binary yolu ───────────────────────────────────────────
function getTorBinaryPath(): string | null {
  const exeName = process.platform === "win32" ? "tor.exe" : "tor";
  const arch = process.arch; // "x64" | "arm64" | ...

  // Platform + mimari kombinasyonuna göre tor-bin alt klasörü
  function torBinSubdir(): string {
    if (process.platform === "darwin") {
      return arch === "arm64" ? "macos-arm64" : "macos-x64";
    }
    if (process.platform === "win32") {
      return "windows";
    }
    // Linux: x64 veya arm64
    return arch === "arm64" ? "linux-arm64" : "linux-x64";
  }
  const subdir = torBinSubdir();

  // 1. Geliştirme: electron/dist/../../../tor-bin/ (proje kökü)
  const appPath = app.getAppPath();
  const devRoot = path.resolve(appPath, "..", "..", "..");  // electron/dist → proje kökü

  const devCandidates: string[] = [];
  devCandidates.push(path.join(devRoot, "tor-bin", subdir, exeName));

  // macOS / Linux fallback: eski "macos" veya "linux" klasörü
  if (process.platform === "darwin") {
    devCandidates.push(path.join(devRoot, "tor-bin", "macos", "tor"));
  } else if (process.platform !== "win32") {
    devCandidates.push(path.join(devRoot, "tor-bin", "linux", "tor"));
  }

  // 2. Üretim: exe yanında resources/tor-bin/
  const prodBase = process.platform === "darwin"
    ? path.join(path.dirname(app.getPath("exe")), "..", "Resources", "tor-bin")
    : path.join(path.dirname(app.getPath("exe")), "resources", "tor-bin");

  const prodCandidates: string[] = [];
  prodCandidates.push(path.join(prodBase, exeName));

  // Tüm adayları dene (geliştirme → üretim sırasıyla)
  for (const candidate of [...devCandidates, ...prodCandidates]) {
    if (fs.existsSync(candidate)) return candidate;
  }

  // 3. Sistem PATH'inde tor var mı?
  const systemTor = process.platform === "win32" ? "tor.exe" : "tor";
  try {
    const { execSync } = require("node:child_process");
    execSync(`which ${systemTor} 2>/dev/null || where ${systemTor} 2>nul`, { stdio: "ignore" });
    return systemTor; // PATH'de bulundu
  } catch {
    return null;
  }
}

// ── Tor indir ─────────────────────────────────────────────────────────
export async function downloadTor(): Promise<void> {
  const platform = process.platform;

  // Tor Expert Bundle indirme URL'leri (torproject.org CDN)
  const URLS: Record<string, string> = {
    win32: "https://archive.torproject.org/tor-package-archive/torbrowser/13.5.1/tor-expert-bundle-windows-x86_64-13.5.1.tar.gz",
    darwin: "https://archive.torproject.org/tor-package-archive/torbrowser/13.5.1/tor-expert-bundle-macos-aarch64-13.5.1.tar.gz",
    linux:  "https://archive.torproject.org/tor-package-archive/torbrowser/13.5.1/tor-expert-bundle-linux-x86_64-13.5.1.tar.gz",
  };

  const url = URLS[platform];
  if (!url) throw new Error(`Unsupported platform: ${platform}`);

  const torBinDir = path.join(app.getPath("userData"), "tor-bin");
  fs.mkdirSync(torBinDir, { recursive: true });

  const tarPath = path.join(torBinDir, "tor-bundle.tar.gz");

  emit("downloading", 0, "Tor indiriliyor...");

  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(tarPath);
    const request = (url.startsWith("https") ? https : http).get(url, (response) => {
      const total = parseInt(response.headers["content-length"] || "0", 10);
      let downloaded = 0;

      response.on("data", (chunk: Buffer) => {
        downloaded += chunk.length;
        if (total > 0) {
          emit("downloading", Math.round((downloaded / total) * 100), "Tor indiriliyor...");
        }
      });

      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    });
    request.on("error", reject);
  });

  // Arşivi çıkar
  emit("starting", undefined, "Tor kuruluyor...");
  const { execSync } = require("node:child_process");
  execSync(`tar -xzf "${tarPath}" -C "${torBinDir}"`);
  fs.unlinkSync(tarPath);

  // Binary'yi yürütülebilir yap (Linux/macOS)
  if (platform !== "win32") {
    const torExe = path.join(torBinDir, "tor", "tor");
    if (fs.existsSync(torExe)) {
      fs.chmodSync(torExe, 0o755);
    }
  }
}

// ── Tor başlat ────────────────────────────────────────────────────────
export async function startTor(): Promise<void> {
  emit("checking", undefined, "Tor kontrol ediliyor...");

  // Zaten çalışıyor mu?
  if (await isTorPortOpen()) {
    emit("ready", 100, "Sistem Tor'u aktif");
    return;
  }

  let torBin = getTorBinaryPath();

  // Binary yoksa indir
  if (!torBin) {
    await downloadTor();
    torBin = getTorBinaryPath();
    if (!torBin) throw new Error("Tor binary indirilemedi");
  }

  const dataDir = path.join(app.getPath("userData"), "tor-data");
  fs.mkdirSync(dataDir, { recursive: true });

  emit("starting", undefined, "Tor başlatılıyor...");

  return new Promise((resolve, reject) => {
    const tor = spawn(torBin!, [
      "--SocksPort", String(TOR_SOCKS_PORT),
      "--ControlPort", String(TOR_CONTROL_PORT),
      "--DataDirectory", dataDir,
      "--Log", "notice stdout",
    ]);

    torProcess = tor;
    bootstrapProgress = 0;

    const timeout = setTimeout(() => {
      tor.kill();
      reject(new Error("Tor bootstrap zaman aşımı (90s)"));
    }, BOOTSTRAP_TIMEOUT_MS);

    tor.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();

      // Bootstrap ilerleme çıktısını yakala: "Bootstrapped 42% (conn_dir): ..."
      const match = text.match(/Bootstrapped (\d+)%/);
      if (match) {
        bootstrapProgress = parseInt(match[1], 10);
        emit("bootstrapping", bootstrapProgress, `Tor ağına bağlanıyor... %${bootstrapProgress}`);

        if (bootstrapProgress >= 100) {
          clearTimeout(timeout);
          resolve();
          emit("ready", 100, "Tor ağına bağlandı");
        }
      }
    });

    tor.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      if (text.includes("Bootstrapped 100")) {
        clearTimeout(timeout);
        resolve();
        emit("ready", 100, "Tor ağına bağlandı");
      }
    });

    tor.on("error", (err) => {
      clearTimeout(timeout);
      emit("error", undefined, err.message);
      reject(err);
    });

    tor.on("exit", (code) => {
      torProcess = null;
      if (code !== 0 && bootstrapProgress < 100) {
        clearTimeout(timeout);
        emit("error", undefined, `Tor çıkış kodu: ${code}`);
        reject(new Error(`Tor çıkış kodu: ${code}`));
      }
    });
  });
}

// ── Tor durdur ────────────────────────────────────────────────────────
export function stopTor(): void {
  if (torProcess) {
    torProcess.kill("SIGTERM");
    torProcess = null;
  }
  bootstrapProgress = 0;
  emit("stopped");
}

export function getTorProgress(): number {
  return bootstrapProgress;
}
