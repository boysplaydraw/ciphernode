const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function configuredOrigins(): Set<string> | null {
  const raw = process.env.CORS_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS;
  if (!raw) return null;
  return new Set(
    raw
      .split(",")
      .map((origin: string) => origin.trim())
      .filter(Boolean),
  );
}

function isPrivateLanHost(hostname: string): boolean {
  return (
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function normalizeHost(host?: string): string | null {
  if (!host) return null;
  return host.replace(/^\[/, "").replace(/\]$/, "").replace(/:\d+$/, "");
}

export function isAllowedOrigin(origin?: string, requestHost?: string): boolean {
  if (!origin) return true;

  const allowlist = configuredOrigins();
  if (allowlist?.has("*") || allowlist?.has(origin)) return true;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) return false;

  const hostname = parsed.hostname;
  const host = normalizeHost(requestHost);
  if (host && hostname === host) return true;
  if (LOCAL_HOSTS.has(hostname) || hostname.endsWith(".localhost")) return true;
  if (hostname.endsWith(".onion")) return true;

  return process.env.NODE_ENV !== "production" && isPrivateLanHost(hostname);
}
