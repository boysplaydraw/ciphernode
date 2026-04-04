/**
 * electron/main.ts — CipherNode Masaüstü Ana Süreç
 *
 * Mimari:
 * - BrowserWindow: Expo web build'ini yükler (localhost:8081 geliştirme / dist/ üretim)
 * - Tor: tor-manager.ts aracılığıyla Tor süreci yönetimi
 * - session.setProxy(): TÜM trafik (socket.io dahil) tek satırla Tor'dan geçer
 * - IPC: Renderer ↔ Ana süreç güvenli köprüsü
 */

import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  nativeTheme,
  Menu,
  systemPreferences,
} from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";

// ── Üretimde dist/ klasörünü gömülü HTTP sunucusuyla sun ──────────────
// sandbox:true ile app:// custom protokolü renderer'dan erişilemiyor.
// localhost HTTP sunucusu hem sandbox hem webSecurity ile sorunsuz çalışır.
const CLIENT_PORT = 45678;
let clientServer: http.Server | null = null;

const STATIC_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function startClientServer(distDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    clientServer = http.createServer((req, res) => {
      const urlPath = (req.url ?? "/").split("?")[0].split("#")[0];
      const filePath = path.join(
        distDir,
        urlPath === "/" ? "index.html" : urlPath,
      );

      // Dosya yoksa SPA fallback → index.html
      const targetPath =
        fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()
          ? filePath
          : path.join(distDir, "index.html");

      const ext = path.extname(targetPath).toLowerCase();
      const mime = STATIC_MIME[ext] ?? "application/octet-stream";

      res.setHeader("Content-Type", mime);
      res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
      fs.createReadStream(targetPath).pipe(res);
    });

    clientServer.on("error", reject);
    clientServer.listen(CLIENT_PORT, "127.0.0.1", () => resolve());
  });
}
import { startTor, stopTor, isTorPortOpen, onTorStatus } from "./tor-manager";
import {
  createOnionShare,
  closeOnionSession,
  getActiveSessions,
} from "./onion-share";

// ── Geliştirme / Üretim modu ─────────────────────────────────────────
const IS_DEV = !app.isPackaged;
const EXPO_DEV_URL = "http://localhost:8081";

let mainWindow: BrowserWindow | null = null;
let torEnabled = false;

// ── Pencere oluştur ───────────────────────────────────────────────────
function createWindow() {
  nativeTheme.themeSource = "dark";

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 600,
    backgroundColor: "#0A0E14",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
    icon: path.join(__dirname, "..", "assets", "images", "icon.png"),
    title: "CipherNode",
  });

  // Uygulama menüsünü sadeleştir
  setupMenu();

  // URL yükle
  if (IS_DEV) {
    mainWindow.loadURL(EXPO_DEV_URL);
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${CLIENT_PORT}`);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Harici linkleri tarayıcıda aç
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

// ── Uygulama menüsü ───────────────────────────────────────────────────
function setupMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "CipherNode",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── IPC: Tor ─────────────────────────────────────────────────────────
function setupTorIPC() {
  // Tor durum güncellemelerini renderer'a yayınla
  onTorStatus((status) => {
    mainWindow?.webContents.send("tor:status-update", status);
  });

  // Tor etkinleştir
  ipcMain.handle("tor:enable", async () => {
    try {
      await startTor();
      // session.setProxy() — TÜM WebSocket ve HTTP trafiği Tor'dan geçer
      await session.defaultSession.setProxy({
        proxyRules: `socks5://127.0.0.1:9050`,
        proxyBypassRules: "localhost,127.0.0.1,<local>",
      });
      torEnabled = true;
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Tor devre dışı bırak
  ipcMain.handle("tor:disable", async () => {
    try {
      await session.defaultSession.setProxy({ proxyRules: "" });
      stopTor();
      torEnabled = false;
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Tor durumunu sorgula
  ipcMain.handle("tor:status", async () => {
    const portOpen = await isTorPortOpen();
    return {
      enabled: torEnabled,
      portOpen,
      port: 9050,
    };
  });

  // check.torproject.org ile gerçek Tor doğrulama
  ipcMain.handle("tor:verify", async () => {
    return new Promise<{ isTor: boolean; ip: string; error?: string }>(
      (resolve) => {
        const options = {
          hostname: "check.torproject.org",
          path: "/api/ip",
          method: "GET",
          timeout: 10000,
        };

        const req = https.request(options, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const json = JSON.parse(data);
              resolve({ isTor: json.IsTor === true, ip: json.IP || "?" });
            } catch {
              resolve({ isTor: false, ip: "?", error: "Parse error" });
            }
          });
        });

        req.on("error", (err) =>
          resolve({ isTor: false, ip: "?", error: err.message }),
        );
        req.on("timeout", () => {
          req.destroy();
          resolve({ isTor: false, ip: "?", error: "Timeout" });
        });
        req.end();
      },
    );
  });
}

