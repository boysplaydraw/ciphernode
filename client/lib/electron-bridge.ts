/**
 * electron-bridge.ts — Electron ortamında IPC köprüsü
 *
 * Renderer (React Native Web) tarafında window.electronAPI'ye erişim sağlar.
 * Web/mobil ortamda çalışırsa tüm fonksiyonlar no-op döner.
 */

import { Platform } from "react-native";

// Electron ortamında preload.ts tarafından enjekte edilir
declare global {
  interface Window {
    electronAPI?: {
      tor: {
        enable: () => Promise<{ success: boolean; error?: string }>;
        disable: () => Promise<{ success: boolean; error?: string }>;
        getStatus: () => Promise<{ enabled: boolean; portOpen: boolean; port: number }>;
        verify: () => Promise<{ isTor: boolean; ip: string; error?: string }>;
        onStatus: (callback: (status: {
          stage: string;
          progress?: number;
          message?: string;
        }) => void) => () => void;
      };
      biometric: {
        isAvailable: () => Promise<boolean>;
        authenticate: (reason: string) => Promise<{ success: boolean; error?: string }>;
      };
      onionShare: {
        create: (params: {
          files: Array<{ name: string; dataBase64: string; mimeType: string }>;
          maxDownloads?: number;
          expiresInMs?: number;
        }) => Promise<{ success: boolean; onionAddress?: string; sessionId?: string; token?: string; error?: string }>;
        close: (sessionId: string) => Promise<{ success: boolean }>;
        list: () => Promise<Array<{ sessionId: string; onionAddress: string; expiresAt: number }>>;
      };
      platform: string;
      isElectron: boolean;
      app: {
        getVersion: () => Promise<string>;
        openExternal: (url: string) => Promise<void>;
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
      };
    };
  }
}

/** Bu uygulama Electron'da mı çalışıyor? */
export function isElectron(): boolean {
  return Platform.OS === "web" && typeof window !== "undefined" && !!window.electronAPI?.isElectron;
}

/** Electron ortamında Tor'u etkinleştir — session.setProxy() ile TÜM trafik Tor'dan geçer */
export async function electronEnableTor(): Promise<{ success: boolean; error?: string }> {
  if (!isElectron()) return { success: false, error: "Not in Electron" };
  return window.electronAPI!.tor.enable();
}

/** Tor'u devre dışı bırak */
export async function electronDisableTor(): Promise<{ success: boolean; error?: string }> {
  if (!isElectron()) return { success: false, error: "Not in Electron" };
  return window.electronAPI!.tor.disable();
}

/** Tor durum bilgisini al */
export async function electronGetTorStatus(): Promise<{ enabled: boolean; portOpen: boolean; port: number } | null> {
  if (!isElectron()) return null;
  return window.electronAPI!.tor.getStatus();
}

/** check.torproject.org ile Tor bağlantısını doğrula */
export async function electronVerifyTor(): Promise<{ isTor: boolean; ip: string; error?: string } | null> {
  if (!isElectron()) return null;
  return window.electronAPI!.tor.verify();
}

/** Tor durum güncellemelerini dinle */
export function electronOnTorStatus(
  callback: (status: { stage: string; progress?: number; message?: string }) => void
): (() => void) | null {
  if (!isElectron()) return null;
  return window.electronAPI!.tor.onStatus(callback);
}

/** Electron'da biyometrik kilit kullanılabilir mi? */
export async function electronBiometricIsAvailable(): Promise<boolean> {
  if (!isElectron()) return false;
  return window.electronAPI!.biometric.isAvailable();
}

/** Electron'da biyometrik doğrulama iste (Touch ID / Windows Hello) */
export async function electronBiometricAuthenticate(
  reason: string
): Promise<{ success: boolean; error?: string }> {
  if (!isElectron()) return { success: false, error: "Not in Electron" };
  return window.electronAPI!.biometric.authenticate(reason);
}

/** Harici URL'yi sistem tarayıcısında aç */
export function electronOpenExternal(url: string): void {
  if (isElectron()) {
    window.electronAPI!.app.openExternal(url);
  } else {
    // Web fallback
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }
}
