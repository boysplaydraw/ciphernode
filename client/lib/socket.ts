import { io } from "socket.io-client";
import * as ExpoCrypto from "expo-crypto";
import { getApiUrl } from "./query-client";
import { getTorSettings, getActiveGroups, type TorSettings } from "./storage";
import { stegEncode, stegDecode } from "./steganography";
import { isTauri } from "./tauri-bridge";

interface SocketLike {
  connected: boolean;
  disconnect(): unknown;
  emit(event: string, ...args: any[]): unknown;
  on(event: string, handler: (...args: any[]) => void): unknown;
  once(event: string, handler: (...args: any[]) => void): unknown;
  off(event?: string, handler?: (...args: any[]) => void): unknown;
}

class GoWebSocketRelay implements SocketLike {
  private ws: WebSocket;
  private handlers = new Map<string, Set<(...args: any[]) => void>>();
  private pendingAcks = new Map<string, (data: unknown) => void>();
  connected = false;

  constructor(baseUrl: string) {
    this.ws = new WebSocket(getWsUrl(baseUrl));
    this.ws.onopen = () => {
      this.connected = true;
      this.dispatchLocal("connect");
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.dispatchLocal("disconnect", "websocket closed");
    };
    this.ws.onerror = () => {
      this.dispatchLocal(
        "connect_error",
        new Error("websocket connect failed"),
      );
    };
    this.ws.onmessage = (message) => this.dispatchRemote(message.data);
  }

  disconnect(): void {
    this.connected = false;
    this.ws.close();
  }

  emit(event: string, data?: unknown, ack?: (data: unknown) => void): this {
    const requestId = ack ? cryptoRandom() : undefined;
    if (requestId && ack) {
      this.pendingAcks.set(requestId, ack);
    }
    const send = () => {
      this.ws.send(
        JSON.stringify({
          event,
          data,
          requestId,
          nonce: cryptoRandom(),
          timestamp: Date.now(),
        }),
      );
    };
    if (this.ws.readyState === WebSocket.OPEN) {
      send();
    } else if (this.ws.readyState === WebSocket.CONNECTING) {
      this.once("connect", send);
    }
    return this;
  }

  on(event: string, handler: (...args: any[]) => void): this {
    const bucket = this.handlers.get(event) ?? new Set();
    bucket.add(handler);
    this.handlers.set(event, bucket);
    return this;
  }

  once(event: string, handler: (...args: any[]) => void): this {
    const wrapped = (...args: any[]) => {
      this.off(event, wrapped);
      handler(...args);
    };
    return this.on(event, wrapped);
  }

