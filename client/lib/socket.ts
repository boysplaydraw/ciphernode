import { io, Socket } from "socket.io-client";
import { getApiUrl } from "./query-client";
import { getTorSettings, getActiveGroups, type TorSettings } from "./storage";
import { stegEncode, stegDecode } from "./steganography";

let socket: Socket | null = null;
let currentUserId: string | null = null;
let currentPublicKey: string = "";
let torEnabled: boolean = false;
let currentTorSettings: TorSettings | null = null;
let ghostModeEnabled: boolean = false; // Hayalet modu — typing göndermez
let steganographyEnabled: boolean = false; // Steganografi modu — mesajları cover text'e göm
let p2pOnlyEnabled: boolean = false; // Sadece P2P — çevrimdışı kuyruklama yapma

/** Ghost modu aç/kapat */
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

type FileShareCallback = (notification: IncomingFileNotification) => void;

const messageListeners: MessageCallback[] = [];
const groupMessageListeners: GroupMessageCallback[] = [];
const typingListeners: TypingCallback[] = [];
const statusListeners: StatusCallback[] = [];
const torStatusListeners: TorStatusCallback[] = [];
const matchingListeners: MatchingCallback[] = [];
const userOnlineListeners: UserOnlineCallback[] = [];
const fileShareListeners: FileShareCallback[] = [];

export async function initSocket(
  userId: string,
  publicKey: string,
): Promise<Socket> {
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

  socket = io(url, {
    transports: ["websocket", "polling"],
    autoConnect: true,
    timeout: connectionTimeout,
    extraHeaders:
      Object.keys(extraHeaders).length > 0 ? extraHeaders : undefined,
  });

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

  socket.on("connect", async () => {
    if (connectTimeoutId) {
      clearTimeout(connectTimeoutId);
      connectTimeoutId = null;
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

  socket.on("registered", () => {
    statusListeners.forEach((cb) => cb("registered"));
  });

  socket.on("message", (msg) => {
    // Gönderici steganografi kullandıysa otomatik decode et
    const decoded = stegDecode(msg.encrypted);
    const processedMsg = decoded ? { ...msg, encrypted: decoded } : msg;
    messageListeners.forEach((cb) => cb(processedMsg));
  });

  socket.on("group:message", (msg) => {
    groupMessageListeners.forEach((cb) => cb(msg));
  });

  socket.on("typing", (data) => {
    typingListeners.forEach((cb) => cb(data));
  });

  socket.on("disconnect", (reason) => {
    console.warn(`[Socket] Disconnected: ${reason}`);
    statusListeners.forEach((cb) => cb("disconnected"));
  });

  socket.on("connect_error", (err) => {
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
  socket.on("matching:queued", (d) =>
    matchingListeners.forEach((cb) => cb({ type: "queued", alias: d.alias })),
  );
  socket.on("matching:found", (d) =>
    matchingListeners.forEach((cb) =>
      cb({
        type: "found",
        sessionId: d.sessionId,
        partnerAlias: d.partnerAlias,
        trustScore: d.trustScore,
      }),
    ),
  );
  socket.on("matching:partner_accepted", () =>
    matchingListeners.forEach((cb) => cb({ type: "partner_accepted" })),
  );
  socket.on("matching:connected", (d) =>
    matchingListeners.forEach((cb) =>
      cb({ type: "connected", sessionId: d.sessionId, roomId: d.roomId }),
    ),
  );
  socket.on("matching:declined", () =>
    matchingListeners.forEach((cb) => cb({ type: "declined" })),
  );
  socket.on("matching:declined_by_you", () =>
    matchingListeners.forEach((cb) => cb({ type: "declined_by_you" })),
  );
  socket.on("matching:partner_left", () =>
    matchingListeners.forEach((cb) => cb({ type: "partner_left" })),
  );
  socket.on("matching:session_ended", () =>
    matchingListeners.forEach((cb) => cb({ type: "session_ended" })),
  );
  socket.on("matching:cancelled", () =>
    matchingListeners.forEach((cb) => cb({ type: "cancelled" })),
  );
  socket.on("matching:message", (d) =>
    matchingListeners.forEach((cb) =>
      cb({ type: "message", encrypted: d.encrypted, timestamp: d.timestamp }),
    ),
  );
  socket.on("matching:error", (d) =>
    matchingListeners.forEach((cb) =>
      cb({ type: "error", message: d.message }),
    ),
  );

  // Bir kullanıcı çevrimiçi olduğunda public key güncellemesi
  socket.on("user:online", (d: { userId: string; publicKey: string }) => {
    userOnlineListeners.forEach((cb) => cb(d));
  });

  // Dosya paylaşım bildirimi (server "file:incoming" olarak emit ediyor)
  socket.on("file:incoming", (d: IncomingFileNotification) => {
    fileShareListeners.forEach((cb) => cb(d));
  });

  // Matching dosya paylaşımı (server "matching:file_incoming" olarak emit ediyor)
  socket.on(
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

  return socket;
}

export function sendMessage(to: string, encrypted: string, id: string): void {
  if (socket?.connected && currentUserId) {
    const payload = steganographyEnabled ? stegEncode(encrypted) : encrypted;
    socket.emit("message", {
      to,
      from: currentUserId,
      encrypted: payload,
      id,
      p2pOnly: p2pOnlyEnabled || undefined,
    });
  }
}

export function sendGroupMessage(
  groupId: string,
  encrypted: string,
  content: string,
): void {
  if (socket?.connected && currentUserId) {
    socket.emit("group:message", {
      groupId,
      from: currentUserId,
      encrypted,
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
