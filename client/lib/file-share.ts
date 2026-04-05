/**
 * file-share.ts — Şifreli Dosya Paylaşımı
 *
 * Akış:
 * 1. Dosya seç → AES-256 ile şifrele (WebCrypto)
 * 2. AES key'i alıcının OpenPGP public key'i ile şifrele
 * 3. Şifreli dosyayı relay sunucusuna yükle (POST /api/files/upload)
 * 4. fileId + şifreli AES key'i alıcıya socket ile bildir
 * 5. Alıcı: fileId ile dosyayı çeker, kendi private key'i ile AES key'i çözer, dosyayı deşifre eder
 *
 * Relay sunucu ASLA plaintext görmez — sadece şifreli blob saklar.
 */

import * as openpgp from "openpgp";
import { getApiUrl } from "./query-client";
import { Platform } from "react-native";

export interface FileShareProgress {
  stage: "encrypting" | "uploading" | "done" | "error";
  percent: number;
  message: string;
}

export interface IncomingFile {
  from: string;
  fileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  encryptedKey: string;
  timestamp: number;
}

// ── AES-256-GCM ile dosya şifrele ────────────────────────────────────
async function aesEncrypt(data: ArrayBuffer): Promise<{
  encrypted: ArrayBuffer;
  key: CryptoKey;
  iv: Uint8Array;
}> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    data,
  );
  return { encrypted, key, iv };
}

async function aesDecrypt(
  encrypted: ArrayBuffer,
  key: CryptoKey,
  iv: Uint8Array,
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    encrypted,
  );
}

// ── AES key'i dışa aktar ve OpenPGP ile şifrele ───────────────────────
async function encryptAesKey(
  aesKey: CryptoKey,
  iv: Uint8Array,
  recipientPublicKeyArmored: string,
  senderPrivateKeyArmored?: string,
): Promise<string> {
  const rawKey = await crypto.subtle.exportKey("raw", aesKey);
  const keyBytes = new Uint8Array(rawKey);

  // iv + key birleştir
  const combined = new Uint8Array(iv.length + keyBytes.length);
  combined.set(iv, 0);
  combined.set(keyBytes, iv.length);

  const keyBase64 = btoa(String.fromCharCode(...combined));

  const recipientKey = await openpgp.readKey({
    armoredKey: recipientPublicKeyArmored,
  });
  if (senderPrivateKeyArmored) {
    try {
      const privKey = await openpgp.readPrivateKey({
        armoredKey: senderPrivateKeyArmored,
      });
      const result = await openpgp.encrypt({
        message: await openpgp.createMessage({ text: keyBase64 }),
        encryptionKeys: recipientKey,
        signingKeys: privKey,
        format: "armored",
      });
      return result as string;
    } catch {
      // imzalama başarısız, imzasız şifrele
    }
  }

  const result = await openpgp.encrypt({
    message: await openpgp.createMessage({ text: keyBase64 }),
    encryptionKeys: recipientKey,
    format: "armored",
  });
  return result as string;
}

// ── Şifreli AES key'i çöz ─────────────────────────────────────────────
async function decryptAesKey(
  encryptedKey: string,
  privateKeyArmored: string,
): Promise<{ key: CryptoKey; iv: Uint8Array }> {
  const privKey = await openpgp.readPrivateKey({
    armoredKey: privateKeyArmored,
  });
  const message = await openpgp.readMessage({ armoredMessage: encryptedKey });

  const { data } = await openpgp.decrypt({
    message,
    decryptionKeys: privKey,
  });

  const combined = Uint8Array.from(atob(data as string), (c) =>
    c.charCodeAt(0),
  );
  const iv = combined.slice(0, 12);
  const keyBytes = combined.slice(12);

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  return { key, iv };
}

// ── Dosyayı oku ve ArrayBuffer döndür ────────────────────────────────
function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  // Web: FileReader kullan. React Native: Blob.arrayBuffer() kullan
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }
  // React Native — Blob.arrayBuffer() polyfill'i var
  return (file as unknown as Blob).arrayBuffer();
}

