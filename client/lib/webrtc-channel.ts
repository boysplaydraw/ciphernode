/**
 * webrtc-channel.ts — Kalıcı P2P Bağlantı Yöneticisi
 *
 * Relay sunucusu bağlı olmadığında hem mesajlaşma hem de dosya transferi için
 * kalıcı WebRTC DataChannel bağlantıları kurar ve yönetir.
 *
 * Sinyalleme: Relay bağlıysa socket.io, değilse Nostr üzerinden.
 *
 * Kanal yapısı (peer başına):
 *   "messages" DataChannel → şifreli metin mesajları
 *   Dosya transferi → mevcut webrtc-p2p.ts chunk sistemi kullanılır
 */

import { Platform } from "react-native";
import { isConnected, sendWebRTCSignal, onWebRTCSignal } from "./socket";
import { sendNostrSignal, onNostrSignal } from "./nostr-signal";
import { isWebRTCAvailable } from "./webrtc-p2p";

// Platform-aware RTCPeerConnection
let RTCPeerConnectionImpl: typeof RTCPeerConnection;
let RTCSessionDescriptionImpl: typeof RTCSessionDescription;
let RTCIceCandidateImpl: typeof RTCIceCandidate;

if (Platform.OS === "web") {
  RTCPeerConnectionImpl = globalThis.RTCPeerConnection;
  RTCSessionDescriptionImpl = globalThis.RTCSessionDescription;
  RTCIceCandidateImpl = globalThis.RTCIceCandidate;
} else {
  try {
    const webrtc = require("react-native-webrtc");
    RTCPeerConnectionImpl = webrtc.RTCPeerConnection;
    RTCSessionDescriptionImpl = webrtc.RTCSessionDescription;
    RTCIceCandidateImpl = webrtc.RTCIceCandidate;
  } catch {
    RTCPeerConnectionImpl = null as any;
    RTCSessionDescriptionImpl = null as any;
    RTCIceCandidateImpl = null as any;
  }
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/** Peer başına bağlantı durumu */
interface PeerConnection {
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  peerId: string;
  peerNostrPubkey: string;
  state: "connecting" | "connected" | "closed";
  unsubNostr?: () => void;
  unsubSocket?: () => void;
}

const peers = new Map<string, PeerConnection>();

type MessageCallback = (from: string, encrypted: string, timestamp: number) => void;
const messageListeners: MessageCallback[] = [];

/** Gelen P2P mesajlarını dinle */
export function onP2PMessage(callback: MessageCallback): () => void {
  messageListeners.push(callback);
  return () => {
    const idx = messageListeners.indexOf(callback);
    if (idx > -1) messageListeners.splice(idx, 1);
  };
}

/** Belirtilen peer ile bağlantı kurulmuş mu? */
export function isPeerConnected(peerId: string): boolean {
  const peer = peers.get(peerId);
  return peer?.state === "connected" && peer.channel?.readyState === "open";
}

/**
 * Aktif sinyal kanalını kullanarak sinyal gönder.
 * Relay bağlıysa socket.io, değilse Nostr.
 */
function sendSignal(peerNostrPubkey: string, event: string, data: unknown): void {
  if (isConnected()) {
    sendWebRTCSignal(event, data);
  } else {
    sendNostrSignal(peerNostrPubkey, event, data).catch(() => {});
  }
}

/** DataChannel'ı hazırla */
function setupChannel(peer: PeerConnection, channel: RTCDataChannel): void {
  peer.channel = channel;
  channel.binaryType = "arraybuffer";

  channel.onopen = () => {
    peer.state = "connected";
    console.log(`[P2PChannel] Bağlantı açıldı: ${peer.peerId}`);
  };

  channel.onclose = () => {
    peer.state = "closed";
    console.log(`[P2PChannel] Bağlantı kapandı: ${peer.peerId}`);
    peers.delete(peer.peerId);
  };

  channel.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      // handleChannelMessage grup modülünden sonra tanımlanır — dinamik çağrı
      dispatchChannelMessage(peer.peerId, ev.data);
    }
  };
}