  off(event: string, handler?: (...args: any[]) => void): this {
    if (!handler) {
      this.handlers.delete(event);
      return this;
    }
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  private dispatchRemote(raw: unknown): void {
    const envelope =
      typeof raw === "string"
        ? JSON.parse(raw)
        : (raw as {
            event?: string;
            data?: unknown;
            requestId?: string;
            error?: string;
          });
    if (envelope.requestId && this.pendingAcks.has(envelope.requestId)) {
      this.pendingAcks.get(envelope.requestId)?.(envelope.data);
      this.pendingAcks.delete(envelope.requestId);
    }
    if (envelope.event) {
      this.dispatchLocal(envelope.event, envelope.data ?? envelope.error);
    }
  }

  private dispatchLocal(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.forEach((handler) => handler(...args));
  }
}

function toWsUrl(base: string): string {
  const url = new URL("/ws", base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function getWsUrl(base: string): string {
  const configuredWsUrl =
    process.env.EXPO_PUBLIC_WS_URL || process.env.WS_URL || null;
  if (configuredWsUrl?.trim()) {
    return configuredWsUrl.trim();
  }
  return toWsUrl(base);
}

function cryptoRandom(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return ExpoCrypto.randomUUID();
}

let socket: SocketLike | null = null;
let currentUserId: string | null = null;
let currentPublicKey: string = "";
let torEnabled: boolean = false;
let currentTorSettings: TorSettings | null = null;
let ghostModeEnabled: boolean = false; // Hayalet modu — typing göndermez
let steganographyEnabled: boolean = false; // Steganografi modu — mesajları cover text'e göm
let p2pOnlyEnabled: boolean = false; // Sadece P2P — çevrimdışı kuyruklama yapma
let relayHealthy: boolean = false; // Relay sunucusu sağlıklı mı?

type RelayStatusCallback = (healthy: boolean) => void;
const relayStatusListeners: RelayStatusCallback[] = [];
export type TransportState =
  | "relay"
  | "p2p_connecting"
  | "p2p_ready"
  | "p2p_failed";
type TransportStatusCallback = (state: TransportState, reason?: string) => void;
const transportStatusListeners: TransportStatusCallback[] = [];
let transportState: TransportState = "relay";
let unsubscribeNostrP2PFileOffer: (() => void) | null = null;

function transportLog(event: string, details: Record<string, unknown> = {}): void {
  console.info(
    "[Transport]",
    JSON.stringify({
      event,
      state: transportState,
      relayHealthy,
      p2pOnlyEnabled,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

export function reportTransportState(
  nextState: TransportState,
  reason?: string,
): void {
  if (transportState === nextState) return;
  const previous = transportState;
  transportState = nextState;
  transportLog("state_change", { previous, next: nextState, reason });
  transportStatusListeners.forEach((cb) => cb(nextState, reason));

  if (nextState === "p2p_ready") {
    if (socket?.connected) {
      transportLog("disconnecting_relay", { reason: "p2p_ready" });
      socket.disconnect();
    }
  } else if ((previous === "p2p_ready" || previous === "p2p_connecting") && nextState === "p2p_failed") {
    if (!socket?.connected && currentUserId && currentPublicKey) {
      transportLog("reconnecting_relay", { reason: "fallback" });
      initSocket(currentUserId, currentPublicKey).catch(console.error);
    }
  }
}

export function getTransportState(): TransportState {
  return transportState;
}

export function isP2PReady(): boolean {
  return transportState === "p2p_ready";
}

export function onTransportStateChange(
  callback: TransportStatusCallback,
): () => void {
  transportStatusListeners.push(callback);
  return () => {
    const idx = transportStatusListeners.indexOf(callback);
    if (idx > -1) transportStatusListeners.splice(idx, 1);
  };
}

/** Relay bağlantı durumunu bildir */
function setRelayHealth(healthy: boolean): void {
  if (relayHealthy === healthy) return;
  relayHealthy = healthy;
  transportLog("relay_health", { healthy });
  relayStatusListeners.forEach((cb) => cb(healthy));

  if (!healthy) {
    if (transportState !== "p2p_ready") {
      reportTransportState("p2p_failed", "relay disconnected before p2p ready");
    }
    // Relay düştü → Nostr sinyallemesini başlat (kimlik varsa)
    import("./crypto").then(({ getIdentity }) =>
      getIdentity().then((identity) => {
        if (identity?.nostrPrivkey && identity?.nostrPubkey) {
          import("./nostr-signal").then(({ initNostrSignal }) => {
            initNostrSignal(identity.nostrPrivkey!, identity.nostrPubkey!);
            ensureNostrP2PFileOfferBridge();
          });
        }
      }),
    );
  } else {
    if (transportState === "p2p_failed") {
      reportTransportState("relay", "relay reconnected");
    }
    // Relay bağlandı → Nostr'u kapat (opsiyonel, arka planda açık kalabilir)
    import("./nostr-signal").then(({ disconnectNostrSignal }) => {
      disconnectNostrSignal();
    });
  }
}

/** Ghost modu aç/kapat */
function ensureNostrP2PFileOfferBridge(): void {
  if (unsubscribeNostrP2PFileOffer) return;

  import("./nostr-signal").then(({ onNostrSignal }) => {
    if (unsubscribeNostrP2PFileOffer) return;
    unsubscribeNostrP2PFileOffer = onNostrSignal((event, data) => {
      if (event !== "p2p:file-offer") return;
      p2pFileOfferListeners.forEach((cb) => cb(data as P2PFileOffer));
    });
  });
}

export function setGhostMode(enabled: boolean): void {
  ghostModeEnabled = enabled;
}

/** Steganografi modunu aç/kapat */
export function setStegMode(enabled: boolean): void {
  steganographyEnabled = enabled;
}

/** P2P Only modunu aç/kapat */
export function setP2POnlyMode(enabled: boolean): void {
  p2pOnlyEnabled = enabled;
  transportLog("p2p_only_toggle", { enabled });
}

/**
 * Gerçek P2P modunu etkinleştir:
 * Relay bağlantısını keser, Nostr sinyallemesini başlatır.
 * Ayarlardan "Sadece P2P" açıldığında çağrılır.
 */
export async function activateP2PMode(): Promise<void> {
  // Relay bağlantısını kes
  reportTransportState("p2p_connecting", "p2p mode requested");
  // Nostr'u başlat (setRelayHealth(false) zaten tetikler ama kimlik lazım)
  const { getIdentity } = await import("./crypto");
  const identity = await getIdentity();
  if (identity?.nostrPrivkey && identity?.nostrPubkey) {
    const { initNostrSignal } = await import("./nostr-signal");
    initNostrSignal(identity.nostrPrivkey, identity.nostrPubkey);
    ensureNostrP2PFileOfferBridge();
  }
}

/**
 * P2P modundan çık, relay'e yeniden bağlan.
 */
export async function deactivateP2PMode(): Promise<void> {
  p2pOnlyEnabled = false;
  reportTransportState("relay", "p2p mode disabled");
  if (currentUserId && currentPublicKey) {
    await initSocket(currentUserId, currentPublicKey);
  }
}

type MessageCallback = (msg: {
  id: string;
  from: string;
  to: string;
  encrypted: string;
  timestamp: number;
}) => void;

type GroupMessageCallback = (msg: {
  groupId: string;
  from: string;
  encrypted: string;
  content?: string;
  timestamp: number;
}) => void;

type TypingCallback = (data: { from: string }) => void;
type StatusCallback = (
  status:
    | "connected"
    | "disconnected"
    | "registered"
    | "tor_connected"
    | "tor_connecting",
) => void;
type TorStatusCallback = (settings: TorSettings) => void;

// ── Matching tipleri ───────────────────────────────────────────────────
export type MatchingEvent =
  | { type: "queued"; alias: string }
  | {
      type: "found";
      sessionId: string;
      partnerAlias: string;
      trustScore: number;
    }
  | { type: "partner_accepted" }
  | { type: "connected"; sessionId: string; roomId: string }
  | { type: "declined" }
  | { type: "declined_by_you" }
  | { type: "partner_left" }
  | { type: "session_ended" }
  | { type: "cancelled" }
  | { type: "message"; encrypted: string; timestamp: number }
  | {
      type: "file_share";
      fileId: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
      encryptedKey: string;
      timestamp: number;
    }
  | { type: "error"; message: string };

// ── Dosya paylaşım bildirimi ─────────────────────────────────────────
export interface IncomingFileNotification {
  from: string;
  fileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  encryptedKey: string;
  timestamp: number;
}

type MatchingCallback = (event: MatchingEvent) => void;
type UserOnlineCallback = (data: { userId: string; publicKey: string }) => void;

/** Karşı taraf bizi kişi olarak eklediğinde gelen bildirim */
export interface IncomingContactAdd {
  from: string;
  publicKey?: string;
  nostrPubkey?: string;
  displayName?: string;
  timestamp?: number;
}
type ContactAddCallback = (data: IncomingContactAdd) => void;

type FileShareCallback = (notification: IncomingFileNotification) => void;
type WebRTCSignalCallback = (event: string, data: unknown) => void;

/** P2P büyük dosya transfer bildirimi (100 MB üstü dosyalar) */
export interface P2PFileOffer {
  from: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}
type P2PFileOfferCallback = (data: P2PFileOffer) => void;

const messageListeners: MessageCallback[] = [];
const groupMessageListeners: GroupMessageCallback[] = [];
const typingListeners: TypingCallback[] = [];
const statusListeners: StatusCallback[] = [];
const torStatusListeners: TorStatusCallback[] = [];
const matchingListeners: MatchingCallback[] = [];
const userOnlineListeners: UserOnlineCallback[] = [];
const contactAddListeners: ContactAddCallback[] = [];
const fileShareListeners: FileShareCallback[] = [];
const webrtcSignalListeners: WebRTCSignalCallback[] = [];
const p2pFileOfferListeners: P2PFileOfferCallback[] = [];

export async function initSocket(
  userId: string,
  publicKey: string,
): Promise<SocketLike> {
  if (socket?.connected && currentUserId === userId) {
    return socket;
  }

  if (socket) {
    socket.disconnect();
  }

  currentUserId = userId;
  currentPublicKey = publicKey;
  const url = getApiUrl();

  const torSettings = await getTorSettings();
  currentTorSettings = torSettings;
  torEnabled = torSettings.enabled;

  if (torEnabled) {
    statusListeners.forEach((cb) => cb("tor_connecting"));
    torStatusListeners.forEach((cb) => cb(torSettings));
  }

  const isTunnel =
    url.includes(".loca.lt") || url.includes("ngrok") || url.includes("tunnel");
  const extraHeaders: { [header: string]: string } = {};
  if (isTunnel) extraHeaders["bypass-tunnel-reminder"] = "true";
  if (torEnabled) {
    extraHeaders["X-Tor-Enabled"] = "true";
    extraHeaders["X-Tor-Proxy"] =
      `${torSettings.proxyHost}:${torSettings.proxyPort}`;
  }

  // Tor aktifken bağlantı sorunu olasılığı yüksek — daha kısa timeout
  const connectionTimeout = torEnabled ? 20000 : 10000;

  // Go relay yalnızca ham WebSocket (/ws) konuşur. Tauri masaüstü Go sidecar'ı
  // paketlediği için orada her zaman ham WebSocket transport kullanılmalı —
  // build zamanı env'ine bakılmaksızın çalışsın diye runtime'da da tespit edilir.
  const useWebSocketRelay =
    process.env.EXPO_PUBLIC_RELAY_TRANSPORT === "websocket" || isTauri();

  const activeSocket: SocketLike =
    useWebSocketRelay
      ? new GoWebSocketRelay(url)
      : io(url, {
          transports: ["websocket", "polling"],
          autoConnect: true,
          timeout: connectionTimeout,
          extraHeaders:
            Object.keys(extraHeaders).length > 0 ? extraHeaders : undefined,
        });
  socket = activeSocket;

  // Bağlantı zaman aşımı takipçisi
  let connectTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const startConnectTimeout = () => {
    if (connectTimeoutId) clearTimeout(connectTimeoutId);
    connectTimeoutId = setTimeout(() => {
      if (!socket?.connected) {
        const reason = torEnabled
          ? "Tor bağlantısı zaman aşımına uğradı. SOCKS5 proxy (localhost:9050) aktif mi? .onion adresini kontrol edin."
          : "Sunucu bağlantısı zaman aşımına uğradı. Sunucu adresi ve internet bağlantınızı kontrol edin.";
        console.warn(`[Socket] Connect timeout: ${reason}`);
        statusListeners.forEach((cb) => cb("disconnected"));
      }
    }, connectionTimeout + 2000);
  };

  startConnectTimeout();

  activeSocket.on("connect", async () => {
    if (connectTimeoutId) {
      clearTimeout(connectTimeoutId);
      connectTimeoutId = null;
    }
    setRelayHealth(true);
    if (transportState !== "p2p_ready" && transportState !== "p2p_connecting") {
      reportTransportState("relay", "relay connected");
    }
    const userGroupsList = await getActiveGroups();
    const groupIds = userGroupsList.map((g) => g.id);
    socket?.emit("register", {
      userId,
      publicKey,
      torEnabled,
      groups: groupIds,
    });
    if (torEnabled) {
      statusListeners.forEach((cb) => cb("tor_connected"));
    }
  });

  activeSocket.on("registered", () => {
    statusListeners.forEach((cb) => cb("registered"));
  });

  activeSocket.on("security:alert", (data: { message: string }) => {
    console.error(`[Security Alert] ${data.message}`);
    if (typeof window !== "undefined") {
      window.alert(`[GÜVENLİK UYARISI] Bağlantınız Kesildi:\n${data.message}`);
    }
  });

  activeSocket.on("message", (msg) => {
    // Gönderici steganografi kullandıysa otomatik decode et
    const decoded = stegDecode(msg.encrypted);
    const processedMsg = decoded ? { ...msg, encrypted: decoded } : msg;
    messageListeners.forEach((cb) => cb(processedMsg));
  });

  activeSocket.on("group:message", (msg) => {
    const decoded = stegDecode(msg.encrypted);
    const processedMsg = decoded ? { ...msg, encrypted: decoded } : msg;
    groupMessageListeners.forEach((cb) => cb(processedMsg));
  });

  activeSocket.on("typing", (data) => {
    typingListeners.forEach((cb) => cb(data));
  });

  activeSocket.on("disconnect", (reason) => {
    console.warn(`[Socket] Disconnected: ${reason}`);
    setRelayHealth(false);
    statusListeners.forEach((cb) => cb("disconnected"));
  });

  activeSocket.on("connect_error", (err) => {
    setRelayHealth(false);
    const isTorError =
      torEnabled &&
      (err.message?.includes("ECONNREFUSED") ||
        err.message?.includes("ETIMEDOUT") ||
        err.message?.includes("xhr poll error"));
    if (isTorError) {
      console.warn(
        `[Socket] Tor bağlantı hatası: ${err.message}\n` +
          `Olası nedenler:\n` +
          `  1) Cihazda Tor SOCKS5 proxy çalışmıyor (${torSettings.proxyHost}:${torSettings.proxyPort})\n` +
          `  2) .onion adresi geçersiz veya servis çevrimdışı\n` +
          `  3) Ağ bağlantısı Tor trafiğini engelliyor`,
      );
    } else {
      console.warn(`[Socket] Connect error: ${err.message}`);
    }
    statusListeners.forEach((cb) => cb("disconnected"));
  });

  // ── Matching olayları ──────────────────────────────────────────────
  activeSocket.on("matching:queued", (d) =>
    matchingListeners.forEach((cb) => cb({ type: "queued", alias: d.alias })),
  );
  activeSocket.on("matching:found", (d) =>
    matchingListeners.forEach((cb) =>
      cb({
        type: "found",
        sessionId: d.sessionId,
        partnerAlias: d.partnerAlias,
        trustScore: d.trustScore,
      }),
    ),
  );
  activeSocket.on("matching:partner_accepted", () =>
    matchingListeners.forEach((cb) => cb({ type: "partner_accepted" })),
  );
  activeSocket.on("matching:connected", (d) =>
    matchingListeners.forEach((cb) =>
      cb({ type: "connected", sessionId: d.sessionId, roomId: d.roomId }),
    ),
  );
  activeSocket.on("matching:declined", () =>
    matchingListeners.forEach((cb) => cb({ type: "declined" })),
  );
  activeSocket.on("matching:declined_by_you", () =>
    matchingListeners.forEach((cb) => cb({ type: "declined_by_you" })),
  );
  activeSocket.on("matching:partner_left", () =>
    matchingListeners.forEach((cb) => cb({ type: "partner_left" })),
  );
  activeSocket.on("matching:session_ended", () =>
    matchingListeners.forEach((cb) => cb({ type: "session_ended" })),
  );
  activeSocket.on("matching:cancelled", () =>
    matchingListeners.forEach((cb) => cb({ type: "cancelled" })),
  );
  activeSocket.on("matching:message", (d) =>
    matchingListeners.forEach((cb) =>
      cb({ type: "message", encrypted: d.encrypted, timestamp: d.timestamp }),
    ),
  );
  activeSocket.on("matching:error", (d) =>
    matchingListeners.forEach((cb) =>
      cb({ type: "error", message: d.message }),
    ),
  );

  // Bir kullanıcı çevrimiçi olduğunda public key güncellemesi
  activeSocket.on("user:online", (d: { userId: string; publicKey: string }) => {
    userOnlineListeners.forEach((cb) => cb(d));
  });

  // Karşı taraf bizi kişi olarak ekledi — otomatik karşılıklı ekleme bildirimi
  activeSocket.on("contact:add", (d: IncomingContactAdd) => {
    if (!d?.from) return;
    contactAddListeners.forEach((cb) => cb(d));
  });

  // Dosya paylaşım bildirimi (server "file:incoming" olarak emit ediyor)
  activeSocket.on("file:incoming", (d: IncomingFileNotification) => {
    fileShareListeners.forEach((cb) => cb(d));
  });

  // WebRTC signaling
  activeSocket.on("webrtc:offer", (d) =>
    webrtcSignalListeners.forEach((cb) => cb("webrtc:offer", d)),
  );
  activeSocket.on("webrtc:answer", (d) =>
    webrtcSignalListeners.forEach((cb) => cb("webrtc:answer", d)),
  );
  activeSocket.on("webrtc:ice", (d) =>
    webrtcSignalListeners.forEach((cb) => cb("webrtc:ice", d)),
  );

  // P2P büyük dosya bildirimi
  activeSocket.on("p2p:file-incoming", (d: P2PFileOffer) => {
    p2pFileOfferListeners.forEach((cb) => cb(d));
  });

  // Matching dosya paylaşımı (server "matching:file_incoming" olarak emit ediyor)
  activeSocket.on(
    "matching:file_incoming",
    (d: {
      fileId: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
      encryptedKey: string;
      timestamp: number;
    }) => {
      matchingListeners.forEach((cb) => cb({ type: "file_share", ...d }));
    },
  );

  return activeSocket;
}

export function sendMessage(to: string, encrypted: string, id: string): void {
  if (socket?.connected && currentUserId) {
    const payload = steganographyEnabled ? stegEncode(encrypted) : encrypted;
    socket.emit("message", {
      to,
      from: currentUserId,
      encrypted: payload,
      id,
      p2pOnly: p2pOnlyEnabled && isP2PReady() ? true : undefined,
    });
  } else {
    transportLog("send_message_skipped", {
      to,
      reason: "relay unavailable",
      p2pReady: isP2PReady(),
    });
  }
}

export function sendGroupMessage(
  groupId: string,
  encrypted: string,
  content: string,
): void {
  if (socket?.connected && currentUserId) {
    const payload = steganographyEnabled ? stegEncode(encrypted) : encrypted;
    socket.emit("group:message", {
      groupId,
      from: currentUserId,
      encrypted: payload,
      content,
    });
  }
}

export function joinGroup(groupId: string): void {
  if (socket?.connected && currentUserId) {
    socket.emit("group:join", { groupId, userId: currentUserId });
  }
}

export function leaveGroup(groupId: string): void {
  if (socket?.connected && currentUserId) {
    socket.emit("group:leave", { groupId, userId: currentUserId });
  }
}

export function createGroupOnServer(groupId: string, members: string[]): void {
  if (socket?.connected) {
    socket.emit("group:create", { groupId, members });
  }
}

export function sendTyping(to: string): void {
  // Ghost modunda typing bildirimi gönderilmez
  if (ghostModeEnabled) return;
  if (socket?.connected) {
    socket.emit("typing", { to });
  }
}

export function onMessage(callback: MessageCallback): () => void {
  messageListeners.push(callback);
  return () => {
    const index = messageListeners.indexOf(callback);
    if (index > -1) messageListeners.splice(index, 1);
  };
}

export function onGroupMessage(callback: GroupMessageCallback): () => void {
  groupMessageListeners.push(callback);
  return () => {
    const index = groupMessageListeners.indexOf(callback);
    if (index > -1) groupMessageListeners.splice(index, 1);
  };
}

export function onTyping(callback: TypingCallback): () => void {
  typingListeners.push(callback);
  return () => {
    const index = typingListeners.indexOf(callback);
    if (index > -1) typingListeners.splice(index, 1);
  };
}

export function onStatusChange(callback: StatusCallback): () => void {
  statusListeners.push(callback);
  return () => {
    const index = statusListeners.indexOf(callback);
    if (index > -1) statusListeners.splice(index, 1);
  };
}

export function disconnect(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
    currentUserId = null;
  }
}

export function isConnected(): boolean {
  return socket?.connected ?? false;
}

/** Relay sunucusu sağlıklı ve bağlı mı? */
export function isRelayConnected(): boolean {
  return relayHealthy;
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

/** Relay bağlantı durumu değiştiğinde bildirim al */
export function onRelayStatusChange(callback: RelayStatusCallback): () => void {
  relayStatusListeners.push(callback);
  return () => {
    const idx = relayStatusListeners.indexOf(callback);
    if (idx > -1) relayStatusListeners.splice(idx, 1);
  };
}

export function isTorEnabled(): boolean {
  return torEnabled;
}

export function getTorConnectionInfo(): TorSettings | null {
  return currentTorSettings;
}

export function onTorStatusChange(callback: TorStatusCallback): () => void {
  torStatusListeners.push(callback);
  return () => {
    const index = torStatusListeners.indexOf(callback);
    if (index > -1) torStatusListeners.splice(index, 1);
  };
}

// ── Matching API ────────────────────────────────────────────────────────

export function startMatching(): void {
  if (socket?.connected && currentUserId) {
    socket.emit("matching:start", { userId: currentUserId });
  }
}

export function cancelMatching(): void {
  if (socket?.connected && currentUserId) {
    socket.emit("matching:cancel", { userId: currentUserId });
  }
}

export function acceptMatch(sessionId: string): void {
  if (socket?.connected && currentUserId) {
    socket.emit("matching:accept", { userId: currentUserId, sessionId });
  }
}

export function declineMatch(sessionId: string): void {
  if (socket?.connected && currentUserId) {
    socket.emit("matching:decline", { userId: currentUserId, sessionId });
  }
}

export function sendMatchingMessage(
  sessionId: string,
  encrypted: string,
): void {
  if (socket?.connected && currentUserId) {
    socket.emit("matching:message", {
      sessionId,
      userId: currentUserId,
      encrypted,
    });
  }
}

export function endMatchSession(sessionId: string): void {
  if (socket?.connected && currentUserId) {
    socket.emit("matching:end_session", { userId: currentUserId, sessionId });
  }
}

export function onMatchingEvent(callback: MatchingCallback): () => void {
  matchingListeners.push(callback);
  return () => {
    const index = matchingListeners.indexOf(callback);
    if (index > -1) matchingListeners.splice(index, 1);
  };
}

/**
 * Bir kullanıcının public key'ini sunucudan gerçek zamanlı sorgula.
 * REST API'ye alternatif — socket üzerinden hızlı yanıt.
 */
export function lookupUserPublicKey(userId: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve(null);
      return;
    }
    socket.emit(
      "user:lookup",
      { userId },
      (result: { publicKey: string | null }) => {
        resolve(result?.publicKey || null);
      },
    );
  });
}

/** Dosya paylaşım bildirimi gönder (direct chat) */
export function sendFileShare(
  to: string,
  fileInfo: {
    fileId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    encryptedKey: string;
  },
): void {
  if (socket?.connected && currentUserId) {
    socket.emit("file:share", {
      to,
      from: currentUserId,
      ...fileInfo,
      timestamp: Date.now(),
    });
  }
}

/** Matching oturumunda dosya paylaşım bildirimi gönder */
export function sendMatchingFileShare(
  sessionId: string,
  fileInfo: {
    fileId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    encryptedKey: string;
  },
): void {
  if (socket?.connected && currentUserId) {
    socket.emit("matching:file_share", {
      sessionId,
      userId: currentUserId,
      ...fileInfo,
      timestamp: Date.now(),
    });
  }
}

/** Dosya paylaşım bildirimlerini dinle */
export function onFileShare(callback: FileShareCallback): () => void {
  fileShareListeners.push(callback);
  return () => {
    const index = fileShareListeners.indexOf(callback);
    if (index > -1) fileShareListeners.splice(index, 1);
  };
}

/** P2P büyük dosya teklifi gönder (alıcıya WebRTC öncesi bildirim) */
export function sendP2PFileOffer(
  to: string,
  info: Omit<P2PFileOffer, "from">,
  toNostrPubkey?: string,
): void {
  if (socket?.connected && currentUserId) {
    socket.emit("p2p:file-offer", {
      to,
      from: currentUserId,
      ...info,
    });
    return;
  }

  if (currentUserId && toNostrPubkey) {
    import("./nostr-signal").then(({ sendNostrSignal }) => {
      sendNostrSignal(toNostrPubkey, "p2p:file-offer", {
        from: currentUserId,
        ...info,
      }).catch(() => {});
    });
  }
}

/** P2P büyük dosya bildirimlerini dinle */
export function onP2PFileIncoming(callback: P2PFileOfferCallback): () => void {
  p2pFileOfferListeners.push(callback);
  return () => {
    const index = p2pFileOfferListeners.indexOf(callback);
    if (index > -1) p2pFileOfferListeners.splice(index, 1);
  };
}

/** WebRTC sinyal olaylarını dinle */
export function onWebRTCSignal(callback: WebRTCSignalCallback): () => void {
  webrtcSignalListeners.push(callback);
  return () => {
    const index = webrtcSignalListeners.indexOf(callback);
    if (index > -1) webrtcSignalListeners.splice(index, 1);
  };
}

/** WebRTC signaling mesajı gönder */
export function sendWebRTCSignal(event: string, data: unknown): void {
  if (socket?.connected) {
    socket.emit(event, { ...(data as object), from: currentUserId });
  }
}

/**
 * Karşı tarafa "seni kişi olarak ekledim" bildirimi gönder.
 * Sunucu hedef çevrimiçiyse anında iletir, değilse bağlanınca teslim eder.
 * Böylece eklenen kişi otomatik olarak bizi de listesinde görür.
 */
export function sendContactAdd(
  to: string,
  publicKey?: string,
  nostrPubkey?: string,
  displayName?: string,
): void {
  if (socket?.connected && currentUserId) {
    socket.emit("contact:add", {
      to,
      from: currentUserId,
      publicKey: publicKey ?? currentPublicKey,
      nostrPubkey,
      displayName,
    });
  }
}

/** Karşı taraf bizi kişi olarak eklediğinde tetiklenir */
export function onContactAdd(callback: ContactAddCallback): () => void {
  contactAddListeners.push(callback);
  return () => {
    const index = contactAddListeners.indexOf(callback);
    if (index > -1) contactAddListeners.splice(index, 1);
  };
}

/** Bir kullanıcı çevrimiçi olduğunda (public key güncellemesi için) */
export function onUserOnline(callback: UserOnlineCallback): () => void {
  userOnlineListeners.push(callback);
  return () => {
    const index = userOnlineListeners.indexOf(callback);
    if (index > -1) userOnlineListeners.splice(index, 1);
  };
}

export async function reconnectWithTor(): Promise<void> {
  if (currentUserId) {
    const userId = currentUserId;
    const publicKey = currentPublicKey;
    disconnect();
    const torSettings = await getTorSettings();
    currentTorSettings = torSettings;
    torEnabled = torSettings.enabled;

    return new Promise((resolve, reject) => {
      initSocket(userId, publicKey)
        .then((newSocket) => {
          const timeout = setTimeout(() => {
            reject(new Error("Connection timeout"));
          }, 10000);

          const onConnect = () => {
            clearTimeout(timeout);
            newSocket.off("connect", onConnect);
            newSocket.off("connect_error", onError);
            resolve();
          };

          const onError = () => {
            clearTimeout(timeout);
            newSocket.off("connect", onConnect);
            newSocket.off("connect_error", onError);
            reject(new Error("Connection failed"));
          };

          if (newSocket.connected) {
            resolve();
          } else {
            newSocket.on("connect", onConnect);
            newSocket.on("connect_error", onError);
          }
        })
        .catch(reject);
    });
  }
}

export async function reconnectToServer(): Promise<void> {
  if (currentUserId) {
    const userId = currentUserId;
    const publicKey = currentPublicKey;
    disconnect();

    return new Promise((resolve, reject) => {
      initSocket(userId, publicKey)
        .then((newSocket) => {
          const timeout = setTimeout(() => {
            reject(new Error("Connection timeout"));
          }, 10000);

          const onConnect = () => {
            clearTimeout(timeout);
            newSocket.off("connect", onConnect);
            newSocket.off("connect_error", onError);
            resolve();
          };

          const onError = () => {
            clearTimeout(timeout);
            newSocket.off("connect", onConnect);
            newSocket.off("connect_error", onError);
            reject(new Error("Connection failed"));
          };

          if (newSocket.connected) {
            resolve();
          } else {
            newSocket.on("connect", onConnect);
            newSocket.on("connect_error", onError);
          }
        })
        .catch(reject);
    });
  }
}
