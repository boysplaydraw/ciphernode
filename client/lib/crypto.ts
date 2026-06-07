import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import * as openpgp from "openpgp";
import { Buffer } from "buffer";
import {
  generateSecretKey,
  getPublicKey as nostrGetPublicKey,
} from "nostr-tools";

// SecureStore (native) anahtarları yalnızca [A-Za-z0-9._-] içerebilir; "@" ve "/" geçersizdir.
// Web localStorage kullandığından eski anahtar orada sorunsuz — mevcut web kimliklerini
// korumak için web'de eski anahtarı tutuyoruz, native'de geçerli bir anahtara geçiyoruz.
const IDENTITY_STORAGE_KEY =
  Platform.OS === "web" ? "@ciphernode/identity" : "ciphernode_identity";
const IDENTITY_BACKUP_SALT_BYTES = 16;
const IDENTITY_BACKUP_IV_BYTES = 12;
const IDENTITY_BACKUP_TAG_BYTES = 16;
const IDENTITY_BACKUP_KEY_BYTES = 32;
const IDENTITY_BACKUP_PBKDF2_ITERATIONS = 210_000;

export interface UserIdentity {
  id: string;
  publicKey: string;
  privateKey: string;
  fingerprint: string;
  displayName: string;
  createdAt: number;
  /** Nostr secp256k1 private key (hex) — P2P sinyalleme için */
  nostrPrivkey?: string;
  /** Nostr secp256k1 public key (hex) — kişilere paylaşılır */
  nostrPubkey?: string;
}

export interface Contact {
  id: string;
  publicKey: string;
  fingerprint: string;
  displayName: string;
  addedAt: number;
  /** Karşı tarafın Nostr public key'i — relay yokken P2P sinyalleme için */
  nostrPubkey?: string;
}

/** Nostr keypair üret (secp256k1) */
export function generateNostrKeyPair(): {
  nostrPrivkey: string;
  nostrPubkey: string;
} {
  const secretKey = generateSecretKey();
  const pubkey = nostrGetPublicKey(secretKey);
  const privkey = bytesToHex(secretKey);
  return { nostrPrivkey: privkey, nostrPubkey: pubkey };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function generateShortId(fingerprint: string): string {
  const clean = fingerprint.replace(/\s/g, "").toUpperCase();
  const part1 = clean.slice(0, 4);
  const part2 = clean.slice(4, 8);
  return `${part1}-${part2}`;
}

export async function generateKeyPair(rsaBits: 2048 | 3072 | 4096 = 4096): Promise<{
  publicKey: string;
  privateKey: string;
  fingerprint: string;
  id: string;
}> {
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: "rsa",
    rsaBits,
    userIDs: [{ name: "CipherNode User" }],
    format: "armored",
  });

  const publicKeyObj = await openpgp.readKey({ armoredKey: publicKey });
  const fingerprint = publicKeyObj.getFingerprint().toUpperCase();
  const id = generateShortId(fingerprint);

  return { publicKey, privateKey, fingerprint, id };
}

