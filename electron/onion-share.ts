/**
 * onion-share.ts — OnionShare tarzı dosya paylaşımı
 *
 * Tor Control Protocol üzerinden ephemeral (geçici) onion servisi oluşturur.
 * Dosyalar yerel HTTP sunucuda sunulur, .onion adresi üzerinden erişilir.
 * Tor çalışmıyorsa bu özellik devre dışıdır.
 */

import * as http from "node:http";
import * as net from "node:net";
import * as crypto from "node:crypto";

const TOR_CONTROL_PORT = 9051;
const TOR_CONTROL_HOST = "127.0.0.1";

interface OnionSession {
  onionAddress: string;
  localPort: number;
  server: http.Server;
  files: Map<
    string,
    {
      name: string;
      data: Buffer;
      mimeType: string;
      downloads: number;
      maxDownloads: number;
    }
  >;
  expiresAt: number;
  token: string;
}

const activeSessions = new Map<string, OnionSession>();

// ── Tor Control Port bağlantısı ───────────────────────────────────────
class TorControl {
  private socket: net.Socket | null = null;
  private buffer = "";
  private accumulated = "";
  private waiters: Array<{
    resolve: (s: string) => void;
    reject: (e: Error) => void;
  }> = [];

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(TOR_CONTROL_PORT, TOR_CONTROL_HOST);
      this.socket.setEncoding("utf8");

      this.socket.on("connect", resolve);
      this.socket.on("error", reject);

      this.socket.on("data", (data: string) => {
        this.buffer += data;
        this.processBuffer();
      });
    });
  }

  private processBuffer() {
    const lines = this.buffer.split("\r\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line) continue;
      // Multi-line devam satırı: "250-..." → biriktir
      if (/^\d{3}-/.test(line)) {
        this.accumulated += line + "\n";
        continue;
      }
      // Son satır: "250 ..." → tüm yanıtı resolve et
      if (/^\d{3} /.test(line) && this.waiters.length > 0) {
        const waiter = this.waiters.shift()!;
        const fullResponse = this.accumulated + line;
        this.accumulated = "";
        if (line.startsWith("2")) {
          waiter.resolve(fullResponse);
        } else {
          waiter.reject(new Error(`Tor Control error: ${fullResponse}`));
        }
      }
    }
  }

  async send(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Not connected"));
        return;
      }
      this.waiters.push({ resolve, reject });
      this.socket.write(command + "\r\n");
    });
  }

  async authenticate(): Promise<void> {
    // Önce PROTOCOLINFO ile auth metodunu öğren
    try {
      const info = await this.send("PROTOCOLINFO 1");
      // Cookie auth
      const cookieMatch = info.match(/COOKIEFILE="([^"]+)"/);
      if (cookieMatch) {
        const cookiePath = cookieMatch[1];
        const cookie = require("fs").readFileSync(cookiePath);
        const cookieHex = Buffer.from(cookie).toString("hex");
        await this.send(`AUTHENTICATE ${cookieHex}`);
        return;
      }
      // NULL auth (ControlPort açıksa auth gerekmez)
      await this.send("AUTHENTICATE");
    } catch {
      // Son çare: şifresiz dene
      await this.send("AUTHENTICATE");
    }
  }

  async createEphemeralOnionService(localPort: number): Promise<string> {
    // ED25519-V3 ephemeral onion service oluştur
    const response = await this.send(
      `ADD_ONION NEW:ED25519-V3 Flags=DiscardPK Port=80,${localPort}`,
    );

    // Multi-line yanıtta "ServiceID=..." satırını ara
    const match = response.match(/ServiceID=([a-z2-7]{56})/i);
    if (!match) {
      throw new Error("Could not get onion address from Tor Control response");
    }

    return `${match[1]}.onion`;
  }

  disconnect() {
    this.socket?.end();
    this.socket = null;
  }
}

// ── Boş port bul ─────────────────────────────────────────────────────
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as net.AddressInfo;
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

// ── OnionShare oturumu başlat ─────────────────────────────────────────
export async function createOnionShare(params: {
  files: Array<{ name: string; data: Buffer; mimeType: string }>;
  maxDownloads?: number;
  expiresInMs?: number;
}): Promise<{ onionAddress: string; sessionId: string; token: string }> {
  const { files, maxDownloads = 3, expiresInMs = 60 * 60 * 1000 } = params;

  const localPort = await findFreePort();
  const sessionId = crypto.randomBytes(8).toString("hex");
  const token = crypto.randomBytes(16).toString("hex");

  // Yerel HTTP sunucu
  const fileMap = new Map<
    string,
    {
      name: string;
      data: Buffer;
      mimeType: string;
      downloads: number;
      maxDownloads: number;
    }
  >();
  for (const f of files) {
    const fileId = crypto.randomBytes(8).toString("hex");
    fileMap.set(fileId, { ...f, downloads: 0, maxDownloads });
  }

  const server = http.createServer((req, res) => {
    // Token doğrulama
    const url = new URL(req.url || "/", `http://localhost`);
    if (url.searchParams.get("token") !== token) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const pathParts = url.pathname.split("/").filter(Boolean);

    // Dosya listesi
    if (pathParts.length === 0) {
      const fileList = Array.from(fileMap.entries()).map(([id, f]) => ({
        id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.data.length,
        remainingDownloads: f.maxDownloads - f.downloads,
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ files: fileList, sessionId }));
      return;
    }

    // Dosya indir
    const [fileId] = pathParts;
    const file = fileMap.get(fileId);

    if (!file) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    if (file.downloads >= file.maxDownloads) {
      res.writeHead(410);
      res.end("Download limit reached");
      return;
    }

    file.downloads++;
    res.writeHead(200, {
      "Content-Type": file.mimeType,
      "Content-Disposition": `attachment; filename="${file.name}"`,
      "Content-Length": file.data.length,
    });
    res.end(file.data);

    // Tüm dosyalar max indirmeye ulaştıysa sunucuyu kapat
    const allDone = Array.from(fileMap.values()).every(
      (f) => f.downloads >= f.maxDownloads,
    );
    if (allDone) {
      setTimeout(() => closeOnionSession(sessionId), 5000);
    }
  });

  server.listen(localPort, "127.0.0.1");

  // Tor onion servisi oluştur
  let onionAddress = `local-${sessionId}.onion`; // fallback

  try {
    const tor = new TorControl();
    await tor.connect();
    await tor.authenticate();
    onionAddress = await tor.createEphemeralOnionService(localPort);
    tor.disconnect();
  } catch (err) {
    // Tor control başarısız — sadece lokal mod çalışır
    console.warn("[OnionShare] Tor control failed, using local mode:", err);
  }

  const session: OnionSession = {
    onionAddress,
    localPort,
    server,
    files: fileMap,
    expiresAt: Date.now() + expiresInMs,
    token,
  };

  activeSessions.set(sessionId, session);

  // Otomatik temizlik
  setTimeout(() => closeOnionSession(sessionId), expiresInMs);

  return { onionAddress, sessionId, token };
}

// ── Oturumu kapat ─────────────────────────────────────────────────────
export function closeOnionSession(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.server.close();
    activeSessions.delete(sessionId);
  }
}

export function getActiveSessions(): Array<{
  sessionId: string;
  onionAddress: string;
  expiresAt: number;
}> {
  return Array.from(activeSessions.entries()).map(([id, s]) => ({
    sessionId: id,
    onionAddress: s.onionAddress,
    expiresAt: s.expiresAt,
  }));
}
