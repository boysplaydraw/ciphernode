import React, { useState, useCallback } from "react";
import {
  View,
  FlatList,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Fonts } from "@/constants/theme";
import {
  getArchivedChats,
  getArchivedGroups,
  unarchiveChat,
  unarchiveGroup,
  deleteChat,
  deleteGroup,
  getContact,
  type Chat,
  type Group,
} from "@/lib/storage";
import type { ChatsStackParamList } from "@/navigation/ChatsStackNavigator";
import { useLanguage } from "@/constants/language";

type NavigationProp = NativeStackNavigationProp<ChatsStackParamList>;

type ArchivedItem = (Chat & { type: "chat"; displayName: string }) | (Group & { type: "group" });

export default function ArchivedChatsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { language } = useLanguage();

  const [items, setItems] = useState<ArchivedItem[]>([]);
  const [loading, setLoading] = useState(true);

  const t = {
    delete: language === "tr" ? "Sil" : "Delete",
    deleteConversation: language === "tr" 
      ? "Bu sohbeti kalıcı olarak silmek istediğinizden emin misiniz?"
      : "Are you sure you want to permanently delete this conversation?",
    deleteGroup: language === "tr" 
      ? "Bu grubu kalıcı olarak silmek istediğinizden emin misiniz?"
      : "Are you sure you want to permanently delete this group?",
    cancel: language === "tr" ? "İptal" : "Cancel",
    members: language === "tr" ? "üye" : "members",
    directMessage: language === "tr" ? "Doğrudan mesaj" : "Direct message",
    noArchivedItems: language === "tr" ? "Arşivlenmiş Öğe Yok" : "No Archived Items",
    archivedWillAppear: language === "tr" 
      ? "Arşivlenmiş sohbetler ve gruplar burada görünecek"
      : "Archived chats and groups will appear here",
  };

  const loadArchivedItems = useCallback(async () => {
    setLoading(true);
    try {
      const [archivedChats, archivedGroups] = await Promise.all([
        getArchivedChats(),
        getArchivedGroups(),
      ]);

      const chatItems: ArchivedItem[] = await Promise.all(
        archivedChats.map(async (chat) => {
          const contact = await getContact(chat.contactId);
          return {
            ...chat,
            type: "chat" as const,
            displayName: contact?.displayName || chat.contactId,
          };
        })
      );

      const groupItems: ArchivedItem[] = archivedGroups.map((group) => ({
        ...group,
        type: "group" as const,
      }));

      const allItems = [...chatItems, ...groupItems].sort(
        (a, b) => b.lastMessageAt - a.lastMessageAt
      );

      setItems(allItems);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadArchivedItems();
    }, [loadArchivedItems])
  );

  const handleUnarchive = async (item: ArchivedItem) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    if (item.type === "chat") {
      await unarchiveChat(item.contactId);
    } else {
      await unarchiveGroup(item.id);
    }
    loadArchivedItems();
  };

  const handleDelete = (item: ArchivedItem) => {
    Alert.alert(
      t.delete,
      item.type === "chat" ? t.deleteConversation : t.deleteGroup,
      [
        { text: t.cancel, style: "cancel" },
        {
          text: t.delete,
          style: "destructive",
          onPress: async () => {
            if (item.type === "chat") {
              await deleteChat(item.contactId);
            } else {
              await deleteGroup(item.id);
            }
            loadArchivedItems();
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: ArchivedItem }) => (
    <View style={styles.itemRow}>
      <View style={styles.avatar}>
        <Feather
          name={item.type === "chat" ? "user" : "users"}
          size={24}
          color={Colors.dark.secondary}
        />
      </View>

      <View style={styles.itemInfo}>
        <ThemedText style={styles.itemName} numberOfLines={1}>
          {item.type === "chat" ? item.displayName : item.name}
        </ThemedText>
        <ThemedText style={styles.itemMeta}>
          {item.type === "group" ? `${item.members.length} ${t.members}` : t.directMessage}
        </ThemedText>
      </View>

      <Pressable
        onPress={() => handleUnarchive(item)}
        style={({ pressed }) => [
          styles.actionButton,
          pressed && styles.actionButtonPressed,
        ]}
      >
        <Feather name="archive" size={18} color={Colors.dark.primary} />
      </Pressable>

      <Pressable
        onPress={() => handleDelete(item)}
        style={({ pressed }) => [
          styles.actionButton,
          pressed && styles.actionButtonPressed,
        ]}
      >
        <Feather name="trash-2" size={18} color={Colors.dark.error} />
      </Pressable>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) =>
          item.type === "chat" ? `chat-${item.contactId}` : `group-${item.id}`
        }
        renderItem={renderItem}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather name="archive" size={48} color={Colors.dark.textDisabled} />
            <ThemedText style={styles.emptyTitle}>{t.noArchivedItems}</ThemedText>
            <ThemedText style={styles.emptyText}>
              {t.archivedWillAppear}
            </ThemedText>
          </View>
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.dark.backgroundSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 16,
    fontWeight: "500",
    color: Colors.dark.text,
  },
  itemMeta: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: Spacing.xs,
  },
  actionButtonPressed: {
    backgroundColor: Colors.dark.backgroundSecondary,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 100,
    paddingHorizontal: Spacing["3xl"],
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: Colors.dark.text,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: "center",
  },
});