export async function getOrCreateIdentity(): Promise<UserIdentity> {
  let stored = Platform.OS === "web" 
    ? await AsyncStorage.getItem(IDENTITY_STORAGE_KEY)
    : await SecureStore.getItemAsync(IDENTITY_STORAGE_KEY);

  // Migrate old plaintext keys on native platforms
  if (!stored && Platform.OS !== "web") {
    stored = await AsyncStorage.getItem(IDENTITY_STORAGE_KEY);
    if (stored) {
      await SecureStore.setItemAsync(IDENTITY_STORAGE_KEY, stored);
      await AsyncStorage.removeItem(IDENTITY_STORAGE_KEY);
    }
  }

  if (stored) {
    const parsed: UserIdentity = JSON.parse(stored);
    // Bozuk/boş anahtarla kaydedilmiş eski veriyi temizle ve yeniden üret
    if (!parsed.publicKey || !parsed.privateKey) {
      if (Platform.OS === "web") await AsyncStorage.removeItem(IDENTITY_STORAGE_KEY);
      else await SecureStore.deleteItemAsync(IDENTITY_STORAGE_KEY);
      return getOrCreateIdentity();
    }
    // id alanı yoksa fingerprint'ten türet ve kaydet
    if (!parsed.id && parsed.fingerprint) {
      parsed.id = generateShortId(parsed.fingerprint);
    }
    // Eski kimlikte Nostr key yoksa üret ve kaydet (geriye dönük uyumluluk)
    if (!parsed.nostrPrivkey || !parsed.nostrPubkey) {
      const nostrKeys = generateNostrKeyPair();
      parsed.nostrPrivkey = nostrKeys.nostrPrivkey;
      parsed.nostrPubkey = nostrKeys.nostrPubkey;
    }
    if (Platform.OS === "web") await AsyncStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(parsed));
    else await SecureStore.setItemAsync(IDENTITY_STORAGE_KEY, JSON.stringify(parsed));
    return parsed;
  }

  // Hata durumunda boş key fallback'e DÜŞME — hatayı yukarı fırlat
  const { publicKey, privateKey, fingerprint, id } = await generateKeyPair();
  const { nostrPrivkey, nostrPubkey } = generateNostrKeyPair();

  const identity: UserIdentity = {
    id,
    publicKey,
    privateKey,
    fingerprint,
    displayName: "",
    createdAt: Date.now(),
    nostrPrivkey,
    nostrPubkey,
  };

  if (Platform.OS === "web") await AsyncStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  else await SecureStore.setItemAsync(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export async function getIdentity(): Promise<UserIdentity | null> {
  try {
    let stored = Platform.OS === "web" 
      ? await AsyncStorage.getItem(IDENTITY_STORAGE_KEY)
      : await SecureStore.getItemAsync(IDENTITY_STORAGE_KEY);
    
    // Fallback migration check for getIdentity
    if (!stored && Platform.OS !== "web") {
      stored = await AsyncStorage.getItem(IDENTITY_STORAGE_KEY);
      if (stored) {
        await SecureStore.setItemAsync(IDENTITY_STORAGE_KEY, stored);
        await AsyncStorage.removeItem(IDENTITY_STORAGE_KEY);
      }
    }
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export async function updateDisplayName(name: string): Promise<void> {
  const identity = await getIdentity();
  if (identity) {
    identity.displayName = name;
    if (Platform.OS === "web") await AsyncStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
    else await SecureStore.setItemAsync(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  }
}

export async function regenerateIdentity(): Promise<UserIdentity> {
  if (Platform.OS === "web") await AsyncStorage.removeItem(IDENTITY_STORAGE_KEY);
  else await SecureStore.deleteItemAsync(IDENTITY_STORAGE_KEY);
  return getOrCreateIdentity();
}

export async function encryptMessage(
  message: string,
  recipientPublicKey: string,
  senderPrivateKey?: string,
): Promise<string> {
  if (!recipientPublicKey) {
    throw new Error("Encryption failed: Recipient public key is missing");
  }

  try {
    const publicKey = await openpgp.readKey({ armoredKey: recipientPublicKey });

    const encryptionOptions: {
      message: openpgp.Message<string>;
      encryptionKeys: openpgp.Key;
      signingKeys?: openpgp.PrivateKey;
    } = {
      message: await openpgp.createMessage({ text: message }),
      encryptionKeys: publicKey,
    };

    if (senderPrivateKey) {
      const privateKey = await openpgp.readPrivateKey({
        armoredKey: senderPrivateKey,
      });
      encryptionOptions.signingKeys = privateKey;
    }

    const encrypted = await openpgp.encrypt(encryptionOptions);

    return encrypted as string;
  } catch (error) {
    // Düz metin ASLA döndürme — E2EE ihlali olur
    throw new Error(
      `Encryption failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function decryptMessage(
  encryptedMessage: string,
  privateKeyArmored: string,
  senderPublicKey?: string,
): Promise<{ content: string; verified: boolean }> {
  if (
    !privateKeyArmored ||
    !encryptedMessage.includes("-----BEGIN PGP MESSAGE-----")
  ) {
    return { content: "[Decryption Failed]", verified: false };
  }

  try {
    const privateKey = await openpgp.readPrivateKey({
      armoredKey: privateKeyArmored,
    });

    const message = await openpgp.readMessage({
      armoredMessage: encryptedMessage,
    });

    const decryptOptions: {
      message: openpgp.Message<openpgp.MaybeStream<string>>;
      decryptionKeys: openpgp.PrivateKey;
      verificationKeys?: openpgp.Key;
    } = {
      message,
      decryptionKeys: privateKey,
    };

    if (senderPublicKey) {
      const publicKey = await openpgp.readKey({ armoredKey: senderPublicKey });
      decryptOptions.verificationKeys = publicKey;
    }

    const { data: decrypted, signatures } =
      await openpgp.decrypt(decryptOptions);

    let verified = false;
    if (signatures && signatures.length > 0 && senderPublicKey) {
      try {
        await signatures[0].verified;
        verified = true;
      } catch {
        verified = false;
      }
    }

    return { content: decrypted as string, verified };
  } catch (error) {
    console.error("Decryption error:", error);
    return { content: "[Decryption Failed]", verified: false };
  }
}

export function parseContactId(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const match = cleaned.match(/^([A-Z0-9]{4})-?([A-Z0-9]{4})$/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  return null;
}

export async function parsePublicKeyFingerprint(
  publicKeyArmored: string,
): Promise<string> {
  const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
  return publicKey.getFingerprint().toUpperCase();
}

export async function signMessage(
  message: string,
  privateKeyArmored: string,
): Promise<string> {
  try {
    const privateKey = await openpgp.readPrivateKey({
      armoredKey: privateKeyArmored,
    });

    const signed = await openpgp.sign({
      message: await openpgp.createCleartextMessage({ text: message }),
      signingKeys: privateKey,
    });

    return signed;
  } catch (error) {
    console.error("Signing error:", error);
    throw new Error("Signing failed: " + (error instanceof Error ? error.message : String(error)));
  }
}

export async function verifySignature(
  signedMessage: string,
  publicKeyArmored: string,
): Promise<{ verified: boolean; content: string }> {
  try {
    const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });

    const verified = await openpgp.verify({
      message: await openpgp.readCleartextMessage({
        cleartextMessage: signedMessage,
      }),
      verificationKeys: publicKey,
    });

    const { verified: verificationResult, data } = verified.signatures[0]
      ? { verified: await verified.signatures[0].verified, data: verified.data }
      : { verified: false, data: signedMessage };

    return { verified: verificationResult, content: data as string };
  } catch (error) {
    console.error("Verification error:", error);
    return { verified: false, content: signedMessage };
  }
}

export async function exportPublicKey(identity: UserIdentity): Promise<string> {
  return identity.publicKey;
}

async function getSubtleCrypto(): Promise<SubtleCrypto | null> {
  return globalThis.crypto?.subtle ?? null;
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function encryptWithQuickCrypto(
  plaintext: string,
  password: string,
  salt: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const quickCrypto = await import("react-native-quick-crypto");
  const key = quickCrypto.default.pbkdf2Sync(
    password,
    quickCrypto.Buffer.from(salt),
    IDENTITY_BACKUP_PBKDF2_ITERATIONS,
    IDENTITY_BACKUP_KEY_BYTES,
    "sha256",
  );
  const cipher = quickCrypto.default.createCipheriv(
    "aes-256-gcm",
    key,
    quickCrypto.Buffer.from(iv),
  );
  const ciphertext = quickCrypto.Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return new Uint8Array(quickCrypto.Buffer.concat([ciphertext, tag]));
}

async function decryptWithQuickCrypto(
  ciphertextWithTag: Uint8Array,
  password: string,
  salt: Uint8Array,
  iv: Uint8Array,
): Promise<string> {
  if (ciphertextWithTag.length <= IDENTITY_BACKUP_TAG_BYTES) {
    throw new Error("Invalid encrypted identity backup");
  }

  const quickCrypto = await import("react-native-quick-crypto");
  const key = quickCrypto.default.pbkdf2Sync(
    password,
    quickCrypto.Buffer.from(salt),
    IDENTITY_BACKUP_PBKDF2_ITERATIONS,
    IDENTITY_BACKUP_KEY_BYTES,
    "sha256",
  );
  const tag = quickCrypto.Buffer.from(
    ciphertextWithTag.slice(-IDENTITY_BACKUP_TAG_BYTES),
  );
  const ciphertext = quickCrypto.Buffer.from(
    ciphertextWithTag.slice(0, -IDENTITY_BACKUP_TAG_BYTES),
  );
  const decipher = quickCrypto.default.createDecipheriv(
    "aes-256-gcm",
    key,
    quickCrypto.Buffer.from(iv),
  );
  decipher.setAuthTag(tag);
  return quickCrypto.Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

export async function exportIdentityEncrypted(
  identity: UserIdentity,
  password: string,
): Promise<string> {
  if (!password) {
    throw new Error("Password is required");
  }

  const salt = await Crypto.getRandomBytesAsync(IDENTITY_BACKUP_SALT_BYTES);
  const iv = await Crypto.getRandomBytesAsync(IDENTITY_BACKUP_IV_BYTES);
  const plaintext = JSON.stringify(identity);
  const subtle = await getSubtleCrypto();

  let ciphertextWithTag: Uint8Array;
  if (subtle) {
    const passwordKey = await subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    const key = await subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: bytesToArrayBuffer(salt),
        iterations: IDENTITY_BACKUP_PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      passwordKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );
    const encrypted = await subtle.encrypt(
      { name: "AES-GCM", iv: bytesToArrayBuffer(iv) },
      key,
      new TextEncoder().encode(plaintext),
    );
    ciphertextWithTag = new Uint8Array(encrypted);
  } else {
    ciphertextWithTag = await encryptWithQuickCrypto(
      plaintext,
      password,
      salt,
      iv,
    );
  }

  return bytesToBase64(concatBytes(salt, iv, ciphertextWithTag));
}

export async function importIdentityEncrypted(
  encryptedData: string,
  password: string,
): Promise<UserIdentity> {
  if (!password) {
    throw new Error("Password is required");
  }

  const data = base64ToBytes(encryptedData);
  const minLength =
    IDENTITY_BACKUP_SALT_BYTES +
    IDENTITY_BACKUP_IV_BYTES +
    IDENTITY_BACKUP_TAG_BYTES +
    1;
  if (data.length < minLength) {
    throw new Error("Invalid encrypted identity backup");
  }

  const salt = data.slice(0, IDENTITY_BACKUP_SALT_BYTES);
  const iv = data.slice(
    IDENTITY_BACKUP_SALT_BYTES,
    IDENTITY_BACKUP_SALT_BYTES + IDENTITY_BACKUP_IV_BYTES,
  );
  const ciphertextWithTag = data.slice(
    IDENTITY_BACKUP_SALT_BYTES + IDENTITY_BACKUP_IV_BYTES,
  );
  const subtle = await getSubtleCrypto();

  let decryptedJson: string;
  if (subtle) {
    const passwordKey = await subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    const key = await subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: bytesToArrayBuffer(salt),
        iterations: IDENTITY_BACKUP_PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      passwordKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    const decrypted = await subtle.decrypt(
      { name: "AES-GCM", iv: bytesToArrayBuffer(iv) },
      key,
      bytesToArrayBuffer(ciphertextWithTag),
    );
    decryptedJson = new TextDecoder().decode(decrypted);
  } else {
    decryptedJson = await decryptWithQuickCrypto(
      ciphertextWithTag,
      password,
      salt,
      iv,
    );
  }

  const parsed: UserIdentity = JSON.parse(decryptedJson);
  if (!parsed.id || !parsed.publicKey || !parsed.privateKey) {
    throw new Error("Invalid identity backup");
  }
  return parsed;
}

/**
 * Kimliği JSON string olarak dışa aktar.
 * Başka bir cihazda importIdentityFromBackup() ile içe aktarılabilir.
 */
export async function exportIdentityBackup(): Promise<string> {
  const identity = await getOrCreateIdentity();
  return JSON.stringify(identity);
}

/**
 * JSON backup stringinden kimliği içe aktar.
 * Mevcut kimliğin üzerine yazar.
 */
export async function importIdentityFromBackup(
  backupJson: string,
): Promise<UserIdentity> {
  const parsed: UserIdentity = JSON.parse(backupJson);
  if (!parsed.id || !parsed.publicKey || !parsed.privateKey) {
    throw new Error("Invalid identity backup");
  }
  if (Platform.OS === "web") await AsyncStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(parsed));
  else await SecureStore.setItemAsync(IDENTITY_STORAGE_KEY, JSON.stringify(parsed));
  return parsed;
}

export async function importContactFromPublicKey(
  publicKeyArmored: string,
  displayName: string,
): Promise<Contact | null> {
  try {
    const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
    const fingerprint = publicKey.getFingerprint().toUpperCase();
    const id = generateShortId(fingerprint);

    return {
      id,
      publicKey: publicKeyArmored,
      fingerprint,
      displayName,
      addedAt: Date.now(),
    };
  } catch (error) {
    console.error("Import contact error:", error);
    return null;
  }
}
