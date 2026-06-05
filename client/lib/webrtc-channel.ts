import { Platform } from "react-native";
import {
  getCurrentUserId,
  isConnected,
  reportTransportState,
  sendWebRTCSignal,
  onWebRTCSignal,
} from "./socket";
import { sendNostrSignal, onNostrSignal } from "./nostr-signal";
import { isWebRTCAvailable } from "./webrtc-p2p";

let RTCPeerConnectionImpl: typeof RTCPeerConnection | null = null;
let RTCSessionDescriptionImpl: typeof RTCSessionDescription | null = null;
let RTCIceCandidateImpl: typeof RTCIceCandidate | null = null;

if (Platform.OS === "web") {
  RTCPeerConnectionImpl = globalThis.RTCPeerConnection;
  RTCSessionDescriptionImpl = globalThis.RTCSessionDescription;
  RTCIceCandidateImpl = globalThis.RTCIceCandidate;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

type PeerState = "connecting" | "handshaking" | "connected" | "closed" | "failed";

interface PeerConnection {
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  peerId: string;
  peerNostrPubkey: string;
  state: PeerState;
  handshakeComplete: boolean;
  connectTimeout?: ReturnType<typeof setTimeout>;
  unsubNostr?: () => void;
  unsubSocket?: () => void;
}

const peers = new Map<string, PeerConnection>();

type MessageCallback = (
  from: string,
  encrypted: string,
  timestamp: number,
) => void;
const messageListeners: MessageCallback[] = [];

type GroupMessageCallback = (
  from: string,
  groupId: string,
  content: string,
  encrypted: string,
  timestamp: number,
) => void;
const groupMessageListeners: GroupMessageCallback[] = [];

export function onP2PMessage(callback: MessageCallback): () => void {
  messageListeners.push(callback);
  return () => {
    const idx = messageListeners.indexOf(callback);
    if (idx > -1) messageListeners.splice(idx, 1);
  };
}

export function onGroupP2PMessage(callback: GroupMessageCallback): () => void {
  groupMessageListeners.push(callback);
  return () => {
    const idx = groupMessageListeners.indexOf(callback);
    if (idx > -1) groupMessageListeners.splice(idx, 1);
  };
}

export function isPeerConnected(peerId: string): boolean {
  const peer = peers.get(peerId);
  return (
    peer?.state === "connected" &&
    peer.handshakeComplete &&
    peer.channel?.readyState === "open" &&
    peer.pc.connectionState === "connected"
  );
}

function sendSignal(
  peerNostrPubkey: string,
  event: string,
  data: unknown,
): void {
  if (isConnected()) {
    sendWebRTCSignal(event, data);
  } else {
    sendNostrSignal(peerNostrPubkey, event, data).catch((error) => {
      console.warn("[P2PChannel] Nostr signal failed:", error?.message);
    });
  }
}

function clearPeer(peerId: string): void {
  const peer = peers.get(peerId);
  if (!peer) return;
  if (peer.connectTimeout) clearTimeout(peer.connectTimeout);
  peer.unsubSocket?.();
  peer.unsubNostr?.();
  try {
    peer.pc.close();
  } catch {}
  peers.delete(peerId);
}

function markFailed(peer: PeerConnection, reason: string): void {
  peer.state = "failed";
  peer.handshakeComplete = false;
  console.warn(`[P2PChannel] ${reason}: ${peer.peerId}`);
  reportTransportState("p2p_failed", reason);
  clearPeer(peer.peerId);
}

function tryMarkReady(peer: PeerConnection, reason: string): void {
  if (
    peer.handshakeComplete &&
    peer.channel?.readyState === "open" &&
    peer.pc.connectionState === "connected"
  ) {
    peer.state = "connected";
    if (peer.connectTimeout) clearTimeout(peer.connectTimeout);
    console.info(`[P2PChannel] ready: ${peer.peerId} (${reason})`);
    reportTransportState("p2p_ready", reason);
  }
}

function handleTransportControl(peer: PeerConnection, raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.type !== "transport_hello") return false;
    if (parsed.from && parsed.from !== peer.peerId) {
      markFailed(peer, "p2p handshake peer mismatch");
      return true;
    }
    peer.handshakeComplete = true;
    tryMarkReady(peer, "handshake complete");
    return true;
  } catch {
    return false;
  }
}

function dispatchChannelMessage(peerId: string, raw: string): void {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.type === "group_message" && parsed.groupId) {
      groupMessageListeners.forEach((cb) =>
        cb(
          peerId,
          parsed.groupId,
          parsed.content ?? "",
          parsed.encrypted ?? "",
          parsed.timestamp ?? Date.now(),
        ),
      );
      return;
    }
    messageListeners.forEach((cb) =>
      cb(peerId, parsed.encrypted ?? raw, parsed.timestamp ?? Date.now()),
    );
  } catch {
    messageListeners.forEach((cb) => cb(peerId, raw, Date.now()));
  }
}

function setupChannel(peer: PeerConnection, channel: RTCDataChannel): void {
  peer.channel = channel;
  channel.binaryType = "arraybuffer";

  channel.onopen = () => {
    peer.state = "handshaking";
    console.info(`[P2PChannel] data channel open: ${peer.peerId}`);
    channel.send(
      JSON.stringify({
        type: "transport_hello",
        from: getCurrentUserId(),
        timestamp: Date.now(),
      }),
    );
    tryMarkReady(peer, "data channel open");
  };

  channel.onclose = () => markFailed(peer, "data channel closed");
  channel.onerror = () => markFailed(peer, "data channel error");

  channel.onmessage = (ev) => {
    if (typeof ev.data !== "string") return;
    if (!handleTransportControl(peer, ev.data)) {
      dispatchChannelMessage(peer.peerId, ev.data);
    }
  };
}

