/**
 * steganography.ts — Unicode zero-width karakter steganografisi
 *
 * Şifreli PGP payload'ları zararsız görünen kısa bir "cover text"e
 * gizlenir. Ağ gözlemcileri (sunucu dahil) sadece kısa bir metin görür;
 * gerçek şifreli içerik görünmez Unicode karakterler arasında taşınır.
 *
 * Kodlama şeması:
 *   ZWSP (U+200B) = bit 0
 *   ZWNJ (U+200C) = bit 1
 *   ZWJ  (U+200D) = çerçeve işaretçisi
 *   Başlangıç: ZWJ + ZWJ (arka arkaya iki ZWJ)
 *   Bitiş:     ZWJ (tek ZWJ)
 *
 * Decode her zaman çalışır — alınan mesajda ZW işaretçisi varsa
 * otomatik decode edilir, mod kapalı olsa bile.
 */

const ZWSP = "\u200B"; // 0
const ZWNJ = "\u200C"; // 1
const ZWJ = "\u200D"; // işaretçi

const COVER_TEXTS = [
  "ok",
  "sure",
  "yeah",
  "got it",
  "sounds good",
  "alright",
  "cool",
  "nice",
  "k",
  "yep",
  "noted",
  "ack",
  "👍",
  "seen",
  "good",
  "fine",
];

function randomCover(): string {
  return COVER_TEXTS[Math.floor(Math.random() * COVER_TEXTS.length)];
}

/** UTF-8 string → zero-width karakter dizisi */
function zwEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let result = ZWJ + ZWJ; // başlangıç işaretçisi
  for (const byte of bytes) {
    for (let bit = 7; bit >= 0; bit--) {
      result += (byte >> bit) & 1 ? ZWNJ : ZWSP;
    }
  }
  result += ZWJ; // bitiş işaretçisi
  return result;
}

/** Zero-width karakter dizisi → UTF-8 string, veri yoksa null */
function zwDecode(text: string): string | null {
  const startIdx = text.indexOf(ZWJ + ZWJ);
  if (startIdx === -1) return null;

  // Başlangıç işaretçisinden sonra bitiş işaretçisini bul
  const endIdx = text.indexOf(ZWJ, startIdx + 2);
  if (endIdx === -1) return null;

  const zwChars = text.slice(startIdx + 2, endIdx);
  if (zwChars.length === 0 || zwChars.length % 8 !== 0) return null;

  const bytes: number[] = [];
  for (let i = 0; i < zwChars.length; i += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) {
      if (zwChars[i + bit] === ZWNJ) {
        byte |= 1 << (7 - bit);
      }
    }
    bytes.push(byte);
  }

  try {
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

/**
 * Şifreli PGP payload'ını cover text içine gizle.
 * Sonuç ağ seviyesinde zararsız kısa bir metin gibi görünür.
 */
export function stegEncode(encryptedPayload: string): string {
  const cover = randomCover();
  const hidden = zwEncode(encryptedPayload);
  return cover + hidden;
}

/**
 * Gizli PGP payload'ını çıkarmayı dene.
 * PGP armorlu bir mesaj bulunursa döndürür, aksi halde null.
 * Alınan her mesajda çağrılmalı — gönderici steg kullanıyor olabilir.
 */
export function stegDecode(text: string): string | null {
  const decoded = zwDecode(text);
  if (decoded && decoded.includes("-----BEGIN PGP MESSAGE-----")) {
    return decoded;
  }
  return null;
}

/** Metnin gizli steg verisi içerip içermediğini kontrol et */
export function hasStegPayload(text: string): boolean {
  return text.includes(ZWJ + ZWJ);
}
