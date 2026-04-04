import type { Express } from "express";
import { createServer, type Server } from "node:http";
import { Server as SocketIOServer } from "socket.io";

interface PendingMessage {
  id: string;
  from: string;
  to: string;
  encrypted: string;
  timestamp: number;
  groupId?: string;
  content?: string;
}

interface GroupInfo {
  id: string;
  members: string[];
}

// ── Matching sistemi ──────────────────────────────────────────────────
interface MatchingUser {
  userId: string;
  socketId: string;
  alias: string;
  joinedAt: number;
}

interface MatchSession {
  sessionId: string;
  userA: MatchingUser;
  userB: MatchingUser;
  state: "pending_both" | "pending_b" | "connected" | "ended";
  acceptedBy: Set<string>;
}

const matchingQueue = new Map<string, MatchingUser>(); // userId → MatchingUser
const matchSessions = new Map<string, MatchSession>(); // sessionId → MatchSession
const userToSession = new Map<string, string>(); // userId → sessionId

function generateSessionId(): string {
  return `match_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
}

function generateAlias(): string {
  const adj = [
    "ghost",
    "silent",
    "neon",
    "void",
    "steel",
    "prism",
    "cipher",
    "lunar",
    "dark",
    "binary",
  ];
  const noun = [
    "sparrow",
    "fox",
    "wolf",
    "raven",
    "echo",
    "hawk",
    "storm",
    "drift",
    "tide",
    "shift",
  ];
  return `${adj[Math.floor(Math.random() * adj.length)]}_${noun[Math.floor(Math.random() * noun.length)]}`;
}

// 10 dakika sonra oturumları temizle
setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of matchSessions.entries()) {
    if (now - session.userA.joinedAt > 10 * 60 * 1000) {
      userToSession.delete(session.userA.userId);
      userToSession.delete(session.userB.userId);
      matchSessions.delete(sid);
    }
  }
  // Bekleyen kuyruktan çıkmış kullanıcıları temizle
  for (const [uid, mu] of matchingQueue.entries()) {
    if (now - mu.joinedAt > 5 * 60 * 1000) {
      matchingQueue.delete(uid);
    }
  }
}, 60 * 1000);

const connectedUsers = new Map<string, string>(); // userId → socketId
const userPublicKeys = new Map<string, string>(); // userId → publicKey (kalıcı, yeniden bağlantıda korunur)

// ── Dosya paylaşımı ───────────────────────────────────────────────────
interface SharedFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  encryptedData: string; // base64 şifreli içerik
  uploadedBy: string; // userId (log için değil, TTL temizliği için)
  expiresAt: number;
  downloadCount: number;
  maxDownloads: number;
}
const sharedFiles = new Map<string, SharedFile>();
const FILE_TTL = parseInt(process.env.FILE_TTL_MS || String(24 * 60 * 60 * 1000), 10);
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || "100", 10) * 1024 * 1024;
const MAX_FILE_DOWNLOADS = parseInt(process.env.MAX_FILE_DOWNLOADS || "10", 10);

// Süresi geçen dosyaları RAM'den temizle
setInterval(
  () => {
    const now = Date.now();
    for (const [id, file] of sharedFiles.entries()) {
      if (now > file.expiresAt || file.downloadCount >= file.maxDownloads) {
        sharedFiles.delete(id);
        relayLog(`File expired and removed: ${id}`, "Event: file_expired");
      }
    }
  },
  15 * 60 * 1000,
);
const pendingMessages = new Map<string, PendingMessage[]>();
const groups = new Map<string, GroupInfo>();
const deliveredMessageIds = new Map<string, number>();
const MESSAGE_TTL = parseInt(process.env.MESSAGE_TTL_MS || String(24 * 60 * 60 * 1000), 10);
const DELIVERED_IDS_TTL = 60 * 60 * 1000;

const IS_DEV = process.env.NODE_ENV !== "production";

/** Geliştirme ortamında ayrıntılı log, production'da sadece anonim olay kaydı */
function relayLog(devMsg: string, prodMsg?: string) {
  if (IS_DEV) {
    console.log(`[Relay] ${devMsg}`);
  } else if (prodMsg) {
    console.log(`[Relay] ${prodMsg}`);
  }
}

function generateMessageId(): string {
  return `srv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function cleanupDeliveredIds() {
  const now = Date.now();
  for (const [id, timestamp] of deliveredMessageIds.entries()) {
    if (now - timestamp > DELIVERED_IDS_TTL) {
      deliveredMessageIds.delete(id);
    }
  }
}

setInterval(cleanupDeliveredIds, 5 * 60 * 1000);

function cleanupExpiredMessages() {
  const now = Date.now();
  for (const [userId, messages] of pendingMessages.entries()) {
    const validMessages = messages.filter(
      (msg) => now - msg.timestamp < MESSAGE_TTL,
    );
    if (validMessages.length === 0) {
      pendingMessages.delete(userId);
    } else {
      pendingMessages.set(userId, validMessages);
    }
  }
}

setInterval(cleanupExpiredMessages, 60 * 60 * 1000);

export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  // En son EAS Android build URL'ini döndür
  app.get("/api/latest-apk", async (_req, res) => {
    try {
      const r = await fetch(
        "https://api.expo.dev/v2/projects?slug=ciphernode&owner=merorasto",
        { headers: { Accept: "application/json" } }
      );
      if (!r.ok) return res.json({ url: null });
      const data: any = await r.json();
      const projectId = data?.data?.id;
      if (!projectId) return res.json({ url: null });

      const builds = await fetch(
        `https://api.expo.dev/v2/projects/${projectId}/builds?platform=android&limit=1`,
        { headers: { Accept: "application/json" } }
      );
      if (!builds.ok) return res.json({ url: null });
      const bData: any = await builds.json();
      const apkUrl = bData?.data?.[0]?.artifacts?.applicationArchiveUrl ?? null;
      res.json({ url: apkUrl });
    } catch {
      res.json({ url: null });
    }
  });

  app.get("/api/stats", (_req, res) => {
    res.json({
      connectedUsers: connectedUsers.size,
      pendingMessages: Array.from(pendingMessages.values()).reduce(
        (acc, msgs) => acc + msgs.length,
        0,
      ),
    });
  });

  /**
   * Şifreli dosya yükle — RAM'de saklanır, 24 saat sonra otomatik silinir.
   * Dosya içeriği zaten client tarafında E2EE ile şifrelenmiş olmalı.
   */
  app.post("/api/files/upload", (req, res) => {
    const { name, size, mimeType, encryptedData, uploadedBy, maxDownloads } =
      req.body;

    if (!name || !encryptedData || !uploadedBy) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Boyut kontrolü (base64 %33 overhead → gerçek boyut ≈ encryptedData.length * 0.75)
    const estimatedSize = Math.ceil(encryptedData.length * 0.75);
    if (estimatedSize > MAX_FILE_SIZE) {
      return res.status(413).json({ error: "File too large (max 100MB)" });
    }

    const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 12)}`;
    const file: SharedFile = {
      id: fileId,
      name,
      size: size || estimatedSize,
      mimeType: mimeType || "application/octet-stream",
      encryptedData,
      uploadedBy,
      expiresAt: Date.now() + FILE_TTL,
      downloadCount: 0,
      maxDownloads: maxDownloads || MAX_FILE_DOWNLOADS,
    };

    sharedFiles.set(fileId, file);
    relayLog(
      `File uploaded: ${name} (${file.size} bytes)`,
      "Event: file_uploaded",
    );

    res.json({
      fileId,
      expiresAt: file.expiresAt,
      downloadUrl: `/api/files/${fileId}`,
    });
  });

  /** Şifreli dosyayı indir */
  app.get("/api/files/:fileId", (req, res) => {
    const file = sharedFiles.get(req.params.fileId);

    if (!file) {
      return res.status(404).json({ error: "File not found or expired" });
    }

    if (file.downloadCount >= file.maxDownloads) {
      sharedFiles.delete(req.params.fileId);
      return res.status(410).json({ error: "File download limit reached" });
    }

    file.downloadCount++;
    relayLog(
      `File downloaded: ${file.name} (${file.downloadCount}/${file.maxDownloads})`,
      "Event: file_downloaded",
    );

    res.json({
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      encryptedData: file.encryptedData,
      expiresAt: file.expiresAt,
      remainingDownloads: file.maxDownloads - file.downloadCount,
    });
  });

  /** Dosya meta bilgisi (indirmeden önce önizleme) */
  app.get("/api/files/:fileId/info", (req, res) => {
    const file = sharedFiles.get(req.params.fileId);
    if (!file) {
      return res.status(404).json({ error: "File not found or expired" });
    }
    res.json({
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      expiresAt: file.expiresAt,
      remainingDownloads: file.maxDownloads - file.downloadCount,
    });
  });

  /**
   * Sunucunun .onion adresini döndür (ONION_ADDRESS env var ile ayarlanır)
   * Tor hidden service aktifse bu endpoint üzerinden adres öğrenilebilir
   */
  app.get("/api/onion-address", (_req, res) => {
    const onionAddress = process.env.ONION_ADDRESS || null;
    res.json({ onionAddress });
  });

  /**
   * Kullanıcının açık anahtarını sorgula.
   * Kişi eklerken şifreleme için gerekli public key'i döndürür.
   * Gerçek userId hiçbir zaman client'lar arasında paylaşılmaz — sadece key sorgulanır.
   */
  app.get("/api/users/:userId/publickey", (req, res) => {
    const { userId } = req.params;
    const publicKey = userPublicKeys.get(userId);
    if (!publicKey) {
      return res
        .status(404)
        .json({ error: "User not found or has never connected" });
    }
    res.json({ publicKey });
  });

  // Kişi senkronizasyonu — aynı kimlik farklı cihazlarda kullanıldığında kişiler senkronize olur
  const userContactsStore = new Map<string, any[]>();

  app.post("/api/contacts/:userId", (req, res) => {
    const { userId } = req.params;
    const { contacts } = req.body;
    if (!Array.isArray(contacts)) {
      return res.status(400).json({ error: "contacts must be an array" });
    }
    userContactsStore.set(userId, contacts);
    res.json({ ok: true });
  });

  app.get("/api/contacts/:userId", (req, res) => {
    const { userId } = req.params;
    const contacts = userContactsStore.get(userId) || [];
    res.json({ contacts });
  });

  const httpServer = createServer(app);

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    relayLog(`Client connected: ${socket.id}`, "Client connected");

    socket.on(
      "register",
      (
        data:
          | {
              userId: string;
              publicKey?: string;
              torEnabled?: boolean;
              groups?: string[];
            }
          | string,
      ) => {
        const userId = typeof data === "string" ? data : data.userId;
        const publicKey = typeof data === "object" ? data.publicKey : undefined;
        const userGroups = typeof data === "object" ? data.groups : undefined;

        connectedUsers.set(userId, socket.id);

        // Public key'i kalıcı olarak sakla — kişi eklerken şifreleme için gerekli
        if (publicKey && publicKey.trim()) {
          userPublicKeys.set(userId, publicKey);
        }

        relayLog(`User registered: ${userId}`, "User registered");

        // Kayıt başarılı — client'a bildir (ConnectionStatus "Bağlı" olsun)
        socket.emit("registered");

        // Çevrimiçi olan herkese bu kullanıcının anahtar güncellemesini bildir
        // (Kişi listesinde bu kullanıcı olan ve anahtarı boş olanlar güncellenebilir)
        socket.broadcast.emit("user:online", {
          userId,
          publicKey: publicKey || "",
        });

        if (userGroups && userGroups.length > 0) {
          userGroups.forEach((groupId) => {
            socket.join(groupId);
            const group = groups.get(groupId);
            if (group) {
              if (!group.members.includes(userId)) {
                group.members.push(userId);
              }
            } else {
              groups.set(groupId, { id: groupId, members: [userId] });
            }
          });
          relayLog(
            `User ${userId} rejoined ${userGroups.length} groups`,
            `User rejoined ${userGroups.length} group(s)`,
          );
        }

        const pending = pendingMessages.get(userId);
        if (pending && pending.length > 0) {
          pending.forEach((msg) => {
            if (msg.groupId) {
              socket.emit("group:message", {
                groupId: msg.groupId,
                from: msg.from,
                encrypted: msg.encrypted,
                content: msg.content,
                timestamp: msg.timestamp,
              });
            } else {
              socket.emit("message", msg);
            }
          });
          pendingMessages.delete(userId);
          relayLog(
            `Delivered ${pending.length} pending messages to ${userId}`,
            `Delivered ${pending.length} pending message(s)`,
          );
        }
      },
    );

    socket.on(
      "message",
      (data: {
        to: string;
        from: string;
        encrypted: string;
        id?: string;
        p2pOnly?: boolean;
      }) => {
        const messageId = data.id || generateMessageId();

        if (deliveredMessageIds.has(messageId)) {
          relayLog(
            `Duplicate message ignored: ${messageId}`,
            "Duplicate message ignored",
          );
          return;
        }
        deliveredMessageIds.set(messageId, Date.now());

        const targetSocketId = connectedUsers.get(data.to);
        const timestamp = Date.now();

        if (targetSocketId) {
          io.to(targetSocketId).emit("message", {
            id: messageId,
            from: data.from,
            encrypted: data.encrypted,
            timestamp,
          });
          relayLog(
            `Message delivered: ${data.from} -> ${data.to}`,
            "Event: message_delivered",
          );
        } else if (!data.p2pOnly) {
          // p2pOnly=true ise çevrimdışı kullanıcılar için kuyruklama yok
          const pending = pendingMessages.get(data.to) || [];
          pending.push({
            id: messageId,
            from: data.from,
            to: data.to,
            encrypted: data.encrypted,
            timestamp,
          });
          pendingMessages.set(data.to, pending);
          relayLog(
            `Message queued for offline user: ${data.to}`,
            "Event: message_queued",
          );
        } else {
          relayLog(
            `P2P-only message dropped (recipient offline): ${data.to}`,
            "Event: p2p_message_dropped",
          );
        }
      },
    );

    socket.on(
      "group:create",
      (data: { groupId: string; members: string[] }) => {
        groups.set(data.groupId, { id: data.groupId, members: data.members });
        socket.join(data.groupId);
        relayLog(
          `Group created: ${data.groupId} with ${data.members.length} members`,
          `Event: group_created (${data.members.length} members)`,
        );
      },
    );

    socket.on("group:join", (data: { groupId: string; userId: string }) => {
      const group = groups.get(data.groupId);
      if (group && !group.members.includes(data.userId)) {
        group.members.push(data.userId);
      }
      socket.join(data.groupId);
      relayLog(
        `User ${data.userId} joined group: ${data.groupId}`,
        "Event: group_join",
      );
    });

    socket.on("group:leave", (data: { groupId: string; userId: string }) => {
      const group = groups.get(data.groupId);
      if (group) {
        group.members = group.members.filter((m) => m !== data.userId);
        if (group.members.length === 0) {
          groups.delete(data.groupId);
        }
      }
      socket.leave(data.groupId);
      relayLog(
        `User ${data.userId} left group: ${data.groupId}`,
        "Event: group_leave",
      );
    });

    socket.on(
      "group:message",
      (data: {
        groupId: string;
        from: string;
        encrypted: string;
        content: string;
        id?: string;
      }) => {
        const messageId = data.id || generateMessageId();

        if (deliveredMessageIds.has(messageId)) {
          relayLog(
            `Duplicate group message ignored: ${messageId}`,
            "Duplicate group message ignored",
          );
          return;
        }
        deliveredMessageIds.set(messageId, Date.now());

        const group = groups.get(data.groupId);
        const timestamp = Date.now();

        if (group) {
          group.members.forEach((memberId) => {
            if (memberId !== data.from) {
              const memberSocketId = connectedUsers.get(memberId);
              if (memberSocketId) {
                io.to(memberSocketId).emit("group:message", {
                  id: messageId,
                  groupId: data.groupId,
                  from: data.from,
                  encrypted: data.encrypted,
                  content: data.content,
                  timestamp,
                });
              } else {
                const pending = pendingMessages.get(memberId) || [];
                pending.push({
                  id: messageId,
                  from: data.from,
                  to: memberId,
                  encrypted: data.encrypted,
                  timestamp,
                  groupId: data.groupId,
                  content: data.content,
                });
                pendingMessages.set(memberId, pending);
              }
            }
          });
          relayLog(
            `Group message: ${data.from} -> ${data.groupId}`,
            "Event: group_message_delivered",
          );
        } else {
          io.to(data.groupId).emit("group:message", {
            id: messageId,
            groupId: data.groupId,
            from: data.from,
            encrypted: data.encrypted,
            content: data.content,
            timestamp,
          });
          relayLog(
            `Group message (room): ${data.from} -> ${data.groupId}`,
            "Event: group_message_room",
          );
        }
      },
    );

    // ── WebRTC SIGNALING RELAY ─────────────────────────────────────────
    // Sunucu SDP/ICE mesajlarını sadece yönlendirir — içeriğini görmez

    socket.on("webrtc:offer", (data: { peerId: string; sdp: unknown; from: string }) => {
      const targetSocket = connectedUsers.get(data.peerId);
      if (targetSocket) {
        io.to(targetSocket).emit("webrtc:offer", { peerId: data.from, sdp: data.sdp });
      }
    });

    socket.on("webrtc:answer", (data: { peerId: string; sdp: unknown; from: string }) => {
      const targetSocket = connectedUsers.get(data.peerId);
      if (targetSocket) {
        io.to(targetSocket).emit("webrtc:answer", { peerId: data.from, sdp: data.sdp });
      }
    });

    socket.on("webrtc:ice", (data: { peerId: string; candidate: unknown; from: string }) => {
      const targetSocket = connectedUsers.get(data.peerId);
      if (targetSocket) {
        io.to(targetSocket).emit("webrtc:ice", { peerId: data.from, candidate: data.candidate });
      }
    });

    socket.on("disconnect", () => {
      for (const [userId, socketId] of connectedUsers.entries()) {
        if (socketId === socket.id) {
          connectedUsers.delete(userId);
          relayLog(`User disconnected: ${userId}`, "User disconnected");

          // Matching kuyruğundan çıkar
          matchingQueue.delete(userId);

          // Aktif matching oturumunu sonlandır
          const sessionId = userToSession.get(userId);
          if (sessionId) {
            const session = matchSessions.get(sessionId);
            if (session && session.state !== "ended") {
              session.state = "ended";
              const partnerId =
                session.userA.userId === userId
                  ? session.userB.userId
                  : session.userA.userId;
              const partnerSocketId = connectedUsers.get(partnerId);
              if (partnerSocketId) {
                io.to(partnerSocketId).emit("matching:partner_left");
              }
              userToSession.delete(session.userA.userId);
              userToSession.delete(session.userB.userId);
              matchSessions.delete(sessionId);
            }
          }
          break;
        }
      }
    });

    // ── MATCHING OLAYLARI ──────────────────────────────────────────────

    /** Kullanıcı eşleşme kuyruğuna giriyor */
    socket.on("matching:start", (data: { userId: string }) => {
      const { userId } = data;

      // Zaten aktif oturumu varsa engelle
      if (userToSession.has(userId)) {
        socket.emit("matching:error", { message: "Already in a session" });
        return;
      }

      const alias = generateAlias();
      const me: MatchingUser = {
        userId,
        socketId: socket.id,
        alias,
        joinedAt: Date.now(),
      };

      // Kuyrukta başka biri var mı?
      let paired: MatchingUser | null = null;
      for (const [uid, candidate] of matchingQueue.entries()) {
        if (uid !== userId) {
          paired = candidate;
          matchingQueue.delete(uid);
          break;
        }
      }

      if (paired) {
        // Eşleşme bulundu — oturum oluştur
        const sessionId = generateSessionId();
        const session: MatchSession = {
          sessionId,
          userA: me,
          userB: paired,
          state: "pending_both",
          acceptedBy: new Set(),
        };
        matchSessions.set(sessionId, session);
        userToSession.set(me.userId, sessionId);
        userToSession.set(paired.userId, sessionId);

        // Her iki tarafa eşleşme bildir (gerçek ID paylaşılmaz — sadece alias)
        socket.emit("matching:found", {
          sessionId,
          partnerAlias: paired.alias,
          interests: [],
          trustScore: Math.floor(70 + Math.random() * 30),
        });
        io.to(paired.socketId).emit("matching:found", {
          sessionId,
          partnerAlias: me.alias,
          interests: [],
          trustScore: Math.floor(70 + Math.random() * 30),
        });
        relayLog("Matching session created", "Event: matching_found");
      } else {
        // Kuyruğa gir, bekle
        matchingQueue.set(userId, me);
        socket.emit("matching:queued", { alias });
        relayLog(`User queued for matching`, "Event: matching_queued");
      }
    });

    /** Kullanıcı eşleşmeyi kabul ediyor */
    socket.on(
      "matching:accept",
      (data: { userId: string; sessionId: string }) => {
        const session = matchSessions.get(data.sessionId);
        if (!session || session.state === "ended") return;

        session.acceptedBy.add(data.userId);

        if (session.acceptedBy.size >= 2) {
          // Her iki taraf da kabul etti — bağlantı kur
          session.state = "connected";
          // Geçici, anonim bir session room ID paylaş (gerçek user ID değil)
          const roomId = `anon_${session.sessionId}`;
          socket.join(roomId);
          io.to(session.userA.socketId).emit("matching:connected", {
            sessionId: data.sessionId,
            roomId,
          });
          io.to(session.userB.socketId).emit("matching:connected", {
            sessionId: data.sessionId,
            roomId,
          });
          relayLog(
            "Matching: both accepted, connected",
            "Event: matching_connected",
          );
        } else {
          // Sadece bir taraf kabul etti, diğerini bekle
          const otherUser =
            session.userA.userId === data.userId
              ? session.userB
              : session.userA;
          io.to(otherUser.socketId).emit("matching:partner_accepted");
          relayLog(
            "Matching: one side accepted",
            "Event: matching_one_accepted",
          );
        }
      },
    );

    /** Kullanıcı eşleşmeyi reddediyor */
    socket.on(
      "matching:decline",
      (data: { userId: string; sessionId: string }) => {
        const session = matchSessions.get(data.sessionId);
        if (!session || session.state === "ended") return;

        session.state = "ended";
        const other =
          session.userA.userId === data.userId ? session.userB : session.userA;
        io.to(other.socketId).emit("matching:declined");
        socket.emit("matching:declined_by_you");

        userToSession.delete(session.userA.userId);
        userToSession.delete(session.userB.userId);
        matchSessions.delete(data.sessionId);
        relayLog("Matching: declined", "Event: matching_declined");
      },
    );

    /** Kullanıcı aramayı iptal ediyor */
    socket.on("matching:cancel", (data: { userId: string }) => {
      matchingQueue.delete(data.userId);
      socket.emit("matching:cancelled");
      relayLog("Matching: cancelled", "Event: matching_cancelled");
    });

    /** Anonim oturum mesajı (matching session'da) */
    socket.on(
      "matching:message",
      (data: { sessionId: string; userId: string; encrypted: string }) => {
        const session = matchSessions.get(data.sessionId);
        if (!session || session.state !== "connected") return;

        const other =
          session.userA.userId === data.userId ? session.userB : session.userA;
        io.to(other.socketId).emit("matching:message", {
          encrypted: data.encrypted,
          timestamp: Date.now(),
        });
      },
    );

    /**
     * Dosya paylaşım bildirimi — alıcıya dosya linkini ilet
     * Gerçek dosya içeriği relay'den geçmez, sadece fileId ve meta
     */
    socket.on(
      "file:share",
      (data: {
        to: string;
        fileId: string;
        fileName: string;
        fileSize: number;
        mimeType: string;
        encryptedKey: string; // Alıcının public key'i ile şifrelenmiş AES key
        from: string;
      }) => {
        const targetSocketId = connectedUsers.get(data.to);
        if (targetSocketId) {
          io.to(targetSocketId).emit("file:incoming", {
            from: data.from,
            fileId: data.fileId,
            fileName: data.fileName,
            fileSize: data.fileSize,
            mimeType: data.mimeType,
            encryptedKey: data.encryptedKey,
            timestamp: Date.now(),
          });
          relayLog(
            `File link relayed: ${data.fileName}`,
            "Event: file_link_relayed",
          );
        } else {
          // Çevrimdışı — pending mesaj olarak sakla
          const pending = pendingMessages.get(data.to) || [];
          pending.push({
            id: `file_${data.fileId}`,
            from: data.from,
            to: data.to,
            encrypted: JSON.stringify({
              type: "file",
              fileId: data.fileId,
              fileName: data.fileName,
              fileSize: data.fileSize,
              mimeType: data.mimeType,
              encryptedKey: data.encryptedKey,
            }),
            timestamp: Date.now(),
          });
          pendingMessages.set(data.to, pending);
        }
      },
    );

    /** Matching oturumunda dosya paylaşım bildirimi */
    socket.on(
      "matching:file_share",
      (data: {
        sessionId: string;
        userId: string;
        fileId: string;
        fileName: string;
        fileSize: number;
        mimeType: string;
        encryptedKey: string;
      }) => {
        const session = matchSessions.get(data.sessionId);
        if (!session || session.state !== "connected") return;
        const other =
          session.userA.userId === data.userId ? session.userB : session.userA;
        io.to(other.socketId).emit("matching:file_incoming", {
          fileId: data.fileId,
          fileName: data.fileName,
          fileSize: data.fileSize,
          mimeType: data.mimeType,
          encryptedKey: data.encryptedKey,
          timestamp: Date.now(),
        });
        relayLog(
          `Matching file share: ${data.fileName}`,
          "Event: matching_file_share",
        );
      },
    );

    /** Kullanıcının public key'ini gerçek zamanlı sorgula */
    socket.on(
      "user:lookup",
      (
        data: { userId: string },
        callback: (result: { publicKey: string | null }) => void,
      ) => {
        const publicKey = userPublicKeys.get(data.userId) || null;
        if (typeof callback === "function") {
          callback({ publicKey });
        }
      },
    );

    /** Anonim oturumu sonlandır */
    socket.on(
      "matching:end_session",
      (data: { userId: string; sessionId: string }) => {
        const session = matchSessions.get(data.sessionId);
        if (!session) return;

        session.state = "ended";
        const other =
          session.userA.userId === data.userId ? session.userB : session.userA;
        io.to(other.socketId).emit("matching:session_ended");
        socket.emit("matching:session_ended");

        userToSession.delete(session.userA.userId);
        userToSession.delete(session.userB.userId);
        matchSessions.delete(data.sessionId);
        relayLog("Matching session ended", "Event: matching_session_ended");
      },
    );
  });

  return httpServer;
}
