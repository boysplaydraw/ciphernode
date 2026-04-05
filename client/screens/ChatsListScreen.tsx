import React, { useCallback, useState, useEffect } from "react";
import {
  View,
  FlatList,
  StyleSheet,
  Pressable,
  RefreshControl,
  Alert,
  Platform,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import ActionSheet, { type ActionSheetOption } from "@/components/ActionSheet";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import {
  getActiveChats,
  getActiveGroups,
  getContacts,
  getChats,
  archiveChat,
  archiveGroup,
  deleteContactAndChat,
  deleteGroup,
  type Chat,
  type Group,
} from "@/lib/storage";
import type { Contact } from "@/lib/crypto";
import type { ChatsStackParamList } from "@/navigation/ChatsStackNavigator";
import ConnectionStatus from "@/components/ConnectionStatus";
import { useLanguage } from "@/constants/language";
import { getApiUrl, getOfficialServerUrl } from "@/lib/query-client";
import { onStatusChange } from "@/lib/socket";

type NavigationProp = NativeStackNavigationProp<
  ChatsStackParamList,
  "ChatsList"
>;

type ListItem =
  | (Chat & { type: "chat"; displayName: string })
  | (Group & { type: "group" });

interface ChatItemProps {
  item: ListItem;
  onPress: () => void;
  onLongPress: () => void;
}

function ChatItem({ item, onPress, onLongPress }: ChatItemProps) {
  const lastMessage =
    item.type === "chat"
      ? item.messages[item.messages.length - 1]
      : item.messages[item.messages.length - 1];
  const displayName = item.type === "chat" ? item.displayName : item.name;
  const hasNoMessages = item.type === "chat" && item.messages.length === 0;

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else if (days === 1) {
      return "Yesterday";
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: "short" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.chatItem,
        pressed && styles.chatItemPressed,
      ]}
    >
      <View style={styles.avatarContainer}>
        <View style={styles.avatar}>
          <Feather
            name={item.type === "chat" ? "lock" : "users"}
            size={20}
            color={Colors.dark.secondary}
          />
        </View>
      </View>
      <View style={styles.chatContent}>
        <View style={styles.chatHeader}>
          <ThemedText style={styles.contactName} numberOfLines={1}>
            {displayName}
          </ThemedText>
          <ThemedText style={styles.timestamp}>
            {lastMessage
              ? formatTime(lastMessage.timestamp)
              : hasNoMessages
                ? formatTime(item.lastMessageAt)
                : ""}
          </ThemedText>
        </View>
        <View style={styles.chatPreview}>
          <ThemedText style={styles.messagePreview} numberOfLines={1}>
            {item.type === "group" && lastMessage
              ? `${lastMessage.senderId.split("-")[0]}: ${lastMessage.content}`
              : lastMessage?.content ||
                (hasNoMessages ? "Tap to start chatting" : "No messages yet")}
          </ThemedText>
          {item.unreadCount > 0 ? (
            <View style={styles.unreadBadge}>
              <ThemedText style={styles.unreadCount}>
                {item.unreadCount}
              </ThemedText>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function EmptyState() {
  const { language } = useLanguage();

  const t = {
    noChatsYet: language === "tr" ? "Henüz sohbet yok" : "No chats yet",
    hint:
      language === "tr"
        ? "Kişiler sekmesinden kişi ekleyin veya grup oluşturun"
        : "Add contacts or create a group from the Contacts tab",
  };

  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Feather
          name="message-circle"
          size={64}
          color={Colors.dark.textSecondary}
        />
      </View>
      <ThemedText style={styles.emptyTitle}>{t.noChatsYet}</ThemedText>
      <ThemedText style={styles.emptySubtitle}>{t.hint}</ThemedText>
    </View>
  );
}

export default function ChatsListScreen() {
  const navigation = useNavigation<NavigationProp>();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { language } = useLanguage();
  const [items, setItems] = useState<ListItem[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [actionSheetOptions, setActionSheetOptions] = useState<
    ActionSheetOption[]
  >([]);
  const [actionSheetTitle, setActionSheetTitle] = useState("");
  const [actionSheetMessage, setActionSheetMessage] = useState("");
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [noServerConfigured, setNoServerConfigured] = useState(false);

  useEffect(() => {
    // Native platformlarda localhost fallback'i tespit et
    if (Platform.OS !== "web") {
      const url = getApiUrl();
      const isLocalhost = url.includes("localhost") || url.includes("127.0.0.1");
      const hasOfficial = !!getOfficialServerUrl();
      setNoServerConfigured(isLocalhost && !hasOfficial);
    }

    const unsub = onStatusChange((status) => {
      if (status === "disconnected") setIsDisconnected(true);
      else if (status === "registered" || status === "connected") setIsDisconnected(false);
    });
    return unsub;
  }, []);

  const t = {
    archive: language === "tr" ? "Arşivle" : "Archive",
    delete: language === "tr" ? "Sil" : "Delete",
    cancel: language === "tr" ? "İptal" : "Cancel",
    deleteTitle: language === "tr" ? "Sil" : "Delete",
    deleteConversation:
      language === "tr"
        ? "Bu sohbeti silmek istediğinizden emin misiniz?"
        : "Are you sure you want to delete this conversation?",
    deleteGroup:
      language === "tr"
        ? "Bu grubu silmek istediğinizden emin misiniz?"
        : "Are you sure you want to delete this group?",
    chooseAction: language === "tr" ? "Bir işlem seçin" : "Choose an action",
    confirm: language === "tr" ? "Onayla" : "Confirm",
  };

  const loadData = useCallback(async () => {
    const [chatsData, groupsData, contactsData, allChatsData] =
      await Promise.all([
        getActiveChats(),
        getActiveGroups(),
        getContacts(),
        getChats(),
      ]);
    setContacts(contactsData);

    const chatItems: ListItem[] = chatsData.map((chat) => ({
      ...chat,
      type: "chat" as const,
      displayName:
        contactsData.find((c) => c.id === chat.contactId)?.displayName ||
        chat.contactId,
    }));

    const contactsWithoutChats = contactsData.filter(
      (contact) => !allChatsData.some((chat) => chat.contactId === contact.id),
    );
    const contactAsChats: ListItem[] = contactsWithoutChats.map((contact) => ({
      contactId: contact.id,
      messages: [],
      lastMessageAt: contact.addedAt,
      unreadCount: 0,
      isArchived: false,
      type: "chat" as const,
      displayName: contact.displayName || contact.id,
    }));

    const groupItems: ListItem[] = groupsData.map((group) => ({
      ...group,
      type: "group" as const,
    }));

    const allItems = [...chatItems, ...contactAsChats, ...groupItems].sort(
      (a, b) => b.lastMessageAt - a.lastMessageAt,
    );

    setItems(allItems);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleLongPress = (item: ListItem) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    const options: ActionSheetOption[] = [
      {
        text: t.archive,
        onPress: async () => {
          if (item.type === "chat") {
            await archiveChat(item.contactId);
          } else {
            await archiveGroup(item.id);
          }
          loadData();
        },
      },
      {
        text: t.delete,
        style: "destructive",
        onPress: () => {
          const msg =
            item.type === "chat" ? t.deleteConversation : t.deleteGroup;
          Alert.alert(t.deleteTitle, msg, [
            { text: t.cancel, style: "cancel" },
            {
              text: t.delete,
              style: "destructive",
              onPress: async () => {
                if (item.type === "chat") {
                  await deleteContactAndChat(item.contactId);
                } else {
                  await deleteGroup(item.id);
                }
                loadData();
              },
            },
          ]);
        },
      },
      { text: t.cancel, style: "cancel", onPress: () => {} },
    ];

    setActionSheetTitle(item.type === "chat" ? item.displayName : item.name);
    setActionSheetMessage(t.chooseAction);
    setActionSheetOptions(options);
    setActionSheetVisible(true);
  };

  const handleItemPress = (item: ListItem) => {
    if (item.type === "chat") {
      navigation.navigate("ChatThread", { contactId: item.contactId });
    } else {
      navigation.navigate("GroupThread", { groupId: item.id });
    }
  };

  const handleNewChat = React.useCallback(
    () => navigation.navigate("NewChat"),
    [navigation],
  );
  const handleArchivedChats = React.useCallback(
    () => navigation.navigate("ArchivedChats"),
    [navigation],
  );

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => <ConnectionStatus />,
      headerRight: () => (
        <View style={styles.headerRight}>
          <Pressable
            onPress={handleNewChat}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={({ pressed }) => [
              styles.headerButton,
              pressed && styles.headerButtonPressed,
            ]}
          >
            <Feather name="edit" size={20} color={Colors.dark.primary} />
          </Pressable>
          <Pressable
            onPress={handleArchivedChats}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={({ pressed }) => [
              styles.headerButton,
              pressed && styles.headerButtonPressed,
            ]}
          >
            <Feather name="archive" size={20} color={Colors.dark.text} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, handleNewChat, handleArchivedChats]);

  return (
    <ThemedView style={styles.container}>
      {/* Sunucu yapılandırılmamış uyarısı — native platformlarda göster */}
      {noServerConfigured && (
        <Pressable
          style={styles.noBanner}
          onPress={() => {
            const parent = navigation.getParent();
            if (parent) {
              (parent as any).navigate("SettingsTab", { screen: "NetworkSettings" });
            }
          }}
        >
          <Feather name="alert-triangle" size={14} color="#FFB800" />
          <ThemedText style={styles.noBannerText}>
            {language === "tr"
              ? "Sunucu adresi girilmedi. Bağlantı için Ayarlar → Ağ Ayarları'nı açın."
              : "No server configured. Go to Settings → Network Settings to connect."}
          </ThemedText>
          <Feather name="chevron-right" size={14} color="#FFB800" />
        </Pressable>
      )}
      <FlatList
        data={items}
        keyExtractor={(item) =>
          item.type === "chat" ? `chat-${item.contactId}` : `group-${item.id}`
        }
        renderItem={({ item }) => (
          <ChatItem
            item={item}
            onPress={() => handleItemPress(item)}
            onLongPress={() => handleLongPress(item)}
          />
        )}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: tabBarHeight + Spacing.xl,
          },
          items.length === 0 && styles.emptyListContent,
        ]}
        ListEmptyComponent={EmptyState}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.dark.primary}
          />
        }
      />

      <ActionSheet
        visible={actionSheetVisible}
        onClose={() => setActionSheetVisible(false)}
        title={actionSheetTitle}
        message={actionSheetMessage}
        options={actionSheetOptions}
      />

    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
  noBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,184,0,0.1)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,184,0,0.3)",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    columnGap: Spacing.sm,
  },
  noBannerText: {
    flex: 1,
    fontSize: 12,
    color: "#FFB800",
  },
  headerRight: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  headerButtonPressed: {
    backgroundColor: Colors.dark.backgroundSecondary,
  },
  listContent: {
    flexGrow: 1,
  },
  emptyListContent: {
    justifyContent: "center",
  },
  chatItem: {
    flexDirection: "row",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.dark.backgroundDefault,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  chatItemPressed: {
    backgroundColor: Colors.dark.backgroundSecondary,
  },
  avatarContainer: {
    marginRight: Spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.dark.backgroundSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  chatContent: {
    flex: 1,
    justifyContent: "center",
  },
  chatHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  contactName: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.text,
    flex: 1,
  },
  timestamp: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginLeft: Spacing.sm,
  },
  chatPreview: {
    flexDirection: "row",
    alignItems: "center",
  },
  messagePreview: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    flex: 1,
  },
  unreadBadge: {
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
    marginLeft: Spacing.sm,
  },
  unreadCount: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.dark.buttonText,
  },
  emptyState: {
    alignItems: "center",
    paddingHorizontal: Spacing["3xl"],
  },
  emptyIcon: {
    marginBottom: Spacing.xl,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: Colors.dark.text,
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    marginBottom: Spacing["2xl"],
  },
});
