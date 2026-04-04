/**
 * webrtc-p2p.ts — WebRTC P2P Dosya ve Mesaj Transferi
 *
 * Platform desteği:
 *   Web / Electron : Chromium'un yerleşik RTCPeerConnection kullanılır
 *   Android / iOS  : react-native-webrtc paketi kullanılır
 *
 * Akış:
 *   1. Gönderici → socket "webrtc:offer" → alıcı
 *   2. Alıcı     → socket "webrtc:answer" → gönderici
 *   3. Her iki taraf ICE adaylarını birbirine "webrtc:ice" ile gönderir
 *   4. Bağlantı kurulunca DataChannel üzerinden şifreli dosya akar
 *
 * Sunucu relay'inin devreye girmediği durumlarda (her iki taraf da erişilebilir)
 * veri tamamen P2P akar; sunucu yalnızca signaling için kullanılır.
 */

import { Platform } from "react-native";

// ── Platform-aware RTCPeerConnection ──────────────────────────────────
let RTCPeerConnectionImpl: typeof RTCPeerConnection;
let RTCSessionDescriptionImpl: typeof RTCSessionDescription;
let RTCIceCandidateImpl: typeof RTCIceCandidate;

if (Platform.OS === "web") {
  RTCPeerConnectionImpl = globalThis.RTCPeerConnection;
  RTCSessionDescriptionImpl = globalThis.RTCSessionDescription;
  RTCIceCandidateImpl = globalThis.RTCIceCandidate;
} else {
  // React Native: react-native-webrtc
  try {
    const webrtc = require("react-native-webrtc");
    RTCPeerConnectionImpl = webrtc.RTCPeerConnection;
    RTCSessionDescriptionImpl = webrtc.RTCSessionDescription;
    RTCIceCandidateImpl = webrtc.RTCIceCandidate;
  } catch {
    // Paket yüklü değilse P2P devre dışı
    RTCPeerConnectionImpl = null as any;
    RTCSessionDescriptionImpl = null as any;
    RTCIceCandidateImpl = null as any;
  }
}

export function isWebRTCAvailable(): boolean {
  return !!RTCPeerConnectionImpl;
}

// ── ICE sunucuları (STUN — ücretsiz Google) ──────────────────────────
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export interface P2PTransferProgress {
  stage: "connecting" | "transferring" | "done" | "error";
  percent: number;
  message: string;
}

export interface P2PSession {
  peerId: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  close: () => void;
}

type SignalSender = (event: string, data: unknown) => void;
type ProgressCallback = (p: P2PTransferProgress) => void;

// ── Gönderici tarafı: Offer oluştur, dosyayı DataChannel üzerinden gönder ──
export async function sendFileP2P(params: {
  peerId: string;
  fileData: ArrayBuffer;
  fileName: string;
  mimeType: string;
  sendSignal: SignalSender;
  onProgress?: ProgressCallback;
  onSignalReceived: (handler: (event: string, data: unknown) => void) => () => void;
}): Promise<void> {
  const { peerId, fileData, fileName, mimeType, sendSignal, onProgress, onSignalReceived } = params;

  if (!isWebRTCAvailable()) {
    throw new Error("WebRTC bu platformda desteklenmiyor");
  }

  const pc = new RTCPeerConnectionImpl({ iceServers: ICE_SERVERS });
  const channel = pc.createDataChannel("file-transfer", {
    ordered: true,
  });

  onProgress?.({ stage: "connecting", percent: 5, message: "P2P bağlantısı kuruluyor..." });

  // Sinyal alıcısı
  const unsubSignal = onSignalReceived(async (event, data: any) => {
    if (event === "webrtc:answer" && data.peerId === peerId) {
      await pc.setRemoteDescription(new RTCSessionDescriptionImpl(data.sdp));
    } else if (event === "webrtc:ice" && data.peerId === peerId) {
      try {
        await pc.addIceCandidate(new RTCIceCandidateImpl(data.candidate));
      } catch {}
    }
  });

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendSignal("webrtc:ice", { peerId, candidate: e.candidate });
    }
  };

  // DataChannel hazır — dosyayı gönder
  channel.onopen = () => {
    onProgress?.({ stage: "transferring", percent: 10, message: "Dosya gönderiliyor..." });

    // Header: meta bilgileri gönder
    const meta = JSON.stringify({ fileName, mimeType, size: fileData.byteLength });
    channel.send(meta);

    // Dosyayı 64KB chunk'larla gönder
    const CHUNK = 65536;
    let offset = 0;

    const sendNext = () => {
      while (offset < fileData.byteLength) {
        const slice = fileData.slice(offset, offset + CHUNK);
        if (channel.bufferedAmount > 16 * CHUNK) {
          // Buffer doldu — backpressure bekle
          channel.onbufferedamountlow = sendNext;
          return;
        }
        channel.send(slice);
        offset += slice.byteLength;
        const pct = 10 + Math.round((offset / fileData.byteLength) * 85);
        onProgress?.({ stage: "transferring", percent: pct, message: `Gönderiliyor... ${pct}%` });
      }
      // Tamamlandı
      channel.send(JSON.stringify({ done: true }));
      onProgress?.({ stage: "done", percent: 100, message: "Dosya gönderildi!" });
      setTimeout(() => { pc.close(); unsubSignal(); }, 2000);
    };

    channel.bufferedAmountLowThreshold = 8 * CHUNK;
    sendNext();
  };

  channel.onerror = () => {
    onProgress?.({ stage: "error", percent: 0, message: "DataChannel hatası" });
    pc.close();
    unsubSignal();
  };

  // Offer oluştur
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignal("webrtc:offer", { peerId, sdp: pc.localDescription });
}

