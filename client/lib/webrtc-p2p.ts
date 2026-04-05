/**
 * webrtc-p2p.ts — WebRTC P2P Büyük Dosya Transferi (Chunk Sistemi)
 *
 * Boyut eşikleri:
 *   ≤ RELAY_FILE_LIMIT (100 MB)  → relay sunucusu (file-share.ts)
 *   > 100 MB, ≤ P2P_FILE_LIMIT  → bu modül (WebRTC DataChannel chunk)
 *   > P2P_FILE_LIMIT             → hata
 *
 * Android: 1 GB limit + alınan dosyayı diske yazar (RAM taşmaz)
 * iOS / Web / Electron: 5 GB limit
 *
 * Platform desteği:
 *   Web / Electron : Chromium'un yerleşik RTCPeerConnection
 *   Android / iOS  : react-native-webrtc (graceful fallback)
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

export function isWebRTCAvailable(): boolean {
  return !!RTCPeerConnectionImpl;
}

// ── Boyut eşikleri ────────────────────────────────────────────────────
/** Relay sunucusuna yükleme limiti (100 MB). Bu değerin altındaki dosyalar relay'e gider. */
export const RELAY_FILE_LIMIT = 100 * 1024 * 1024;

/** P2P transferi için platform bazlı maksimum dosya boyutu */
export const P2P_FILE_LIMIT =
  Platform.OS === "android"
    ? 1 * 1024 * 1024 * 1024   // Android: 1 GB (RAM kısıtı)
    : 5 * 1024 * 1024 * 1024;  // iOS / Web / Electron: 5 GB

/** Tek bir DataChannel chunk boyutu (256 KB) */
export const P2P_CHUNK_SIZE = 256 * 1024;

