import { QueryClient, QueryFunction } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SETTINGS_KEY = "@ciphernode/settings";

let cachedCustomServerUrl: string | null = null;

export async function loadCustomServerUrl(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const settings = JSON.parse(stored);
      cachedCustomServerUrl = settings.serverUrl || null;
    }
  } catch {
    cachedCustomServerUrl = null;
  }
}

export function setCustomServerUrl(url: string | null): void {
  cachedCustomServerUrl = url || null;
}

// Resmi sunucu URL — build zamanında EXPO_PUBLIC_SERVER_URL ile ayarlanır
const OFFICIAL_SERVER_URL =
  process.env.EXPO_PUBLIC_SERVER_URL ||
  (process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : null);

/**
 * Build zamanında yapılandırılmış resmi sunucu URL'sini döndürür.
 * Yapılandırılmamışsa null döner — UI bunu "kendi sunucunuzu kurun" mesajı için kullanır.
 */
export function getOfficialServerUrl(): string | null {
  return OFFICIAL_SERVER_URL || null;
}

export function getApiUrl(): string {
  if (cachedCustomServerUrl && cachedCustomServerUrl.trim()) {
    return cachedCustomServerUrl.trim().replace(/\/$/, "") + "/";
  }

  if (OFFICIAL_SERVER_URL) {
    return OFFICIAL_SERVER_URL.replace(/\/$/, "") + "/";
  }

  // Resmi sunucu yapılandırılmamış — tarayıcıdan erişiliyorsa origin kullan (LAN erişimi için)
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin + "/";
  }
  return "http://localhost:5000/";
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// Tünel servislerinin bypass sayfasını atlamak için ek header
export function getTunnelBypassHeaders(url?: string): Record<string, string> {
  const target = url || getApiUrl();
  if (
    target.includes(".loca.lt") ||
    target.includes("ngrok") ||
    target.includes("tunnel")
  ) {
    return { "bypass-tunnel-reminder": "true", "User-Agent": "CipherNode/1.0" };
  }
  return {};
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const res = await fetch(url, {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...getTunnelBypassHeaders(),
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = getApiUrl();
    const url = new URL(queryKey.join("/") as string, baseUrl);

    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
