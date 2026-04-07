import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Contact } from "./crypto";

const CONTACTS_KEY = "@ciphernode/contacts";
const CHATS_KEY = "@ciphernode/chats";
const GROUPS_KEY = "@ciphernode/groups";
const SETTINGS_KEY = "@ciphernode/settings";
const ONBOARDING_KEY = "@ciphernode/onboarding";
const LANGUAGE_KEY = "@ciphernode/language";

export interface Message {
  id: string;
  content: string;
  encrypted: string;
  senderId: string;
  recipientId: string;
  timestamp: number;
  status: "sending" | "sent" | "delivered" | "read" | "received";
  expiresAt?: number;
  groupId?: string;
}

export interface Chat {
  contactId: string;
  messages: Message[];
  lastMessageAt: number;
  unreadCount: number;
  isArchived: boolean;
}

export interface GroupMember {
  id: string;
  publicKey: string;
  displayName: string;
  role: "admin" | "member";
  addedAt: number;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  createdAt: number;
  members: GroupMember[];
  messages: Message[];
  lastMessageAt: number;
  unreadCount: number;
  isArchived: boolean;
}

export interface AppSettings {
  serverUrl: string;
  defaultMessageTimer: number;
  displayName: string;
  language: "tr" | "en";
}

export interface PrivacySettings {
  screenProtection: boolean;
  biometricLock: boolean;
  autoMetadataScrubbing: boolean;
  steganographyMode: boolean;
  ghostMode: boolean;
  p2pOnlyMode: boolean;
  lowPowerMode: boolean;
}

export interface TorSettings {
  enabled: boolean;
  proxyHost: string;
  proxyPort: number;
  connectionStatus: "disconnected" | "connecting" | "connected" | "error";
}

const DEFAULT_SETTINGS: AppSettings = {
  serverUrl: "",
  defaultMessageTimer: 0,
  displayName: "",
  language: "tr",
};

const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  screenProtection: false,
  biometricLock: false,
  autoMetadataScrubbing: true,
  steganographyMode: false,
  ghostMode: false,
  p2pOnlyMode: false,
  lowPowerMode: false,
};

const DEFAULT_TOR_SETTINGS: TorSettings = {
  enabled: false,
  proxyHost: "127.0.0.1",
  proxyPort: 9050,
  connectionStatus: "disconnected",
};

const PRIVACY_SETTINGS_KEY = "@ciphernode/privacy_settings";
const TOR_SETTINGS_KEY = "@ciphernode/tor_settings";

export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(ONBOARDING_KEY);
    return value === "true";
  } catch {
    return false;
  }
}

export async function setOnboardingComplete(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_KEY, "true");
}

