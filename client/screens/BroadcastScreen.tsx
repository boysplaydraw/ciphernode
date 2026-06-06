import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  FlatList,
  TextInput,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Fonts } from "@/constants/theme";
import {
  getContacts,
  saveMessage,
  generateMessageId,
  getSettings,
  calculateExpiresAt,
  updateMessageStatus,
  type Message,
} from "@/lib/storage";
import { encryptMessage, type Contact } from "@/lib/crypto";
import { useIdentity } from "@/hooks/useIdentity";
import {
  sendMessage as socketSendMessage,
  isRelayConnected,
} from "@/lib/socket";
import type { ChatsStackParamList } from "@/navigation/ChatsStackNavigator";

type NavigationProp = NativeStackNavigationProp<ChatsStackParamList>;

export default function BroadcastScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { identity } = useIdentity();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    getContacts().then((list) =>
      setContacts(list.filter((c) => !!c.publicKey)),
    );
  }, []);

  const toggleContact = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSend = useCallback(async () => {
    if (!inputText.trim() || selected.size === 0 || !identity) return;
    if (!isRelayConnected()) {
      Alert.alert("Bağlantı Yok", "Sunucuya bağlı değilsiniz.");
      return;
    }

    setSending(true);
    const settings = await getSettings();
    const plaintext = inputText.trim();
    let successCount = 0;

    for (const contactId of selected) {
      const contact = contacts.find((c) => c.id === contactId);
      if (!contact?.publicKey) continue;
      try {
        const encrypted = await encryptMessage(plaintext, contact.publicKey);
        const messageId = generateMessageId();
        const message: Message = {
          id: messageId,
          content: plaintext,
          encrypted,
          senderId: identity.id,
          recipientId: contactId,
          timestamp: Date.now(),
          status: "sending",
          expiresAt: calculateExpiresAt(settings.defaultMessageTimer),
        };
        await saveMessage(contactId, message);
        socketSendMessage(contactId, encrypted, messageId);
        await updateMessageStatus(contactId, messageId, "sent");
        successCount++;
      } catch {}
    }

    setSending(false);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    Alert.alert(
      "Gönderildi",
      `${successCount} / ${selected.size} kişiye gönderildi.`,
      [{ text: "Tamam", onPress: () => navigation.goBack() }],
    );
  }, [inputText, selected, identity, contacts, navigation]);

  const renderContact = ({ item }: { item: Contact }) => {
    const isSelected = selected.has(item.id);
    const displayName = item.displayName || item.id;
    const initial = displayName.charAt(0).toUpperCase();

    return (
      <Pressable
        onPress={() => toggleContact(item.id)}
        style={({ pressed }) => [
          styles.contactRow,
          isSelected && styles.contactRowSelected,
          pressed && { opacity: 0.7 },
        ]}
      >
        <View style={[styles.avatar, isSelected && styles.avatarSelected]}>
          {isSelected ? (
            <Feather name="check" size={18} color={Colors.dark.buttonText} />
          ) : (
            <ThemedText style={styles.avatarText}>{initial}</ThemedText>
          )}
        </View>
        <ThemedText style={styles.contactName} numberOfLines={1}>
          {displayName}
        </ThemedText>
      </Pressable>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.selectionHeader}>
        <ThemedText style={styles.selectionCount}>
          {selected.size} kişi seçildi
        </ThemedText>
        {contacts.length === 0 && (
          <ThemedText style={styles.noContacts}>
            Şifreli mesaj göndermek için kişi eklemeniz gerekiyor.
          </ThemedText>
        )}
      </View>

      <FlatList
        data={contacts}
        keyExtractor={(item) => item.id}
        renderItem={renderContact}
        style={styles.list}
        contentContainerStyle={
          contacts.length === 0 ? styles.emptyList : undefined
        }
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Mesaj yaz..."
          placeholderTextColor={Colors.dark.textSecondary}
          value={inputText}
          onChangeText={setInputText}
          multiline
          editable={!sending}
        />
        <Pressable
          onPress={handleSend}
          disabled={
            sending || !inputText.trim() || selected.size === 0 || !identity
          }
          style={({ pressed }) => [
            styles.sendButton,
            (sending || !inputText.trim() || selected.size === 0) &&
              styles.sendButtonDisabled,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Feather
            name={sending ? "loader" : "send"}
            size={20}
            color={Colors.dark.buttonText}
          />
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
  selectionHeader: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  selectionCount: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    fontWeight: "600",
  },
  noContacts: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    marginTop: Spacing.xs,
  },
  list: {
    flex: 1,
  },
  emptyList: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.dark.border,
    gap: Spacing.md,
  },
  contactRowSelected: {
    backgroundColor: Colors.dark.primary + "15",
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.backgroundSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarSelected: {
    backgroundColor: Colors.dark.primary,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.text,
  },
  contactName: {
    flex: 1,
    fontSize: 16,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
    backgroundColor: Colors.dark.backgroundDefault,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    color: Colors.dark.text,
    fontSize: 16,
    maxHeight: 120,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.dark.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    backgroundColor: Colors.dark.textDisabled,
  },
});