// ── ArrayBuffer'ı base64'e dönüştür ──────────────────────────────────
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ── Ana API: Dosya paylaş ─────────────────────────────────────────────
export async function shareFile(params: {
  file?: File;
  // Android native için Blob'dan kaçınmak adına base64 alternatifi:
  fileBase64?: string;
  fileName?: string;
  fileMimeType?: string;
  fileSize?: number;
  recipientPublicKey: string;
  senderPrivateKey?: string;
  scrubMetadata?: boolean; // EXIF/metadata temizle (autoMetadataScrubbing)
  onProgress?: (progress: FileShareProgress) => void;
}): Promise<{
  fileId: string;
  encryptedKey: string;
  downloadUrl: string;
  expiresAt: number;
}> {
  const {
    file: rawFile,
    fileBase64,
    fileName: fileNameParam,
    fileMimeType: fileMimeTypeParam,
    fileSize: fileSizeParam,
    recipientPublicKey,
    senderPrivateKey,
    scrubMetadata,
    onProgress,
  } = params;

  if (!rawFile && !fileBase64) {
    throw new Error("file veya fileBase64 gerekli");
  }

  // Relay limiti — bu sınırın üstündeki dosyalar P2P'ye yönlendirilmeli
  const RELAY_MAX = 100 * 1024 * 1024; // 100 MB
  const checkSize = rawFile?.size ?? fileSizeParam ?? 0;
  if (checkSize > RELAY_MAX) {
    throw new Error(`Dosya relay için çok büyük. Maksimum: 100 MB (mevcut: ${(checkSize / (1024 * 1024)).toFixed(1)} MB). Büyük dosyalar P2P ile gönderilir.`);
  }

  const actualFileName = rawFile?.name || fileNameParam || "file";
  const actualMimeType = rawFile?.type || fileMimeTypeParam || "application/octet-stream";
  const actualFileSize = rawFile?.size || fileSizeParam || 0;

  onProgress?.({
    stage: "encrypting",
    percent: 5,
    message: "Dosya hazırlanıyor...",
  });

  // 0. Metadata temizleme (isteğe bağlı — sadece File nesnesi varsa)
  const file = (rawFile && scrubMetadata) ? await scrubFileMetadata(rawFile) : rawFile;

  onProgress?.({
    stage: "encrypting",
    percent: 10,
    message: "Dosya şifreleniyor...",
  });

  // 1. Dosyayı oku — base64 varsa direkt dönüştür, yoksa FileReader kullan
  let fileData: ArrayBuffer;
  if (fileBase64) {
    fileData = base64ToArrayBuffer(fileBase64);
  } else {
    fileData = await readFileAsArrayBuffer(file!);
  }

  // 2. AES-256-GCM ile şifrele
  const { encrypted, key, iv } = await aesEncrypt(fileData);
  onProgress?.({
    stage: "encrypting",
    percent: 40,
    message: "Anahtar şifreleniyor...",
  });

  // 3. AES key'i alıcının OpenPGP public key'i ile şifrele
  const encryptedKey = await encryptAesKey(
    key,
    iv,
    recipientPublicKey,
    senderPrivateKey,
  );
  onProgress?.({
    stage: "uploading",
    percent: 50,
    message: "Sunucuya yükleniyor...",
  });

  // 4. Şifreli dosyayı base64'e çevir ve relay'e yükle
  const encryptedBase64 = arrayBufferToBase64(encrypted);
  const apiUrl = getApiUrl();

  const response = await fetch(new URL("api/files/upload", apiUrl).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file?.name || actualFileName,
      size: file?.size || actualFileSize,
      mimeType: file?.type || actualMimeType,
      encryptedData: encryptedBase64,
      uploadedBy: "self",
      maxDownloads: 5,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error || "Dosya yüklenemedi");
  }

  const result = await response.json();
  onProgress?.({ stage: "done", percent: 100, message: "Dosya paylaşıldı!" });

  return {
    fileId: result.fileId,
    encryptedKey,
    downloadUrl: result.downloadUrl,
    expiresAt: result.expiresAt,
  };
}