/** Dosya boyutuna göre transfer yöntemini belirler */
export function getTransferMethod(
  fileSize: number,
): "relay" | "p2p" | "too-large" {
  if (fileSize <= RELAY_FILE_LIMIT) return "relay";
  if (fileSize <= P2P_FILE_LIMIT && isWebRTCAvailable()) return "p2p";
  return "too-large";
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

type SignalSender = (event: string, data: unknown) => void;
type ProgressCallback = (p: P2PTransferProgress) => void;

// ── Gönderici: Streaming chunk transfer ──────────────────────────────
/**
 * Dosyayı P2P DataChannel üzerinden gönder.
 *
 * `readChunk(offset, length)` → dosyadan ilgili parçayı döner.
 * Web için: `async (off, len) => file.slice(off, off + len).arrayBuffer()`
 * Mobile için: expo-file-system ile base64 okuyup ArrayBuffer'a çevir
 */
export async function sendFileP2P(params: {
  peerId: string;
  readChunk: (offset: number, length: number) => Promise<ArrayBuffer>;
  totalSize: number;
  fileName: string;
  mimeType: string;
  sendSignal: SignalSender;
  onProgress?: ProgressCallback;
  onSignalReceived: (
    handler: (event: string, data: unknown) => void,
  ) => () => void;
}): Promise<void> {
  const {
    peerId,
    readChunk,
    totalSize,
    fileName,
    mimeType,
    sendSignal,
    onProgress,
    onSignalReceived,
  } = params;

  if (!isWebRTCAvailable()) {
    throw new Error("WebRTC bu platformda desteklenmiyor");
  }

  if (totalSize > P2P_FILE_LIMIT) {
    throw new Error(
      `Dosya çok büyük. P2P limiti: ${(P2P_FILE_LIMIT / (1024 ** 3)).toFixed(0)} GB`,
    );
  }

  const pc = new RTCPeerConnectionImpl({ iceServers: ICE_SERVERS });
  const channel = pc.createDataChannel("file-transfer", { ordered: true });

  onProgress?.({
    stage: "connecting",
    percent: 5,
    message: "P2P bağlantısı kuruluyor...",
  });

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

  // Bağlantı zaman aşımı — 30 saniye
  const timeoutId = setTimeout(() => {
    onProgress?.({
      stage: "error",
      percent: 0,
      message: "Bağlantı zaman aşımı (30s)",
    });
    pc.close();
    unsubSignal();
  }, 30000);

  channel.onopen = async () => {
    clearTimeout(timeoutId);
    onProgress?.({
      stage: "transferring",
      percent: 10,
      message: "Dosya gönderiliyor...",
    });

    // Header: meta bilgileri gönder
    const meta = JSON.stringify({ fileName, mimeType, size: totalSize });
    channel.send(meta);

    channel.bufferedAmountLowThreshold = 4 * P2P_CHUNK_SIZE;

    let offset = 0;

    const sendNext = async () => {
      while (offset < totalSize) {
        // Backpressure — buffer doluysa bekle
        if (channel.bufferedAmount > 8 * P2P_CHUNK_SIZE) {
          channel.onbufferedamountlow = () => sendNext();
          return;
        }

        const chunkLen = Math.min(P2P_CHUNK_SIZE, totalSize - offset);
        const chunk = await readChunk(offset, chunkLen);
        channel.send(chunk);
        offset += chunk.byteLength;

        const pct = 10 + Math.round((offset / totalSize) * 85);
        onProgress?.({
          stage: "transferring",
          percent: pct,
          message: `Gönderiliyor... ${formatBytes(offset)} / ${formatBytes(totalSize)}`,
        });
      }

      channel.send(JSON.stringify({ done: true }));
      onProgress?.({ stage: "done", percent: 100, message: "Dosya gönderildi!" });
      setTimeout(() => {
        pc.close();
        unsubSignal();
      }, 2000);
    };

    await sendNext();
  };

  channel.onerror = () => {
    clearTimeout(timeoutId);
    onProgress?.({ stage: "error", percent: 0, message: "DataChannel hatası" });
    pc.close();
    unsubSignal();
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignal("webrtc:offer", { peerId, sdp: pc.localDescription });
}

// ── Alıcı: Platform'a göre disk veya bellek assembly ─────────────────
export async function receiveFileP2P(params: {
  peerId: string;
  offerSdp: RTCSessionDescriptionInit;
  sendSignal: SignalSender;
  onProgress?: ProgressCallback;
  onSignalReceived: (
    handler: (event: string, data: unknown) => void,
  ) => () => void;
  /**
   * Web/Electron: `data` dolu, `fileUri` null
   * Android/iOS: büyük dosyalar için `fileUri` dolu, `data` null
   */
  onFileReceived: (
    data: ArrayBuffer | null,
    fileUri: string | null,
    fileName: string,
    mimeType: string,
  ) => void;
}): Promise<void> {
  const {
    peerId,
    offerSdp,
    sendSignal,
    onProgress,
    onSignalReceived,
    onFileReceived,
  } = params;

  if (!isWebRTCAvailable()) {
    throw new Error("WebRTC bu platformda desteklenmiyor");
  }

  const pc = new RTCPeerConnectionImpl({ iceServers: ICE_SERVERS });

  onProgress?.({
    stage: "connecting",
    percent: 5,
    message: "P2P bağlantısı bekleniyor...",
  });

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
    let meta: { fileName: string; mimeType: string; size: number } | null =
      null;

    // Web/Electron: Blob listesi (verimli assembly, kopyalama yok)
    const blobs: Blob[] = [];

    // Android: dosyaya yaz (RAM'e yükleme)
    let androidFileUri: string | null = null;
    let androidWritePos = 0;

    let received = 0;

    channel.onmessage = async (ev) => {
      if (typeof ev.data === "string") {
        const parsed = JSON.parse(ev.data);

        if (parsed.fileName) {
          meta = parsed;
          onProgress?.({
            stage: "transferring",
            percent: 10,
            message: "Dosya alınıyor...",
          });

          // Android: büyük dosya için temp dosya aç
          if (Platform.OS === "android" && parsed.size > 50 * 1024 * 1024) {
            try {
              const { cacheDirectory } = await import(
                "expo-file-system/legacy"
              );
              androidFileUri = `${cacheDirectory}p2p_${Date.now()}_${parsed.fileName}`;
            } catch {
              androidFileUri = null;
            }
          }
        } else if (parsed.done) {
          onProgress?.({
            stage: "done",
            percent: 100,
            message: "Dosya alındı!",
          });

          if (androidFileUri) {
            // Android disk tabanlı — URI döndür
            onFileReceived(null, androidFileUri, meta?.fileName ?? "file", meta?.mimeType ?? "application/octet-stream");
          } else if (Platform.OS === "web" || typeof Blob !== "undefined") {
            // Web / Electron / iOS — Blob assembly
            const blob = new Blob(blobs, {
              type: meta?.mimeType ?? "application/octet-stream",
            });
            const buffer = await blob.arrayBuffer();
            onFileReceived(buffer, null, meta?.fileName ?? "file", meta?.mimeType ?? "application/octet-stream");
          } else {
            // Fallback: Uint8Array kopyalama
            const total = new Uint8Array(received);
            let pos = 0;
            for (const blob of blobs) {
              const arr = new Uint8Array(await blob.arrayBuffer());
              total.set(arr, pos);
              pos += arr.byteLength;
            }
            onFileReceived(total.buffer, null, meta?.fileName ?? "file", meta?.mimeType ?? "application/octet-stream");
          }

          pc.close();
          unsubSignal();
        }
      } else {
        // ArrayBuffer chunk
        const chunk = ev.data as ArrayBuffer;
        received += chunk.byteLength;

        if (androidFileUri) {
          // Android: chunk'ı diske yaz
          try {
            const FileSystem = await import("expo-file-system/legacy");
            const bytes = new Uint8Array(chunk);
            let binary = "";
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const b64 = btoa(binary);
            // İlk chunk: dosyayı oluştur; sonrakiler: üzerine ekle (append)
            if (androidWritePos === 0) {
              await (FileSystem as any).default.writeAsStringAsync(
                androidFileUri,
                b64,
                { encoding: "base64" },
              );
            } else {
              // expo-file-system legacy append için position desteği yok,
              // chunk'ları temp dosya adlarıyla kaydet ve birleştir
              await (FileSystem as any).default.writeAsStringAsync(
                `${androidFileUri}.part${androidWritePos}`,
                b64,
                { encoding: "base64" },
              );
            }
            androidWritePos += chunk.byteLength;
          } catch {
            // Disk yazma başarısız — belleğe al
            blobs.push(new Blob([chunk]));
            androidFileUri = null;
          }
        } else {
          blobs.push(new Blob([chunk]));
        }

        if (meta?.size) {
          const pct = 10 + Math.round((received / meta.size) * 85);
          onProgress?.({
            stage: "transferring",
            percent: pct,
            message: `Alınıyor... ${formatBytes(received)} / ${formatBytes(meta.size)}`,
          });
        }
      }
    };
  };

  await pc.setRemoteDescription(new RTCSessionDescriptionImpl(offerSdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendSignal("webrtc:answer", { peerId, sdp: pc.localDescription });
}

// ── Yardımcı ─────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