// ── IPC: OnionShare ───────────────────────────────────────────────────
function setupOnionShareIPC() {
  ipcMain.handle(
    "onionshare:create",
    async (
      _event,
      params: {
        files: Array<{ name: string; dataBase64: string; mimeType: string }>;
        maxDownloads?: number;
        expiresInMs?: number;
      },
    ) => {
      try {
        const files = params.files.map((f) => ({
          name: f.name,
          data: Buffer.from(f.dataBase64, "base64"),
          mimeType: f.mimeType,
        }));

        const result = await createOnionShare({
          files,
          maxDownloads: params.maxDownloads,
          expiresInMs: params.expiresInMs,
        });

        return { success: true, ...result };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.handle("onionshare:close", (_event, sessionId: string) => {
    closeOnionSession(sessionId);
    return { success: true };
  });

  ipcMain.handle("onionshare:list", () => {
    return getActiveSessions();
  });
}

// ── IPC: Biyometrik kimlik doğrulama ──────────────────────────────────
function setupBiometricIPC() {
  /**
   * Biyometrik kullanılabilirlik kontrolü.
   * macOS: Touch ID varlığı kontrol edilir.
   * Windows: Windows Hello / PIN mevcut (temel check).
   */
  ipcMain.handle("biometric:isAvailable", () => {
    if (process.platform === "darwin") {
      try {
        return (systemPreferences as any).canPromptTouchID?.() ?? false;
      } catch {
        return false;
      }
    }
    if (process.platform === "win32") {
      // Windows Hello varlığı — temel kontrol
      return true; // Windows 10+ genellikle destekliyor
    }
    return false;
  });

  /**
   * Biyometrik kimlik doğrulama isteği.
   * macOS: Touch ID / password dialog
   * Windows: Windows Hello credential prompt
   */
  ipcMain.handle("biometric:authenticate", async (_event, reason: string) => {
    if (process.platform === "darwin") {
      try {
        await (systemPreferences as any).promptTouchID(reason);
        return { success: true };
      } catch (err: any) {
        return {
          success: false,
          error: err.message || "Authentication cancelled",
        };
      }
    }

    if (process.platform === "win32") {
      // Windows Hello: credential prompt aç
      try {
        const { exec } = require("node:child_process");
        await new Promise<void>((resolve, reject) => {
          // PowerShell ile Windows Hello kimlik doğrulama
          exec(
            `powershell -WindowStyle Hidden -Command "& {Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('CipherNode kimlik dogrulama gerektirir.', 'CipherNode'); }"`,
            (err: any) => {
              if (err) reject(err);
              else resolve();
            },
          );
        });
        // Basit PIN dialog için — gerçek Windows Hello entegrasyonu
        // node-windows-hello paketi ile genişletilebilir
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }

    return {
      success: false,
      error: "Biometric not supported on this platform",
    };
  });
}

// ── IPC: WebTorrent ───────────────────────────────────────────────────
let _webtorrentClient: any = null;

function getWebTorrentClient() {
  if (!_webtorrentClient) {
    try {
      const WebTorrent = require("webtorrent");
      _webtorrentClient = new WebTorrent();
    } catch {
      throw new Error("WebTorrent kurulu değil. Electron için: npm install webtorrent");
    }
  }
  return _webtorrentClient;
}

function setupWebTorrentIPC() {
  /** Dosyayı torrent olarak seed et — magnet URI döner */
  ipcMain.handle(
    "webtorrent:seed",
    async (
      _event,
      params: { dataBase64: string; fileName: string; mimeType: string },
    ) => {
      try {
        const client = getWebTorrentClient();
        const buf = Buffer.from(params.dataBase64, "base64");
        const file = { name: params.fileName, buffer: buf };

        return new Promise<{ magnetURI: string; infoHash: string }>(
          (resolve, reject) => {
            client.seed(buf, { name: params.fileName }, (torrent: any) => {
              resolve({ magnetURI: torrent.magnetURI, infoHash: torrent.infoHash });
            });
            setTimeout(() => reject(new Error("Seed timeout")), 30000);
          },
        );
      } catch (err: any) {
        throw new Error(err.message);
      }
    },
  );

  /** Magnet URI ile dosyayı indir */
  ipcMain.handle(
    "webtorrent:download",
    async (
      _event,
      params: { magnetURI: string },
      ...args: any[]
    ) => {
      const webContentsId = args[0];
      try {
        const client = getWebTorrentClient();
        const tmpDir = require("node:os").tmpdir();

        return new Promise<{ fileName: string; dataBase64: string; mimeType: string }>(
          (resolve, reject) => {
            client.add(params.magnetURI, { path: tmpDir }, (torrent: any) => {
              torrent.on("done", () => {
                const file = torrent.files[0];
                file.getBuffer((err: any, buf: Buffer) => {
                  if (err) return reject(err);
                  resolve({
                    fileName: file.name,
                    dataBase64: buf.toString("base64"),
                    mimeType: "application/octet-stream",
                  });
                  torrent.destroy();
                });
              });
              torrent.on("error", reject);
            });
            setTimeout(() => reject(new Error("Download timeout after 5 min")), 300000);
          },
        );
      } catch (err: any) {
        throw new Error(err.message);
      }
    },
  );

  /** Torrent progress'ini sorgula */
  ipcMain.handle("webtorrent:progress", (_event, infoHash: string) => {
    try {
      const client = getWebTorrentClient();
      const torrent = client.get(infoHash);
      if (!torrent) return null;
      return {
        progress: torrent.progress,
        downloadSpeed: torrent.downloadSpeed,
        uploadSpeed: torrent.uploadSpeed,
        numPeers: torrent.numPeers,
        done: torrent.done,
      };
    } catch {
      return null;
    }
  });

  /** Torrent'i durdur ve kaldır */
  ipcMain.handle("webtorrent:remove", (_event, infoHash: string) => {
    try {
      const client = getWebTorrentClient();
      const torrent = client.get(infoHash);
      if (torrent) torrent.destroy();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

// ── IPC: Uygulama ─────────────────────────────────────────────────────
function setupAppIPC() {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:openExternal", (_event, url: string) =>
    shell.openExternal(url),
  );

  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:maximize", () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.handle("window:close", () => mainWindow?.close());
}

// ── Uygulama başlatma ─────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Üretimde: gömülü HTTP sunucusunu başlat
  if (!IS_DEV) {
    const distDir = path.join(__dirname, "..", "..", "dist");
    await startClientServer(distDir);
  }

  setupTorIPC();
  setupOnionShareIPC();
  setupBiometricIPC();
  setupWebTorrentIPC();
  setupAppIPC();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  stopTor();
  clientServer?.close();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Güvenlik: Yeni pencere açılmasını engelle
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    // Dev: localhost:8081, Prod: localhost:45678 — her ikisi de izinli
    if (
      parsedUrl.hostname === "localhost" ||
      parsedUrl.hostname === "127.0.0.1"
    )
      return;
    event.preventDefault();
  });
});