function createPeerConnection(
  peerId: string,
  peerNostrPubkey: string,
): PeerConnection | null {
  if (!RTCPeerConnectionImpl) return null;
  const pc = new RTCPeerConnectionImpl({ iceServers: ICE_SERVERS });

  const peer: PeerConnection = {
    pc,
    channel: null,
    peerId,
    peerNostrPubkey,
    state: "connecting",
    handshakeComplete: false,
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
    console.info(`[P2PChannel] peer connection ${pc.connectionState}: ${peerId}`);
    if (pc.connectionState === "connected") {
      tryMarkReady(peer, "peer connection connected");
    }
    if (
      pc.connectionState === "failed" ||
      pc.connectionState === "disconnected" ||
      pc.connectionState === "closed"
    ) {
      markFailed(peer, `peer connection ${pc.connectionState}`);
    }
  };

  return peer;
}

export async function connectToPeer(
  peerId: string,
  peerNostrPubkey: string,
): Promise<void> {
  if (!isWebRTCAvailable() || !RTCSessionDescriptionImpl || !RTCIceCandidateImpl) {
    reportTransportState("p2p_failed", "webrtc unavailable");
    return;
  }
  if (isPeerConnected(peerId) || peers.get(peerId)?.state === "connecting") {
    return;
  }

  reportTransportState("p2p_connecting", `dialing ${peerId}`);
  const peer = createPeerConnection(peerId, peerNostrPubkey);
  if (!peer) {
    reportTransportState("p2p_failed", "peer connection unavailable");
    return;
  }
  peers.set(peerId, peer);

  setupChannel(peer, peer.pc.createDataChannel("messages", { ordered: true }));

  const handleSignal = async (event: string, rawData: unknown) => {
    const data = rawData as any;
    if (event === "webrtc:channel:answer" && data.peerId === peerId) {
      await peer.pc.setRemoteDescription(
        new RTCSessionDescriptionImpl(data.sdp),
      );
    } else if (event === "webrtc:channel:ice" && data.peerId === peerId) {
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidateImpl(data.candidate));
      } catch (error) {
        console.warn("[P2PChannel] ICE add failed:", (error as Error)?.message);
      }
    }
  };

  peer.unsubSocket = onWebRTCSignal(handleSignal);
  peer.unsubNostr = onNostrSignal(handleSignal);

  const offer = await peer.pc.createOffer();
  await peer.pc.setLocalDescription(offer);
  sendSignal(peerNostrPubkey, "webrtc:channel:offer", {
    peerId,
    sdp: peer.pc.localDescription,
  });

  peer.connectTimeout = setTimeout(() => {
    if (!isPeerConnected(peerId)) {
      markFailed(peer, "p2p connect timeout");
    }
  }, 30000);
}

export async function acceptPeerConnection(
  peerId: string,
  peerNostrPubkey: string,
  offerSdp: RTCSessionDescriptionInit,
): Promise<void> {
  if (!isWebRTCAvailable() || !RTCSessionDescriptionImpl || !RTCIceCandidateImpl) {
    reportTransportState("p2p_failed", "webrtc unavailable");
    return;
  }
  if (isPeerConnected(peerId) || peers.get(peerId)?.state === "connecting") {
    return;
  }

  reportTransportState("p2p_connecting", `accepting ${peerId}`);
  const peer = createPeerConnection(peerId, peerNostrPubkey);
  if (!peer) {
    reportTransportState("p2p_failed", "peer connection unavailable");
    return;
  }
  peers.set(peerId, peer);
  peer.pc.ondatachannel = (e) => setupChannel(peer, e.channel);

  const handleSignal = async (event: string, rawData: unknown) => {
    const data = rawData as any;
    if (event === "webrtc:channel:ice" && data.peerId === peerId) {
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidateImpl(data.candidate));
      } catch (error) {
        console.warn("[P2PChannel] ICE add failed:", (error as Error)?.message);
      }
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

  peer.connectTimeout = setTimeout(() => {
    if (!isPeerConnected(peerId)) {
      markFailed(peer, "p2p accept timeout");
    }
  }, 30000);
}

export function listenForIncomingChannels(
  getPeerNostrPubkey: (peerId: string) => string | undefined,
): () => void {
  const handleSignal = async (event: string, rawData: unknown) => {
    const data = rawData as any;
    if (event !== "webrtc:channel:offer" || !data.peerId) return;
    const peerNostrPubkey = getPeerNostrPubkey(data.peerId);
    if (!peerNostrPubkey) return;
    await acceptPeerConnection(data.peerId, peerNostrPubkey, data.sdp);
  };

  const unsubSocket = onWebRTCSignal(handleSignal);
  const unsubNostr = onNostrSignal(handleSignal);
  return () => {
    unsubSocket();
    unsubNostr();
  };
}

export function sendP2PMessage(peerId: string, encrypted: string): boolean {
  if (!isPeerConnected(peerId)) return false;
  const peer = peers.get(peerId);
  if (!peer?.channel) return false;
  peer.channel.send(
    JSON.stringify({
      type: "message",
      encrypted,
      timestamp: Date.now(),
    }),
  );
  return true;
}

export function disconnectAllPeers(): void {
  peers.forEach((peer) => {
    peer.state = "closed";
    clearPeer(peer.peerId);
  });
  reportTransportState("relay", "p2p peers disconnected");
}

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
    if (!isPeerConnected(member.id)) {
      await connectToPeer(member.id, member.nostrPubkey).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    const peer = peers.get(member.id);
    if (isPeerConnected(member.id) && peer?.channel?.readyState === "open") {
      peer.channel.send(payload);
      sent++;
    }
  }

  return sent;
}
