import AsyncStorage from "@react-native-async-storage/async-storage";
import * as openpgp from "openpgp";
import { generateSecretKey, getPublicKey as nostrGetPublicKey } from "nostr-tools";

const IDENTITY_STORAGE_KEY = "@ciphernode/identity";

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
export function generateNostrKeyPair(): { nostrPrivkey: string; nostrPubkey: string } {
  const secretKey = generateSecretKey();
  const pubkey = nostrGetPublicKey(secretKey);
  const privkey = Buffer.from(secretKey).toString("hex");
  return { nostrPrivkey: privkey, nostrPubkey: pubkey };
}

export function generateShortId(fingerprint: string): string {
  const clean = fingerprint.replace(/\s/g, "").toUpperCase();
  const part1 = clean.slice(0, 4);
  const part2 = clean.slice(4, 8);
  return `${part1}-${part2}`;
}

export async function generateKeyPair(rsaBits: 2048 | 4096 = 2048): Promise<{
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
  const stored = await AsyncStorage.getItem(IDENTITY_STORAGE_KEY);

  if (stored) {
    const parsed: UserIdentity = JSON.parse(stored);
    // Bozuk/boş anahtarla kaydedilmiş eski veriyi temizle ve yeniden üret
    if (!parsed.publicKey || !parsed.privateKey) {
      await AsyncStorage.removeItem(IDENTITY_STORAGE_KEY);
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
    await AsyncStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(parsed));
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

  await AsyncStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export async function getIdentity(): Promise<UserIdentity | null> {
  try {
    const stored = await AsyncStorage.getItem(IDENTITY_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export async function updateDisplayName(name: string): Promise<void> {
  const identity = await getIdentity();
  if (identity) {
    identity.displayName = name;
    await AsyncStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  }
}

export async function regenerateIdentity(): Promise<UserIdentity> {
  await AsyncStorage.removeItem(IDENTITY_STORAGE_KEY);
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
    return { content: encryptedMessage, verified: false };
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
    return { content: encryptedMessage, verified: false };
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
    return message;
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
  await AsyncStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(parsed));
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