// ── Alıcı tarafı: Answer oluştur, DataChannel'dan dosyayı al ──────────
export async function receiveFileP2P(params: {
  peerId: string;
  offerSdp: RTCSessionDescriptionInit;
  sendSignal: SignalSender;
  onProgress?: ProgressCallback;
  onSignalReceived: (handler: (event: string, data: unknown) => void) => () => void;
  onFileReceived: (data: ArrayBuffer, fileName: string, mimeType: string) => void;
}): Promise<void> {
  const { peerId, offerSdp, sendSignal, onProgress, onSignalReceived, onFileReceived } = params;

  if (!isWebRTCAvailable()) {
    throw new Error("WebRTC bu platformda desteklenmiyor");
  }

  const pc = new RTCPeerConnectionImpl({ iceServers: ICE_SERVERS });

  onProgress?.({ stage: "connecting", percent: 5, message: "P2P bağlantısı bekleniyor..." });

  const unsubSignal = onSignalReceived(async (event, data: any) => {
    if (event === "webrtc:ice" && data.peerId === peerId) {
      try {
        await pc.addIceCandidate(new RTCIceCandidateImpl(data.candidate));
      } catch {}
    }
  });

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendSignal("webrtc:ice", { peerId, candidate: e.candidate });
    }
  };

  pc.ondatachannel = (e) => {
    const channel = e.channel;
    let meta: { fileName: string; mimeType: string; size: number } | null = null;
    const chunks: ArrayBuffer[] = [];
    let received = 0;

    channel.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        const parsed = JSON.parse(ev.data);
        if (parsed.done) {
          // Transfer tamamlandı
          const total = new Uint8Array(received);
          let pos = 0;
          for (const chunk of chunks) {
            total.set(new Uint8Array(chunk), pos);
            pos += chunk.byteLength;
          }
          onProgress?.({ stage: "done", percent: 100, message: "Dosya alındı!" });
          onFileReceived(total.buffer, meta?.fileName ?? "file", meta?.mimeType ?? "application/octet-stream");
          pc.close();
          unsubSignal();
        } else if (parsed.fileName) {
          meta = parsed;
          onProgress?.({ stage: "transferring", percent: 10, message: "Dosya alınıyor..." });
        }
      } else {
        // ArrayBuffer chunk
        chunks.push(ev.data as ArrayBuffer);
        received += (ev.data as ArrayBuffer).byteLength;
        if (meta?.size) {
          const pct = 10 + Math.round((received / meta.size) * 85);
          onProgress?.({ stage: "transferring", percent: pct, message: `Alınıyor... ${pct}%` });
        }
      }
    };
  };

  await pc.setRemoteDescription(new RTCSessionDescriptionImpl(offerSdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendSignal("webrtc:answer", { peerId, sdp: pc.localDescription });
}
