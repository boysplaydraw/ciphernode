// server/index.ts
import express from "express";

// server/routes.ts
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
var matchingQueue = /* @__PURE__ */ new Map();
var matchSessions = /* @__PURE__ */ new Map();
var userToSession = /* @__PURE__ */ new Map();
function generateSessionId() {
  return `match_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
}
function generateAlias() {
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
    "binary"
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
    "shift"
  ];
  return `${adj[Math.floor(Math.random() * adj.length)]}_${noun[Math.floor(Math.random() * noun.length)]}`;
}
setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of matchSessions.entries()) {
    if (now - session.userA.joinedAt > 10 * 60 * 1e3) {
      userToSession.delete(session.userA.userId);
      userToSession.delete(session.userB.userId);
      matchSessions.delete(sid);
    }
  }
  for (const [uid, mu] of matchingQueue.entries()) {
    if (now - mu.joinedAt > 5 * 60 * 1e3) {
      matchingQueue.delete(uid);
    }
  }
}, 60 * 1e3);
var connectedUsers = /* @__PURE__ */ new Map();
var userPublicKeys = /* @__PURE__ */ new Map();
var sharedFiles = /* @__PURE__ */ new Map();
var FILE_TTL = parseInt(process.env.FILE_TTL_MS || String(24 * 60 * 60 * 1e3), 10);
var MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || "100", 10) * 1024 * 1024;
var MAX_FILE_DOWNLOADS = parseInt(process.env.MAX_FILE_DOWNLOADS || "10", 10);
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
  15 * 60 * 1e3
);
var pendingMessages = /* @__PURE__ */ new Map();
var groups = /* @__PURE__ */ new Map();
var deliveredMessageIds = /* @__PURE__ */ new Map();
var MESSAGE_TTL = parseInt(process.env.MESSAGE_TTL_MS || String(24 * 60 * 60 * 1e3), 10);
var DELIVERED_IDS_TTL = 60 * 60 * 1e3;
var IS_DEV = process.env.NODE_ENV !== "production";
function relayLog(devMsg, prodMsg) {
  if (IS_DEV) {
    console.log(`[Relay] ${devMsg}`);
  } else if (prodMsg) {
    console.log(`[Relay] ${prodMsg}`);
  }
}
function generateMessageId() {
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
setInterval(cleanupDeliveredIds, 5 * 60 * 1e3);
function cleanupExpiredMessages() {
  const now = Date.now();
  for (const [userId, messages] of pendingMessages.entries()) {
    const validMessages = messages.filter(
      (msg) => now - msg.timestamp < MESSAGE_TTL
    );
    if (validMessages.length === 0) {
      pendingMessages.delete(userId);
    } else {
      pendingMessages.set(userId, validMessages);
    }
  }
}
setInterval(cleanupExpiredMessages, 60 * 60 * 1e3);
async function registerRoutes(app2, existingServer) {
  app2.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });
  app2.get("/api/latest-apk", async (_req, res) => {
    try {
      const r = await fetch(
        "https://api.expo.dev/v2/projects?slug=ciphernode&owner=merorasto",
        { headers: { Accept: "application/json" } }
      );
      if (!r.ok) return res.json({ url: null });
      const data = await r.json();
      const projectId = data?.data?.id;
      if (!projectId) return res.json({ url: null });
      const builds = await fetch(
        `https://api.expo.dev/v2/projects/${projectId}/builds?platform=android&limit=1`,
        { headers: { Accept: "application/json" } }
      );
      if (!builds.ok) return res.json({ url: null });
      const bData = await builds.json();
      const apkUrl = bData?.data?.[0]?.artifacts?.applicationArchiveUrl ?? null;
      res.json({ url: apkUrl });
    } catch {
      res.json({ url: null });
    }
  });
  app2.get("/api/stats", (_req, res) => {
    res.json({
      connectedUsers: connectedUsers.size,
      pendingMessages: Array.from(pendingMessages.values()).reduce(
        (acc, msgs) => acc + msgs.length,
        0
      )
    });
  });
  app2.post("/api/files/upload", (req, res) => {
    const { name, size, mimeType, encryptedData, uploadedBy, maxDownloads } = req.body;
    if (!name || !encryptedData || !uploadedBy) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const estimatedSize = Math.ceil(encryptedData.length * 0.75);
    if (estimatedSize > MAX_FILE_SIZE) {
      return res.status(413).json({ error: "File too large (max 100MB)" });
    }
    const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 12)}`;
    const file = {
      id: fileId,
      name,
      size: size || estimatedSize,
      mimeType: mimeType || "application/octet-stream",
      encryptedData,
      uploadedBy,
      expiresAt: Date.now() + FILE_TTL,
      downloadCount: 0,
      maxDownloads: maxDownloads || MAX_FILE_DOWNLOADS
    };
    sharedFiles.set(fileId, file);
    relayLog(
      `File uploaded: ${name} (${file.size} bytes)`,
      "Event: file_uploaded"
    );
    res.json({
      fileId,
      expiresAt: file.expiresAt,
      downloadUrl: `/api/files/${fileId}`
    });
  });
  app2.get("/api/files/:fileId", (req, res) => {
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
      "Event: file_downloaded"
    );
    res.json({
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      encryptedData: file.encryptedData,
      expiresAt: file.expiresAt,
      remainingDownloads: file.maxDownloads - file.downloadCount
    });
  });
  app2.get("/api/files/:fileId/info", (req, res) => {
    const file = sharedFiles.get(req.params.fileId);
    if (!file) {
      return res.status(404).json({ error: "File not found or expired" });
    }
    res.json({
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      expiresAt: file.expiresAt,
      remainingDownloads: file.maxDownloads - file.downloadCount
    });
  });
  app2.get("/api/onion-address", (_req, res) => {
    const onionAddress = process.env.ONION_ADDRESS || null;
    res.json({ onionAddress });
  });
  app2.get("/api/users/:userId/publickey", (req, res) => {
    const { userId } = req.params;
    const publicKey = userPublicKeys.get(userId);
    if (!publicKey) {
      return res.status(404).json({ error: "User not found or has never connected" });
    }
    res.json({ publicKey });
  });
  const userContactsStore = /* @__PURE__ */ new Map();
  app2.post("/api/contacts/:userId", (req, res) => {
    const { userId } = req.params;
    const { contacts } = req.body;
    if (!Array.isArray(contacts)) {
      return res.status(400).json({ error: "contacts must be an array" });
    }
    userContactsStore.set(userId, contacts);
    res.json({ ok: true });
  });
  app2.get("/api/contacts/:userId", (req, res) => {
    const { userId } = req.params;
    const contacts = userContactsStore.get(userId) || [];
    res.json({ contacts });
  });
  const httpServer = existingServer ?? createServer(app2);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
  io.on("connection", (socket) => {
    relayLog(`Client connected: ${socket.id}`, "Client connected");
    socket.on(
      "register",
      (data) => {
        const userId = typeof data === "string" ? data : data.userId;
        const publicKey = typeof data === "object" ? data.publicKey : void 0;
        const userGroups = typeof data === "object" ? data.groups : void 0;
        connectedUsers.set(userId, socket.id);
        if (publicKey && publicKey.trim()) {
          userPublicKeys.set(userId, publicKey);
        }
        relayLog(`User registered: ${userId}`, "User registered");
        socket.emit("registered");
        socket.broadcast.emit("user:online", {
          userId,
          publicKey: publicKey || ""
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
            `User rejoined ${userGroups.length} group(s)`
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
                timestamp: msg.timestamp
              });
            } else {
              socket.emit("message", msg);
            }
          });
          pendingMessages.delete(userId);
          relayLog(
            `Delivered ${pending.length} pending messages to ${userId}`,
            `Delivered ${pending.length} pending message(s)`
          );
        }
      }
    );
    socket.on(
      "message",
      (data) => {
        const messageId = data.id || generateMessageId();
        if (deliveredMessageIds.has(messageId)) {
          relayLog(
            `Duplicate message ignored: ${messageId}`,
            "Duplicate message ignored"
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
            timestamp
          });
          relayLog(
            `Message delivered: ${data.from} -> ${data.to}`,
            "Event: message_delivered"
          );
        } else if (!data.p2pOnly) {
          const pending = pendingMessages.get(data.to) || [];
          pending.push({
            id: messageId,
            from: data.from,
            to: data.to,
            encrypted: data.encrypted,
            timestamp
          });
          pendingMessages.set(data.to, pending);
          relayLog(
            `Message queued for offline user: ${data.to}`,
            "Event: message_queued"
          );
        } else {
          relayLog(
            `P2P-only message dropped (recipient offline): ${data.to}`,
            "Event: p2p_message_dropped"
          );
        }
      }
    );
    socket.on(
      "group:create",
      (data) => {
        groups.set(data.groupId, { id: data.groupId, members: data.members });
        socket.join(data.groupId);
        relayLog(
          `Group created: ${data.groupId} with ${data.members.length} members`,
          `Event: group_created (${data.members.length} members)`
        );
      }
    );
    socket.on("group:join", (data) => {
      const group = groups.get(data.groupId);
      if (group && !group.members.includes(data.userId)) {
        group.members.push(data.userId);
      }
      socket.join(data.groupId);
      relayLog(
        `User ${data.userId} joined group: ${data.groupId}`,
        "Event: group_join"
      );
    });
    socket.on("group:leave", (data) => {
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
        "Event: group_leave"
      );
    });
    socket.on(
      "group:message",
      (data) => {
        const messageId = data.id || generateMessageId();
        if (deliveredMessageIds.has(messageId)) {
          relayLog(
            `Duplicate group message ignored: ${messageId}`,
            "Duplicate group message ignored"
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
                  timestamp
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
                  content: data.content
                });
                pendingMessages.set(memberId, pending);
              }
            }
          });
          relayLog(
            `Group message: ${data.from} -> ${data.groupId}`,
            "Event: group_message_delivered"
          );
        } else {
          io.to(data.groupId).emit("group:message", {
            id: messageId,
            groupId: data.groupId,
            from: data.from,
            encrypted: data.encrypted,
            content: data.content,
            timestamp
          });
          relayLog(
            `Group message (room): ${data.from} -> ${data.groupId}`,
            "Event: group_message_room"
          );
        }
      }
    );
    socket.on("webrtc:offer", (data) => {
      const targetSocket = connectedUsers.get(data.peerId);
      if (targetSocket) {
        io.to(targetSocket).emit("webrtc:offer", { peerId: data.from, sdp: data.sdp });
      }
    });
    socket.on("webrtc:answer", (data) => {
      const targetSocket = connectedUsers.get(data.peerId);
      if (targetSocket) {
        io.to(targetSocket).emit("webrtc:answer", { peerId: data.from, sdp: data.sdp });
      }
    });
    socket.on("webrtc:ice", (data) => {
      const targetSocket = connectedUsers.get(data.peerId);
      if (targetSocket) {
        io.to(targetSocket).emit("webrtc:ice", { peerId: data.from, candidate: data.candidate });
      }
    });
    socket.on(
      "p2p:file-offer",
      (data) => {
        const targetSocket = connectedUsers.get(data.to);
        if (targetSocket) {
          io.to(targetSocket).emit("p2p:file-incoming", {
            from: data.from,
            fileName: data.fileName,
            fileSize: data.fileSize,
            mimeType: data.mimeType
          });
        }
      }
    );
    socket.on("disconnect", () => {
      for (const [userId, socketId] of connectedUsers.entries()) {
        if (socketId === socket.id) {
          connectedUsers.delete(userId);
          relayLog(`User disconnected: ${userId}`, "User disconnected");
          matchingQueue.delete(userId);
          const sessionId = userToSession.get(userId);
          if (sessionId) {
            const session = matchSessions.get(sessionId);
            if (session && session.state !== "ended") {
              session.state = "ended";
              const partnerId = session.userA.userId === userId ? session.userB.userId : session.userA.userId;
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
    socket.on("matching:start", (data) => {
      const { userId } = data;
      if (userToSession.has(userId)) {
        socket.emit("matching:error", { message: "Already in a session" });
        return;
      }
      const alias = generateAlias();
      const me = {
        userId,
        socketId: socket.id,
        alias,
        joinedAt: Date.now()
      };
      let paired = null;
      for (const [uid, candidate] of matchingQueue.entries()) {
        if (uid !== userId) {
          paired = candidate;
          matchingQueue.delete(uid);
          break;
        }
      }
      if (paired) {
        const sessionId = generateSessionId();
        const session = {
          sessionId,
          userA: me,
          userB: paired,
          state: "pending_both",
          acceptedBy: /* @__PURE__ */ new Set()
        };
        matchSessions.set(sessionId, session);
        userToSession.set(me.userId, sessionId);
        userToSession.set(paired.userId, sessionId);
        socket.emit("matching:found", {
          sessionId,
          partnerAlias: paired.alias,
          interests: [],
          trustScore: Math.floor(70 + Math.random() * 30)
        });
        io.to(paired.socketId).emit("matching:found", {
          sessionId,
          partnerAlias: me.alias,
          interests: [],
          trustScore: Math.floor(70 + Math.random() * 30)
        });
        relayLog("Matching session created", "Event: matching_found");
      } else {
        matchingQueue.set(userId, me);
        socket.emit("matching:queued", { alias });
        relayLog(`User queued for matching`, "Event: matching_queued");
      }
    });
    socket.on(
      "matching:accept",
      (data) => {
        const session = matchSessions.get(data.sessionId);
        if (!session || session.state === "ended") return;
        session.acceptedBy.add(data.userId);
        if (session.acceptedBy.size >= 2) {
          session.state = "connected";
          const roomId = `anon_${session.sessionId}`;
          socket.join(roomId);
          io.to(session.userA.socketId).emit("matching:connected", {
            sessionId: data.sessionId,
            roomId
          });
          io.to(session.userB.socketId).emit("matching:connected", {
            sessionId: data.sessionId,
            roomId
          });
          relayLog(
            "Matching: both accepted, connected",
            "Event: matching_connected"
          );
        } else {
          const otherUser = session.userA.userId === data.userId ? session.userB : session.userA;
          io.to(otherUser.socketId).emit("matching:partner_accepted");
          relayLog(
            "Matching: one side accepted",
            "Event: matching_one_accepted"
          );
        }
      }
    );
    socket.on(
      "matching:decline",
      (data) => {
        const session = matchSessions.get(data.sessionId);
        if (!session || session.state === "ended") return;
        session.state = "ended";
        const other = session.userA.userId === data.userId ? session.userB : session.userA;
        io.to(other.socketId).emit("matching:declined");
        socket.emit("matching:declined_by_you");
        userToSession.delete(session.userA.userId);
        userToSession.delete(session.userB.userId);
        matchSessions.delete(data.sessionId);
        relayLog("Matching: declined", "Event: matching_declined");
      }
    );
    socket.on("matching:cancel", (data) => {
      matchingQueue.delete(data.userId);
      socket.emit("matching:cancelled");
      relayLog("Matching: cancelled", "Event: matching_cancelled");
    });
    socket.on(
      "matching:message",
      (data) => {
        const session = matchSessions.get(data.sessionId);
        if (!session || session.state !== "connected") return;
        const other = session.userA.userId === data.userId ? session.userB : session.userA;
        io.to(other.socketId).emit("matching:message", {
          encrypted: data.encrypted,
          timestamp: Date.now()
        });
      }
    );
    socket.on(
      "file:share",
      (data) => {
        const targetSocketId = connectedUsers.get(data.to);
        if (targetSocketId) {
          io.to(targetSocketId).emit("file:incoming", {
            from: data.from,
            fileId: data.fileId,
            fileName: data.fileName,
            fileSize: data.fileSize,
            mimeType: data.mimeType,
            encryptedKey: data.encryptedKey,
            timestamp: Date.now()
          });
          relayLog(
            `File link relayed: ${data.fileName}`,
            "Event: file_link_relayed"
          );
        } else {
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
              encryptedKey: data.encryptedKey
            }),
            timestamp: Date.now()
          });
          pendingMessages.set(data.to, pending);
        }
      }
    );
    socket.on(
      "matching:file_share",
      (data) => {
        const session = matchSessions.get(data.sessionId);
        if (!session || session.state !== "connected") return;
        const other = session.userA.userId === data.userId ? session.userB : session.userA;
        io.to(other.socketId).emit("matching:file_incoming", {
          fileId: data.fileId,
          fileName: data.fileName,
          fileSize: data.fileSize,
          mimeType: data.mimeType,
          encryptedKey: data.encryptedKey,
          timestamp: Date.now()
        });
        relayLog(
          `Matching file share: ${data.fileName}`,
          "Event: matching_file_share"
        );
      }
    );
    socket.on(
      "user:lookup",
      (data, callback) => {
        const publicKey = userPublicKeys.get(data.userId) || null;
        if (typeof callback === "function") {
          callback({ publicKey });
        }
      }
    );
    socket.on(
      "matching:end_session",
      (data) => {
        const session = matchSessions.get(data.sessionId);
        if (!session) return;
        session.state = "ended";
        const other = session.userA.userId === data.userId ? session.userB : session.userA;
        io.to(other.socketId).emit("matching:session_ended");
        socket.emit("matching:session_ended");
        userToSession.delete(session.userA.userId);
        userToSession.delete(session.userB.userId);
        matchSessions.delete(data.sessionId);
        relayLog("Matching session ended", "Event: matching_session_ended");
      }
    );
  });
  return httpServer;
}

// server/index.ts
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
var app = express();
var log = console.log;
app.set("trust proxy", 1);
function setupCors(app2) {
  app2.use((req, res, next) => {
    const origin = req.header("origin");
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Access-Control-Allow-Credentials", "true");
    } else {
      res.header("Access-Control-Allow-Origin", "*");
    }
    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS"
    );
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, bypass-tunnel-reminder, X-Tor-Enabled, X-Tor-Proxy"
    );
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}
function setupBodyParsing(app2) {
  const maxFileSizeMb = parseInt(process.env.MAX_FILE_SIZE_MB || "100", 10);
  app2.use(
    express.json({
      limit: `${maxFileSizeMb + 50}mb`,
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: false, limit: `${maxFileSizeMb + 50}mb` }));
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const path2 = req.path;
    let capturedJsonResponse = void 0;
    const originalResJson = res.json;
    res.json = function(bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!path2.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path2} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    });
    next();
  });
}
function getAppName() {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function serveExpoManifest(platform, res) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}
function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;
  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);
  const html = landingPageTemplate.replace(/BASE_URL_PLACEHOLDER/g, baseUrl).replace(/EXPS_URL_PLACEHOLDER/g, expsUrl).replace(/APP_NAME_PLACEHOLDER/g, appName);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
function configureExpoAndLanding(app2) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  log("Serving static Expo files with dynamic manifest routing");
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }
    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }
    if (req.path === "/") {
      const websitePath = path.resolve(process.cwd(), "website", "index.html");
      const accept = req.header("accept") || "";
      if (accept.includes("text/html") && fs.existsSync(websitePath)) {
        return res.sendFile(websitePath);
      }
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName
      });
    }
    next();
  });
  app2.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app2.use(express.static(path.resolve(process.cwd(), "static-build")));
  const webAppDir = path.resolve(process.cwd(), "dist");
  if (fs.existsSync(webAppDir)) {
    app2.use("/app", express.static(webAppDir));
    app2.get("/app/*", (_req, res) => {
      res.sendFile(path.join(webAppDir, "index.html"));
    });
    log("Web app served at /app");
  }
  const websiteDir = path.resolve(process.cwd(), "website");
  if (fs.existsSync(websiteDir)) {
    app2.use("/website", express.static(websiteDir));
    log("Marketing website served at /website");
  }
  const downloadsDir = path.resolve(process.cwd(), "dist-electron");
  if (fs.existsSync(downloadsDir)) {
    app2.use("/downloads", express.static(downloadsDir, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".exe")) {
          res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
          res.setHeader("Content-Type", "application/octet-stream");
        }
      }
    }));
    log("Downloads served at /downloads");
  }
  log("Expo routing: Checking expo-platform header on / and /manifest");
}
function setupErrorHandler(app2) {
  app2.use((err, _req, res, _next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });
}
function resolveSSLPaths() {
  if (process.env.HTTPS === "false") {
    log("[SSL] HTTPS=false \u2014 HTTP modunda \xE7al\u0131\u015F\u0131l\u0131yor.");
    return null;
  }
  if (fs.existsSync(path.resolve(process.cwd(), ".env"))) {
    try {
      const envContent = fs.readFileSync(path.resolve(process.cwd(), ".env"), "utf-8");
      for (const line of envContent.split("\n")) {
        const eqIdx = line.indexOf("=");
        if (eqIdx < 0) continue;
        const k = line.slice(0, eqIdx).trim();
        const v = line.slice(eqIdx + 1).trim();
        if (k === "SSL_CERT" && !process.env.SSL_CERT) process.env.SSL_CERT = v;
        if (k === "SSL_KEY" && !process.env.SSL_KEY) process.env.SSL_KEY = v;
        if (k === "SSL_DOMAIN" && !process.env.SSL_DOMAIN) process.env.SSL_DOMAIN = v;
      }
    } catch {
    }
  }
  const cert = process.env.SSL_CERT;
  const key = process.env.SSL_KEY;
  const dom = process.env.SSL_DOMAIN;
  if (cert && key) {
    if (fs.existsSync(cert) && fs.existsSync(key)) {
      log(`[SSL] Sertifika y\xFCklendi: ${cert}`);
      return { cert, key };
    }
    log(`[SSL] UYARI: SSL_CERT/SSL_KEY bulunamad\u0131 \u2192 HTTP moduna ge\xE7iliyor.`);
    return null;
  }
  const dockerCert = "/app/ssl/cert.pem";
  const dockerKey = "/app/ssl/key.pem";
  if (fs.existsSync(dockerCert) && fs.existsSync(dockerKey)) {
    log(`[SSL] Docker volume sertifikas\u0131 kullan\u0131l\u0131yor: ${dockerCert}`);
    return { cert: dockerCert, key: dockerKey };
  }
  if (dom) {
    const leCert = `/etc/letsencrypt/live/${dom}/fullchain.pem`;
    const leKey = `/etc/letsencrypt/live/${dom}/privkey.pem`;
    if (fs.existsSync(leCert) && fs.existsSync(leKey)) {
      log(`[SSL] Let's Encrypt sertifikas\u0131 kullan\u0131l\u0131yor: ${dom}`);
      return { cert: leCert, key: leKey };
    }
    const winData = process.env.ProgramData || "C:\\ProgramData";
    const winSslDir = path.join(winData, "CipherNode", "ssl");
    if (fs.existsSync(winSslDir)) {
      const files = fs.readdirSync(winSslDir);
      const certFile = files.find(
        (f) => f.includes(dom) && (f.includes("chain") || f.includes("cert")) && f.endsWith(".pem")
      ) || files.find((f) => f.endsWith(".pem") && !f.includes("key"));
      const keyFile = files.find(
        (f) => f.includes(dom) && f.includes("key") && f.endsWith(".pem")
      ) || files.find((f) => f.includes("key") && f.endsWith(".pem"));
      if (certFile && keyFile) {
        return {
          cert: path.join(winSslDir, certFile),
          key: path.join(winSslDir, keyFile)
        };
      }
    }
    log(`[SSL] '${dom}' i\xE7in sertifika bulunamad\u0131.`);
    log(`[SSL]   Linux  : sudo bash scripts/setup-ssl.sh ${dom}`);
    log(`[SSL]   Windows: powershell -File scripts\\setup-ssl-windows.ps1 -Domain ${dom}`);
    log(`[SSL]   Docker : SSL_DOMAIN=${dom} docker compose up`);
  }
  if (process.env.HTTPS === "true") {
    log("[SSL] HTTPS=true ama sertifika bulunamad\u0131 \u2014 HTTP moduna ge\xE7iliyor.");
    log("[SSL] Docker'da bu normal de\u011Fil; entrypoint script \xE7al\u0131\u015Ft\u0131 m\u0131?");
  }
  return null;
}
(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);
  configureExpoAndLanding(app);
  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || "0.0.0.0";
  const sslPaths = resolveSSLPaths();
  if (sslPaths) {
    const tlsOptions = {
      cert: fs.readFileSync(sslPaths.cert),
      key: fs.readFileSync(sslPaths.key)
    };
    const httpsPort = parseInt(process.env.SSL_PORT || "443", 10);
    const httpsServer = https.createServer(tlsOptions, app);
    await registerRoutes(app, httpsServer);
    setupErrorHandler(app);
    httpsServer.listen(httpsPort, host, () => {
      log(`[SSL] HTTPS sunucusu ${host}:${httpsPort} \xFCzerinde \xE7al\u0131\u015F\u0131yor`);
    });
    const redirectApp = express();
    redirectApp.use((req, res) => {
      const sslDomain = process.env.SSL_DOMAIN || req.headers.host?.replace(/:\d+$/, "") || "";
      if (req.path.startsWith("/.well-known/acme-challenge/")) {
        const challengePath = path.resolve(process.cwd(), "var", "www", "certbot", req.path);
        if (fs.existsSync(challengePath)) {
          return res.sendFile(challengePath);
        }
      }
      res.redirect(301, `https://${sslDomain}${req.url}`);
    });
    const httpRedirectPort = parseInt(process.env.HTTP_REDIRECT_PORT || "80", 10);
    http.createServer(redirectApp).listen(httpRedirectPort, host, () => {
      log(`[SSL] HTTP\u2192HTTPS y\xF6nlendirme sunucusu port ${httpRedirectPort} \xFCzerinde \xE7al\u0131\u015F\u0131yor`);
    });
    log(`[SSL] Sertifika: ${sslPaths.cert}`);
    log(`[SSL] \u0130pucu: Certbot otomatik yenileme i\xE7in 'sudo certbot renew --quiet' cron'a ekleyin.`);
  } else {
    const server = await registerRoutes(app);
    setupErrorHandler(app);
    server.listen(port, host, () => {
      log(`express server serving on ${host}:${port}`);
      if (process.env.SSL_DOMAIN) {
        log(`[SSL] SSL etkinle\u015Ftirmek i\xE7in: sudo bash scripts/setup-ssl.sh ${process.env.SSL_DOMAIN}`);
      }
    });
  }
})();