// ── Ana API: Dosya indir ve deşifre et ───────────────────────────────
export async function downloadAndDecryptFile(params: {
  fileId: string;
  encryptedKey: string;
  recipientPrivateKey: string;
  onProgress?: (progress: FileShareProgress) => void;
}): Promise<{ data: Blob | null; dataBase64: string | null; name: string; mimeType: string }> {
  const { fileId, encryptedKey, recipientPrivateKey, onProgress } = params;

  onProgress?.({
    stage: "encrypting",
    percent: 10,
    message: "Dosya indiriliyor...",
  });

  const apiUrl = getApiUrl();
  const response = await fetch(new URL(`api/files/${fileId}`, apiUrl).toString());

  if (!response.ok) {
    const err = await response
      .json()
      .catch(() => ({ error: "Download failed" }));
    throw new Error(err.error || "Dosya indirilemedi");
  }

  const fileData = await response.json();
  onProgress?.({
    stage: "encrypting",
    percent: 50,
    message: "Deşifre ediliyor...",
  });

  // AES key'i çöz
  const { key, iv } = await decryptAesKey(encryptedKey, recipientPrivateKey);

  // Dosyayı deşifre et
  const encryptedBuffer = base64ToArrayBuffer(fileData.encryptedData);
  const decrypted = await aesDecrypt(encryptedBuffer, key, iv);

  onProgress?.({ stage: "done", percent: 100, message: "Dosya hazır!" });

  // Android'de new Blob([ArrayBuffer]) desteklenmez; native için base64 döndür
  if (Platform.OS === "web") {
    return {
      data: new Blob([decrypted], { type: fileData.mimeType }),
      dataBase64: null,
      name: fileData.name,
      mimeType: fileData.mimeType,
    };
  } else {
    return {
      data: null,
      dataBase64: arrayBufferToBase64(decrypted),
      name: fileData.name,
      mimeType: fileData.mimeType,
    };
  }
}

// ── EXIF / Metadata Temizleme ─────────────────────────────────────────
/**
 * Görselden EXIF/metadata siler.
 * Web: Canvas API kullanarak re-encode eder (tüm metadata temizlenir).
 * Mobil: expo-image-manipulator ile yeniden kaydeder.
 * Görsel değilse dosyayı olduğu gibi döner.
 */
export async function scrubFileMetadata(file: File): Promise<File> {
  const isImage = file.type.startsWith("image/") && !file.type.includes("svg");
  if (!isImage) return file;

  try {
    if (Platform.OS === "web" || typeof document !== "undefined") {
      // Web / Electron: Canvas ile yeniden encode et (EXIF temizlenir)
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();

      const outputMime = file.type === "image/png" ? "image/png" : "image/jpeg";
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (b) resolve(b);
            else reject(new Error("Canvas toBlob failed"));
          },
          outputMime,
          0.95,
        );
      });
      return new File([blob], file.name, { type: outputMime });
    } else {
      // Mobil (React Native): expo-image-manipulator
      const { manipulateAsync, SaveFormat } =
        await import("expo-image-manipulator");
      const uri = (file as any).uri || URL.createObjectURL(file);
      const result = await manipulateAsync(uri, [], {
        compress: 0.95,
        format: file.type === "image/png" ? SaveFormat.PNG : SaveFormat.JPEG,
      });
      // Yeni URI'den File nesnesi oluştur
      const response = await fetch(result.uri);
      const blob = await response.blob();
      return new File([blob], file.name, { type: file.type });
    }
  } catch {
    // Temizleme başarısız olursa orijinal dosyayı döndür
    return file;
  }
}

// ── Dosya boyutu formatla ─────────────────────────────────────────────
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ── Dosya türü ikonu ──────────────────────────────────────────────────
export function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "music";
  if (mimeType.includes("pdf")) return "file-text";
  if (
    mimeType.includes("zip") ||
    mimeType.includes("rar") ||
    mimeType.includes("tar")
  )
    return "archive";
  if (mimeType.includes("text")) return "file-text";
  return "file";
}