/** Gelen kanal mesajını doğru dinleyiciye ilet (birim veya grup) */
function dispatchChannelMessage(peerId: string, raw: string): void {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.type === "group_message" && parsed.groupId) {
      groupMessageListeners.forEach((cb) =>
        cb(peerId, parsed.groupId, parsed.content ?? "", parsed.encrypted ?? "", parsed.timestamp ?? Date.now()),
      );
    } else {
      messageListeners.forEach((cb) =>
        cb(peerId, parsed.encrypted ?? raw, parsed.timestamp ?? Date.now()),
      );
    }
  } catch {
    messageListeners.forEach((cb) => cb(peerId, raw, Date.now()));
  }
}

/** PeerConnection oluştur ve ICE/sinyal bağlantılarını kur */
function createPeerConnection(peerId: string, peerNostrPubkey: string): PeerConnection {
  const pc = new RTCPeerConnectionImpl({ iceServers: ICE_SERVERS });

  const peer: PeerConnection = {
    pc,
    channel: null,
    peerId,
    peerNostrPubkey,
    state: "connecting",
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendSignal(peerNostrPubkey, "webrtc:channel:ice", {
        peerId,
        candidate: e.candidate,
      });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
      peer.state = "closed";
      peers.delete(peerId);
    }
  };

  return peer;
}

/**
 * Belirtilen peer'a P2P bağlantı iste (teklif yapan taraf).
 * Relay yoksa Nostr üzerinden, varsa socket üzerinden sinyal gönderilir.
 */
export async function connectToPeer(
  peerId: string,
  peerNostrPubkey: string,
): Promise<void> {
  if (!isWebRTCAvailable()) return;
  if (peers.has(peerId)) return; // Zaten bağlı/bağlanıyor

  const peer = createPeerConnection(peerId, peerNostrPubkey);
  peers.set(peerId, peer);

  const channel = peer.pc.createDataChannel("messages", { ordered: true });
  setupChannel(peer, channel);

  // ICE ve answer sinyallerini dinle
  const handleSignal = async (event: string, rawData: unknown) => {
    const data = rawData as any;
    if (event === "webrtc:channel:answer" && data.peerId === peerId) {
      await peer.pc.setRemoteDescription(new RTCSessionDescriptionImpl(data.sdp));
    } else if (event === "webrtc:channel:ice" && data.peerId === peerId) {
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidateImpl(data.candidate));
      } catch {}
    }
  };

  const unsubSocket = onWebRTCSignal(handleSignal);
  const unsubNostr = onNostrSignal(handleSignal);
  peer.unsubSocket = unsubSocket;
  peer.unsubNostr = unsubNostr;

  const offer = await peer.pc.createOffer();
  await peer.pc.setLocalDescription(offer);

  sendSignal(peerNostrPubkey, "webrtc:channel:offer", {
    peerId,
    sdp: peer.pc.localDescription,
  });

  // 30 saniye içinde bağlanmazsa temizle
  setTimeout(() => {
    if (peer.state === "connecting") {
      peer.pc.close();
      peer.unsubSocket?.();
      peer.unsubNostr?.();
      peers.delete(peerId);
    }
  }, 30000);
}

/**
 * Gelen P2P bağlantı teklifini kabul et (teklif alan taraf).
 * onIncomingP2POffer tarafından çağrılır.
 */
export async function acceptPeerConnection(
  peerId: string,
  peerNostrPubkey: string,
  offerSdp: RTCSessionDescriptionInit,
): Promise<void> {
  if (!isWebRTCAvailable()) return;
  if (peers.has(peerId)) return;

  const peer = createPeerConnection(peerId, peerNostrPubkey);
  peers.set(peerId, peer);

  peer.pc.ondatachannel = (e) => {
    setupChannel(peer, e.channel);
  };

  // ICE sinyallerini dinle
  const handleSignal = async (event: string, rawData: unknown) => {
    const data = rawData as any;
    if (event === "webrtc:channel:ice" && data.peerId === peerId) {
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidateImpl(data.candidate));
      } catch {}
    }
  };

  peer.unsubSocket = onWebRTCSignal(handleSignal);
  peer.unsubNostr = onNostrSignal(handleSignal);

  await peer.pc.setRemoteDescription(new RTCSessionDescriptionImpl(offerSdp));
  const answer = await peer.pc.createAnswer();
  await peer.pc.setLocalDescription(answer);

  sendSignal(peerNostrPubkey, "webrtc:channel:answer", {
    peerId,
    sdp: peer.pc.localDescription,
  });
}

/**
 * Gelen WebRTC channel offer'larını işlemek için socket ve Nostr'u dinle.
 * App.tsx veya ChatThreadScreen'de bir kez çağrılmalı.
 */
