/**
 * preload.ts — Electron güvenli köprüsü (contextBridge)
 * Renderer (React) tarafının ana süreçle konuşmasını sağlar.
 * nodeIntegration: false → güvenli sandbox modunda çalışır.
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // ── Tor ──────────────────────────────────────────────────────────────
  tor: {
    enable: () => ipcRenderer.invoke("tor:enable"),
    disable: () => ipcRenderer.invoke("tor:disable"),
    getStatus: () => ipcRenderer.invoke("tor:status"),
    verify: () => ipcRenderer.invoke("tor:verify"),
    onStatus: (
      callback: (status: {
        stage: string;
        progress?: number;
        message?: string;
      }) => void,
    ) => {
      ipcRenderer.on("tor:status-update", (_event, status) => callback(status));
      return () => ipcRenderer.removeAllListeners("tor:status-update");
    },
  },

  // ── OnionShare ───────────────────────────────────────────────────────
  onionShare: {
    create: (params: {
      files: Array<{ name: string; dataBase64: string; mimeType: string }>;
      maxDownloads?: number;
      expiresInMs?: number;
    }) => ipcRenderer.invoke("onionshare:create", params),
    close: (sessionId: string) =>
      ipcRenderer.invoke("onionshare:close", sessionId),
    list: () => ipcRenderer.invoke("onionshare:list"),
  },

  // ── Biyometrik ───────────────────────────────────────────────────────
  biometric: {
    isAvailable: () => ipcRenderer.invoke("biometric:isAvailable"),
    authenticate: (reason: string) =>
      ipcRenderer.invoke("biometric:authenticate", reason),
  },

  // ── WebTorrent ───────────────────────────────────────────────────────
  webtorrent: {
    seed: (params: { dataBase64: string; fileName: string; mimeType: string }) =>
      ipcRenderer.invoke("webtorrent:seed", params),
    download: (params: { magnetURI: string }) =>
      ipcRenderer.invoke("webtorrent:download", params),
    progress: (infoHash: string) =>
      ipcRenderer.invoke("webtorrent:progress", infoHash),
    remove: (infoHash: string) =>
      ipcRenderer.invoke("webtorrent:remove", infoHash),
  },

  // ── Auto Updater ─────────────────────────────────────────────────────
  updater: {
    check: () => ipcRenderer.invoke("updater:check"),
    install: () => ipcRenderer.invoke("updater:install"),
    onStatus: (
      callback: (info: {
        status: string;
        version?: string;
        percent?: number;
        message?: string;
      }) => void,
    ) => {
      ipcRenderer.on("updater:status", (_event, info) => callback(info));
      return () => ipcRenderer.removeAllListeners("updater:status");
    },
  },

  // ── Platform bilgisi ─────────────────────────────────────────────────
  platform: process.platform,
  isElectron: true,

  // ── Uygulama ─────────────────────────────────────────────────────────
  app: {
    getVersion: () => ipcRenderer.invoke("app:version"),
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximize: () => ipcRenderer.invoke("window:maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    openExternal: (url: string) => ipcRenderer.invoke("app:openExternal", url),
    reset: () => ipcRenderer.invoke("app:reset"),
  },
});
