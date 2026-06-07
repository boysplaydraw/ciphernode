/**
 * tauri-bridge.ts — Tauri masaüstü ortamı köprüsü
 *
 * Tauri (root `src-tauri/`) uygulaması, Go relay backend'ini bir "sidecar" süreç
 * olarak rastgele boş bir portta başlatır ve portu `get_backend_config` komutuyla
 * frontend'e açar. Bu köprü o portu okuyup uygulamayı kendi yerel relay'ine
 * yönlendirir. Web/mobil/Electron ortamında tüm fonksiyonlar no-op döner.
 *
 * Tauri v2 `app.withGlobalTauri = true` iken `window.__TAURI__.core.invoke`
 * global olarak erişilebilir; böylece @tauri-apps/api'yi metro bundle'a eklemeye
 * gerek kalmaz.
 */

import { Platform } from "react-native";
import { setCustomServerUrl, getCustomServerUrl } from "./query-client";

declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke: <T = unknown>(
          cmd: string,
          args?: Record<string, unknown>,
        ) => Promise<T>;
      };
    };
  }
}

interface BackendConfig {
  port: number;
  authToken: string;
}

let cachedBackendUrl: string | null = null;

/** Bu uygulama Tauri masaüstü içinde mi çalışıyor? */
export function isTauri(): boolean {
  return (
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    !!window.__TAURI__?.core?.invoke
  );
}

/** Sidecar Go relay'in yerel HTTP adresini döndür (köprü kurulduysa). */
export function getTauriBackendUrl(): string | null {
  return cachedBackendUrl;
}

async function waitForHealth(baseUrl: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // Sidecar henüz dinlemiyor — kısa bekle ve tekrar dene
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Tauri sidecar backend'ini keşfet ve (kullanıcı kendi sunucusunu ayarlamadıysa)
 * uygulamayı yerel relay'e yönlendir. Socket bağlantısından ÖNCE çağrılmalı.
 */
export async function initTauriBackend(): Promise<void> {
  if (!isTauri()) return;
  try {
    const config = await window.__TAURI__!.core!.invoke<BackendConfig>(
      "get_backend_config",
    );
    if (!config?.port) return;
    const baseUrl = `http://127.0.0.1:${config.port}`;
    cachedBackendUrl = baseUrl;

    // Relay ayağa kalkana kadar bekle (sidecar süreci yeni başlamış olabilir)
    await waitForHealth(baseUrl);

    // Kullanıcı Ağ Ayarları'ndan kendi sunucusunu girmediyse yerel relay'i kullan
    const existing = getCustomServerUrl();
    if (!existing) {
      setCustomServerUrl(baseUrl);
      console.log(`[Tauri] Yerel relay'e bağlanılıyor: ${baseUrl}`);
    }
  } catch (error) {
    console.warn("[Tauri] Backend köprüsü kurulamadı:", error);
  }
}