export function listenForIncomingChannels(
  /** Peer ID'si → Nostr pubkey eşlemesi. Contact listesinden gelir. */
  getPeerNostrPubkey: (peerId: string) => string | undefined,
): () => void {
  const handleSignal = async (event: string, rawData: unknown) => {
    const data = rawData as any;
    if (event !== "webrtc:channel:offer" || !data.peerId) return;

    const peerNostrPubkey = getPeerNostrPubkey(data.peerId);
    if (!peerNostrPubkey) return; // Bilinmeyen peer — reddet

    await acceptPeerConnection(data.peerId, peerNostrPubkey, data.sdp);
  };

  const unsubSocket = onWebRTCSignal(handleSignal);
  const unsubNostr = onNostrSignal(handleSignal);

  return () => {
    unsubSocket();
    unsubNostr();
  };
}

/**
 * P2P üzerinden şifreli mesaj gönder.
 * @returns true = gönderildi, false = kanal kapalı
 */
export function sendP2PMessage(
  peerId: string,
  encrypted: string,
): boolean {
  const peer = peers.get(peerId);
  if (!peer || peer.channel?.readyState !== "open") return false;

  const payload = JSON.stringify({
    type: "message",
    encrypted,
    timestamp: Date.now(),
  });

  peer.channel.send(payload);
  return true;
}

/** Tüm açık P2P bağlantılarını kapat */
export function disconnectAllPeers(): void {
  peers.forEach((peer) => {
    peer.pc.close();
    peer.unsubSocket?.();
    peer.unsubNostr?.();
  });
  peers.clear();
}

// ── Grup P2P ─────────────────────────────────────────────────────────

type GroupMessageCallback = (
  from: string,
  groupId: string,
  content: string,
  encrypted: string,
  timestamp: number,
) => void;
const groupMessageListeners: GroupMessageCallback[] = [];

/** P2P üzerinden gelen grup mesajlarını dinle */
export function onGroupP2PMessage(callback: GroupMessageCallback): () => void {
  groupMessageListeners.push(callback);
  return () => {
    const idx = groupMessageListeners.indexOf(callback);
    if (idx > -1) groupMessageListeners.splice(idx, 1);
  };
}

/** DataChannel üzerinden gelen mesajı işle — grup mesajı kontrolü */
function handleChannelMessage(peerId: string, raw: string): void {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.type === "message" && parsed.encrypted) {
      messageListeners.forEach((cb) =>
        cb(peerId, parsed.encrypted, parsed.timestamp ?? Date.now()),
      );
    } else if (parsed.type === "group_message" && parsed.groupId) {
      groupMessageListeners.forEach((cb) =>
        cb(
          peerId,
          parsed.groupId,
          parsed.content ?? "",
          parsed.encrypted ?? "",
          parsed.timestamp ?? Date.now(),
        ),
      );
    }
  } catch {
    messageListeners.forEach((cb) => cb(peerId, raw, Date.now()));
  }
}

/**
 * Grup mesajını P2P üzerinden tüm üyelere gönder.
 * Relay olmadığında veya zorunlu P2P modunda kullanılır.
 *
 * @param members  [{id, nostrPubkey}] — mesajın gönderileceği üyeler
 * @param groupId  Grup kimliği
 * @param content  Düz metin içerik
 * @param encrypted Şifreli içerik (varsa)
 * @returns Kaç üyeye başarıyla gönderildiği
 */
export async function sendGroupMessageP2P(
  members: Array<{ id: string; nostrPubkey?: string }>,
  groupId: string,
  content: string,
  encrypted: string = "",
): Promise<number> {
  let sent = 0;
  const payload = JSON.stringify({
    type: "group_message",
    groupId,
    content,
    encrypted,
    timestamp: Date.now(),
  });

  for (const member of members) {
    if (!member.nostrPubkey) continue;

    // Bağlantı yoksa kur
    if (!isPeerConnected(member.id)) {
      await connectToPeer(member.id, member.nostrPubkey).catch(() => {});
      // Kısa bekleme — channel açılması için
      await new Promise((r) => setTimeout(r, 800));
    }

    const peer = peers.get(member.id);
    if (peer?.channel?.readyState === "open") {
      peer.channel.send(payload);
      sent++;
    }
  }

  return sent;
}
