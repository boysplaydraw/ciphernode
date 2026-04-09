/**
 * nostr-signal.ts — Nostr Tabanlı WebRTC Sinyalleme (NIP-44)
 *
 * Relay sunucusu bağlı olmadığında WebRTC offer/answer/ICE sinyallerini
 * merkezi olmayan Nostr ağı üzerinden iletir.
 *
 * Şifreleme: NIP-44 (ChaCha20-Poly1305) — NIP-04'ün yerini aldı, Cure53 denetiminden geçti.
 *
 * Platform desteği:
 *   Web / Electron : SubtleCrypto yerleşik — sorunsuz
 *   Android / iOS  : react-native-quick-crypto polyfill gerekebilir
 *
 * Akış:
 *   1. Relay düşer → initNostrSignal() çağrılır
 *   2. 6 ücretsiz public relay'e bağlanılır (birinden yanıt yeterli)
 *   3. WebRTC sinyalleri NIP-44 ile şifrelenir
 *   4. WebRTC bağlantısı kurulunca Nostr yalnızca sinyal kanalı
 *   5. Relay tekrar bağlanınca Nostr bağlantısı kesilebilir
 */

import { finalizeEvent, SimplePool, type Filter } from "nostr-tools";
import * as nip44 from "nostr-tools/nip44";

// Ücretsiz, merkezi olmayan Nostr relay listesi — birinden yanıt yeterli
const PUBLIC_NOSTR_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.wine",
  "wss://relay.snort.social",
];

/**
 * Nostr KIND: Ephemeral event (20000-29999 arası).
 * 20100 = WebRTC sinyalleme — relay'ler genellikle depolamaz, hızlı geçici.
 */
const SIGNAL_KIND = 20100;

let pool: SimplePool | null = null;
let myPrivkeyBytes: Uint8Array | null = null;
let myPubkey: string = "";
let initialized = false;

type SignalHandler = (event: string, data: unknown) => void;
const signalHandlers: SignalHandler[] = [];
let subscription: { close(): void } | null = null;

/**
 * Hex string → Uint8Array dönüşümü
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Nostr sinyallemesini başlat.
 * Relay düştüğünde socket.ts tarafından, P2P modu açıldığında
 * SettingsScreen tarafından çağrılır.
 */
export function initNostrSignal(privkeyHex: string, pubkey: string): void {
  if (initialized && myPubkey === pubkey) return;

  myPrivkeyBytes = hexToBytes(privkeyHex);
  myPubkey = pubkey;

  if (!pool) {
    pool = new SimplePool();
  }

  subscription?.close();

  // Kendi pubkey'imize gelen şifreli olayları dinle
  const filters = [
    {
      kinds: [SIGNAL_KIND],
      "#p": [myPubkey],
      since: Math.floor(Date.now() / 1000) - 60,
    },
  ] as unknown as Filter[];

  subscription = pool.subscribeMany(
    PUBLIC_NOSTR_RELAYS,
    filters as any,
    {
      onevent(event) {
        handleIncomingEvent(event).catch(() => {});
      },
    },
  );

  initialized = true;
  console.log("[NostrSignal] Başlatıldı — NIP-44, 6 relay");
}

/** Nostr sinyallemesini durdur */
export function disconnectNostrSignal(): void {
  subscription?.close();
  subscription = null;
  initialized = false;
  myPrivkeyBytes = null;
  myPubkey = "";
  console.log("[NostrSignal] Bağlantı kesildi");
}

/** Gelen Nostr olayını NIP-44 ile çöz ve işle */
async function handleIncomingEvent(event: {
  pubkey: string;
  content: string;
  tags: string[][];
}): Promise<void> {
  if (!myPrivkeyBytes) return;
  try {
    // NIP-44: gönderenin pubkey'i ile conversation key türet → şifre çöz
    const conversationKey = nip44.v2.utils.getConversationKey(
      myPrivkeyBytes,
      event.pubkey,
    );
    const decrypted = nip44.v2.decrypt(event.content, conversationKey);
    const parsed = JSON.parse(decrypted);

    if (!parsed.event || parsed.data === undefined) return;

    signalHandlers.forEach((cb) => cb(parsed.event, parsed.data));
  } catch {
    // Başka kullanıcıya ait mesaj veya bozuk içerik — sessizce yoksay
  }
}

/**
 * WebRTC sinyalini Nostr üzerinden belirtilen peer'a gönder.
 *
 * @param toPubkey Alıcının Nostr public key'i (hex)
 * @param event    Sinyal tipi: "webrtc:offer" | "webrtc:answer" | "webrtc:ice"
 *                 veya "webrtc:channel:offer" | "webrtc:channel:answer" | "webrtc:channel:ice"
 * @param data     Sinyal verisi (SDP veya ICE candidate)
 */
export async function sendNostrSignal(
  toPubkey: string,
  event: string,
  data: unknown,
): Promise<void> {
  if (!initialized || !pool || !myPrivkeyBytes) {
    console.warn("[NostrSignal] Başlatılmadan sinyal gönderildi — yoksayıldı");
    return;
  }

  try {
    const payload = JSON.stringify({ event, data });

    // NIP-44: alıcının pubkey'i ile conversation key → şifrele
    const conversationKey = nip44.v2.utils.getConversationKey(
      myPrivkeyBytes,
      toPubkey,
    );
    const encrypted = nip44.v2.encrypt(payload, conversationKey);

    const nostrEvent = finalizeEvent(
      {
        kind: SIGNAL_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", toPubkey]],
        content: encrypted,
      },
      myPrivkeyBytes,
    );

    // Tüm relay'lere paralel gönder — birinde başarılı olması yeterli
    const publishPromises = pool!.publish(PUBLIC_NOSTR_RELAYS, nostrEvent);
    const results = await Promise.allSettled(publishPromises);
    const anySuccess = results.some((r) => r.status === "fulfilled");

    if (!anySuccess) {
      console.warn("[NostrSignal] Hiçbir Nostr relay'e ulaşılamadı");
    }
  } catch (err) {
    console.warn("[NostrSignal] Sinyal gönderilemedi:", err);
  }
}

/** Gelen Nostr sinyallerini dinle */
export function onNostrSignal(handler: SignalHandler): () => void {
  signalHandlers.push(handler);
  return () => {
    const idx = signalHandlers.indexOf(handler);
    if (idx > -1) signalHandlers.splice(idx, 1);
  };
}

/** Nostr sinyalleme aktif mi? */
export function isNostrSignalActive(): boolean {
  return initialized;
}

/** Aktif relay sayısını döner (debug için) */
export function getNostrRelayCount(): number {
  return PUBLIC_NOSTR_RELAYS.length;
}