export async function getContacts(): Promise<Contact[]> {
  try {
    const stored = await AsyncStorage.getItem(CONTACTS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export async function addContact(contact: Contact): Promise<void> {
  const contacts = await getContacts();
  const exists = contacts.find((c) => c.id === contact.id);
  if (!exists) {
    contacts.push(contact);
    await AsyncStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
  }
}

/** Var olan bir kişinin alanlarını güncelle (ör. public key geldiğinde) */
export async function updateContact(
  contactId: string,
  updates: Partial<Contact>,
): Promise<void> {
  const contacts = await getContacts();
  const idx = contacts.findIndex((c) => c.id === contactId);
  if (idx !== -1) {
    contacts[idx] = { ...contacts[idx], ...updates };
    await AsyncStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
  }
}

export async function removeContact(contactId: string): Promise<void> {
  const contacts = await getContacts();
  const filtered = contacts.filter((c) => c.id !== contactId);
  await AsyncStorage.setItem(CONTACTS_KEY, JSON.stringify(filtered));
}

export async function getContact(contactId: string): Promise<Contact | null> {
  const contacts = await getContacts();
  return contacts.find((c) => c.id === contactId) || null;
}

export async function getChats(): Promise<Chat[]> {
  try {
    const stored = await AsyncStorage.getItem(CHATS_KEY);
    const chats: Chat[] = stored ? JSON.parse(stored) : [];
    return chats.map((c) => ({ ...c, isArchived: c.isArchived || false }));
  } catch {
    return [];
  }
}

export async function getActiveChats(): Promise<Chat[]> {
  const chats = await getChats();
  return chats.filter((c) => !c.isArchived);
}

export async function getArchivedChats(): Promise<Chat[]> {
  const chats = await getChats();
  return chats.filter((c) => c.isArchived);
}

export async function getChat(contactId: string): Promise<Chat | null> {
  const chats = await getChats();
  return chats.find((c) => c.contactId === contactId) || null;
}

export async function saveMessage(
  contactId: string,
  message: Message,
): Promise<void> {
  const chats = await getChats();
  let chat = chats.find((c) => c.contactId === contactId);

  if (!chat) {
    chat = {
      contactId,
      messages: [],
      lastMessageAt: message.timestamp,
      unreadCount: 0,
      isArchived: false,
    };
    chats.push(chat);
  }

  // Aynı ID'li mesaj zaten varsa kaydetme (duplicate önleme)
  if (!chat.messages.find((m) => m.id === message.id)) {
    chat.messages.push(message);
    chat.lastMessageAt = message.timestamp;
  }

  await AsyncStorage.setItem(CHATS_KEY, JSON.stringify(chats));
}

export async function updateMessageStatus(
  contactId: string,
  messageId: string,
  status: Message["status"],
): Promise<void> {
  const chats = await getChats();
  const chat = chats.find((c) => c.contactId === contactId);
  if (!chat) return;
  const msg = chat.messages.find((m) => m.id === messageId);
  if (!msg) return;
  msg.status = status;
  await AsyncStorage.setItem(CHATS_KEY, JSON.stringify(chats));
}

export async function markChatAsRead(contactId: string): Promise<void> {
  const chats = await getChats();
  const chat = chats.find((c) => c.contactId === contactId);
  if (chat) {
    chat.unreadCount = 0;
    await AsyncStorage.setItem(CHATS_KEY, JSON.stringify(chats));
  }
}

export async function archiveChat(contactId: string): Promise<void> {
  const chats = await getChats();
  const chat = chats.find((c) => c.contactId === contactId);
  if (chat) {
    chat.isArchived = true;
    await AsyncStorage.setItem(CHATS_KEY, JSON.stringify(chats));
  }
}

export async function unarchiveChat(contactId: string): Promise<void> {
  const chats = await getChats();
  const chat = chats.find((c) => c.contactId === contactId);
  if (chat) {
    chat.isArchived = false;
    await AsyncStorage.setItem(CHATS_KEY, JSON.stringify(chats));
  }
}

export async function deleteChat(contactId: string): Promise<void> {
  const chats = await getChats();
  const filtered = chats.filter((c) => c.contactId !== contactId);
  await AsyncStorage.setItem(CHATS_KEY, JSON.stringify(filtered));
}

export async function deleteMessage(
  contactId: string,
  messageId: string,
): Promise<void> {
  const chats = await getChats();
  const chat = chats.find((c) => c.contactId === contactId);
  if (chat) {
    chat.messages = chat.messages.filter((m) => m.id !== messageId);
    if (chat.messages.length > 0) {
      chat.lastMessageAt = chat.messages[chat.messages.length - 1].timestamp;
    }
    await AsyncStorage.setItem(CHATS_KEY, JSON.stringify(chats));
  }
}

export async function deleteContactAndChat(contactId: string): Promise<void> {
  await deleteChat(contactId);
  await removeContact(contactId);
}

export async function getGroups(): Promise<Group[]> {
  try {
    const stored = await AsyncStorage.getItem(GROUPS_KEY);
    const groups: Group[] = stored ? JSON.parse(stored) : [];
    return groups.map((g) => ({ ...g, isArchived: g.isArchived || false }));
  } catch {
    return [];
  }
}

export async function getActiveGroups(): Promise<Group[]> {
  const groups = await getGroups();
  return groups.filter((g) => !g.isArchived);
}

export async function getArchivedGroups(): Promise<Group[]> {
  const groups = await getGroups();
  return groups.filter((g) => g.isArchived);
}

export async function getGroup(groupId: string): Promise<Group | null> {
  const groups = await getGroups();
  return groups.find((g) => g.id === groupId) || null;
}

export async function createGroup(
  name: string,
  description: string,
  creatorId: string,
  creatorPublicKey: string,
  creatorDisplayName: string,
): Promise<Group> {
  const groups = await getGroups();
  const newGroup: Group = {
    id: `grp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name,
    description,
    createdBy: creatorId,
    createdAt: Date.now(),
    members: [
      {
        id: creatorId,
        publicKey: creatorPublicKey,
        displayName: creatorDisplayName,
        role: "admin",
        addedAt: Date.now(),
      },
    ],
    messages: [],
    lastMessageAt: Date.now(),
    unreadCount: 0,
    isArchived: false,
  };
  groups.push(newGroup);
  await AsyncStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  return newGroup;
}

export async function addGroupMember(
  groupId: string,
  member: GroupMember,
): Promise<void> {
  const groups = await getGroups();
  const group = groups.find((g) => g.id === groupId);
  if (group) {
    const exists = group.members.find((m) => m.id === member.id);
    if (!exists) {
      group.members.push(member);
      await AsyncStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
    }
  }
}

export async function removeGroupMember(
  groupId: string,
  memberId: string,
): Promise<void> {
  const groups = await getGroups();
  const group = groups.find((g) => g.id === groupId);
  if (group) {
    group.members = group.members.filter((m) => m.id !== memberId);
    await AsyncStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  }
}

export async function saveGroupMessage(
  groupId: string,
  message: Message,
): Promise<void> {
  const groups = await getGroups();
  const group = groups.find((g) => g.id === groupId);
  if (group) {
    group.messages.push({ ...message, groupId });
    group.lastMessageAt = message.timestamp;
    await AsyncStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  }
}

export async function archiveGroup(groupId: string): Promise<void> {
  const groups = await getGroups();
  const group = groups.find((g) => g.id === groupId);
  if (group) {
    group.isArchived = true;
    await AsyncStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  }
}

export async function unarchiveGroup(groupId: string): Promise<void> {
  const groups = await getGroups();
  const group = groups.find((g) => g.id === groupId);
  if (group) {
    group.isArchived = false;
    await AsyncStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  }
}

export async function deleteGroup(groupId: string): Promise<void> {
  const groups = await getGroups();
  const filtered = groups.filter((g) => g.id !== groupId);
  await AsyncStorage.setItem(GROUPS_KEY, JSON.stringify(filtered));
}

export async function updateGroupName(
  groupId: string,
  name: string,
): Promise<void> {
  const groups = await getGroups();
  const group = groups.find((g) => g.id === groupId);
  if (group) {
    group.name = name;
    await AsyncStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  }
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const stored = await AsyncStorage.getItem(SETTINGS_KEY);
    return stored
      ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
      : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function updateSettings(
  updates: Partial<AppSettings>,
): Promise<void> {
  const current = await getSettings();
  await AsyncStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ ...current, ...updates }),
  );
}

export async function getPrivacySettings(): Promise<PrivacySettings> {
  try {
    const stored = await AsyncStorage.getItem(PRIVACY_SETTINGS_KEY);
    return stored
      ? { ...DEFAULT_PRIVACY_SETTINGS, ...JSON.parse(stored) }
      : DEFAULT_PRIVACY_SETTINGS;
  } catch {
    return DEFAULT_PRIVACY_SETTINGS;
  }
}

export async function updatePrivacySettings(
  updates: Partial<PrivacySettings>,
): Promise<void> {
  const current = await getPrivacySettings();
  await AsyncStorage.setItem(
    PRIVACY_SETTINGS_KEY,
    JSON.stringify({ ...current, ...updates }),
  );
}

export async function getTorSettings(): Promise<TorSettings> {
  try {
    const stored = await AsyncStorage.getItem(TOR_SETTINGS_KEY);
    return stored
      ? { ...DEFAULT_TOR_SETTINGS, ...JSON.parse(stored) }
      : DEFAULT_TOR_SETTINGS;
  } catch {
    return DEFAULT_TOR_SETTINGS;
  }
}

export async function updateTorSettings(
  updates: Partial<TorSettings>,
): Promise<void> {
  const current = await getTorSettings();
  await AsyncStorage.setItem(
    TOR_SETTINGS_KEY,
    JSON.stringify({ ...current, ...updates }),
  );
}

export async function getLanguage(): Promise<"tr" | "en"> {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_KEY);
    return (stored as "tr" | "en") || "tr";
  } catch {
    return "tr";
  }
}

export async function setLanguage(language: "tr" | "en"): Promise<void> {
  await AsyncStorage.setItem(LANGUAGE_KEY, language);
  const current = await getSettings();
  await updateSettings({ language });
}

export async function clearAllData(): Promise<void> {
  await AsyncStorage.multiRemove([
    CONTACTS_KEY,
    CHATS_KEY,
    GROUPS_KEY,
    SETTINGS_KEY,
    ONBOARDING_KEY,
    LANGUAGE_KEY,
    PRIVACY_SETTINGS_KEY,
    TOR_SETTINGS_KEY,
    "@ciphernode/identity",
  ]);
}

export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export async function cleanupExpiredMessages(): Promise<number> {
  const now = Date.now();
  let deletedCount = 0;

  const chats = await getChats();
  for (const chat of chats) {
    const originalLength = chat.messages.length;
    chat.messages = chat.messages.filter((msg) => {
      if (msg.expiresAt && msg.expiresAt <= now) {
        return false;
      }
      return true;
    });
    const deleted = originalLength - chat.messages.length;
    deletedCount += deleted;
    if (deleted > 0) {
      chat.lastMessageAt =
        chat.messages.length > 0
          ? chat.messages[chat.messages.length - 1].timestamp
          : 0;
      chat.unreadCount = Math.min(chat.unreadCount, chat.messages.length);
    }
  }
  await AsyncStorage.setItem(CHATS_KEY, JSON.stringify(chats));

  const groups = await getGroups();
  for (const group of groups) {
    const originalLength = group.messages.length;
    group.messages = group.messages.filter((msg) => {
      if (msg.expiresAt && msg.expiresAt <= now) {
        return false;
      }
      return true;
    });
    const deleted = originalLength - group.messages.length;
    deletedCount += deleted;
    if (deleted > 0) {
      group.lastMessageAt =
        group.messages.length > 0
          ? group.messages[group.messages.length - 1].timestamp
          : 0;
      group.unreadCount = Math.min(group.unreadCount, group.messages.length);
    }
  }
  await AsyncStorage.setItem(GROUPS_KEY, JSON.stringify(groups));

  return deletedCount;
}

export async function cleanupExpiredMessagesForChat(
  contactId: string,
): Promise<void> {
  const now = Date.now();
  const chats = await getChats();
  const chat = chats.find((c) => c.contactId === contactId);
  if (chat) {
    const originalLength = chat.messages.length;
    chat.messages = chat.messages.filter(
      (msg) => !msg.expiresAt || msg.expiresAt > now,
    );
    if (chat.messages.length !== originalLength) {
      chat.lastMessageAt =
        chat.messages.length > 0
          ? chat.messages[chat.messages.length - 1].timestamp
          : 0;
      chat.unreadCount = Math.min(chat.unreadCount, chat.messages.length);
      await AsyncStorage.setItem(CHATS_KEY, JSON.stringify(chats));
    }
  }
}

/**
 * Kişileri sunucuya yükle — aynı kimlik başka bir cihazda da kullanılıyorsa senkronize olur.
 */
export async function pushContactsToServer(
  userId: string,
  apiUrl: string,
): Promise<void> {
  const contacts = await getContacts();
  await fetch(`${apiUrl}api/contacts/${encodeURIComponent(userId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contacts }),
  });
}

/**
 * Sunucudaki kişileri çek ve yerel listeyle birleştir.
 * Yeni kişiler eklenir; mevcut kişiler değiştirilmez (yerel veri öncelikli).
 */
export async function pullContactsFromServer(
  userId: string,
  apiUrl: string,
): Promise<number> {
  const res = await fetch(
    `${apiUrl}api/contacts/${encodeURIComponent(userId)}`,
  );
  if (!res.ok) return 0;
  const data = await res.json();
  const remoteContacts: Contact[] = data.contacts || [];
  if (remoteContacts.length === 0) return 0;

  const localContacts = await getContacts();
  const localIds = new Set(localContacts.map((c) => c.id));

  let added = 0;
  for (const contact of remoteContacts) {
    if (!localIds.has(contact.id)) {
      await addContact(contact);
      added++;
    }
  }
  return added;
}

export async function cleanupExpiredMessagesForGroup(
  groupId: string,
): Promise<void> {
  const now = Date.now();
  const groups = await getGroups();
  const group = groups.find((g) => g.id === groupId);
  if (group) {
    const originalLength = group.messages.length;
    group.messages = group.messages.filter(
      (msg) => !msg.expiresAt || msg.expiresAt > now,
    );
    if (group.messages.length !== originalLength) {
      group.lastMessageAt =
        group.messages.length > 0
          ? group.messages[group.messages.length - 1].timestamp
          : 0;
      group.unreadCount = Math.min(group.unreadCount, group.messages.length);
      await AsyncStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
    }
  }
}

export function calculateExpiresAt(timerSeconds: number): number | undefined {
  if (timerSeconds <= 0) return undefined;
  return Date.now() + timerSeconds * 1000;
}
