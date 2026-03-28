import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  FlatList,
  TextInput,
  StyleSheet,
  Pressable,
  Platform,
} from "react-native";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Fonts } from "@/constants/theme";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { getGroup, saveGroupMessage, generateMessageId, getSettings, calculateExpiresAt, cleanupExpiredMessagesForGroup, type Group, type Message } from "@/lib/storage";
import { sendGroupMessage, onGroupMessage } from "@/lib/socket";
import { useIdentity } from "@/hooks/useIdentity";
import type { ChatsStackParamList } from "@/navigation/ChatsStackNavigator";

type NavigationProp = NativeStackNavigationProp<ChatsStackParamList, "GroupThread">;
type ScreenRouteProp = RouteProp<ChatsStackParamList, "GroupThread">;

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  senderName: string;
  currentTime: number;
}

function formatRemainingTime(expiresAt: number, now: number): string {
  const remaining = expiresAt - now;
  if (remaining <= 0) return "";
  const seconds = Math.floor(remaining / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function MessageBubble({ message, isOwn, senderName, currentTime }: MessageBubbleProps) {
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <View style={[styles.messageContainer, isOwn && styles.ownMessageContainer]}>
      {!isOwn ? (
        <ThemedText style={styles.senderName}>{senderName}</ThemedText>
      ) : null}
      <View style={[styles.messageBubble, isOwn && styles.ownMessageBubble]}>
        <ThemedText style={[styles.messageText, isOwn && styles.ownMessageText]}>
          {message.content}
        </ThemedText>
        <View style={styles.messageFooter}>
          {message.expiresAt ? (
            <View style={styles.timerContainer}>
              <Feather
                name="clock"
                size={10}
                color={isOwn ? Colors.dark.buttonText : Colors.dark.warning}
              />
              <ThemedText
                style={[
                  styles.timerText,
                  { color: isOwn ? Colors.dark.buttonText : Colors.dark.warning },
                ]}
              >
                {formatRemainingTime(message.expiresAt, currentTime)}
              </ThemedText>
            </View>
          ) : null}
          <ThemedText style={[styles.messageTime, isOwn && styles.ownMessageTime]}>
            {formatTime(message.timestamp)}
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

export default function GroupThreadScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<ScreenRouteProp>();
  const { groupId } = route.params;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { identity } = useIdentity();
  const flatListRef = useRef<FlatList>(null);

  const [group, setGroup] = useState<Group | null>(null);
  const [inputText, setInputText] = useState("");
  const [messageTimer, setMessageTimer] = useState(0);
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const tickerInterval = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(tickerInterval);
  }, []);

  const loadGroup = useCallback(async () => {
    await cleanupExpiredMessagesForGroup(groupId);
    const [g, settings] = await Promise.all([getGroup(groupId), getSettings()]);
    if (g) {
      const clonedGroup = { ...g, messages: g.messages.map(m => ({ ...m })) };
      setGroup(clonedGroup);
    } else {
      setGroup(null);
    }
    setMessageTimer(settings.defaultMessageTimer);
  }, [groupId]);

  useEffect(() => {
    const interval = setInterval(async () => {
      await cleanupExpiredMessagesForGroup(groupId);
      const g = await getGroup(groupId);
      if (g) {
        const clonedGroup = { ...g, messages: g.messages.map(m => ({ ...m })) };
        setGroup(clonedGroup);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [groupId]);

  useFocusEffect(
    useCallback(() => {
      loadGroup();
    }, [loadGroup])
  );

  useEffect(() => {
    const unsubscribe = onGroupMessage(async (msg) => {
      if (msg.groupId === groupId) {
        const newMessage: Message = {
          id: generateMessageId(),
          content: msg.content || msg.encrypted,
          encrypted: msg.encrypted,
          senderId: msg.from,
          recipientId: groupId,
          timestamp: msg.timestamp,
          status: "received",
          groupId,
        };
        await saveGroupMessage(groupId, newMessage);
        loadGroup();
      }
    });
    return unsubscribe;
  }, [groupId, loadGroup]);

  useEffect(() => {
    if (group) {
      navigation.setOptions({
        headerTitle: group.name,
        headerRight: () => (
          <Pressable
            onPress={() => navigation.navigate("GroupInfo", { groupId })}
            style={({ pressed }) => [
              styles.headerButton,
              pressed && styles.headerButtonPressed,
            ]}
          >
            <Feather name="info" size={20} color={Colors.dark.text} />
          </Pressable>
        ),
      });
    }
  }, [group, navigation, groupId]);

  const getSenderName = (senderId: string) => {
    if (senderId === identity?.id) return "You";
    const member = group?.members.find((m) => m.id === senderId);
    return member?.displayName || senderId.split("-")[0];
  };

  const handleSend = async () => {
    if (!inputText.trim() || !identity || !group) return;

    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    const content = inputText.trim();
    const message: Message = {
      id: generateMessageId(),
      content,
      encrypted: "",
      senderId: identity.id,
      recipientId: groupId,
      timestamp: Date.now(),
      status: "sent",
      groupId,
      expiresAt: calculateExpiresAt(messageTimer),
    };

    await saveGroupMessage(groupId, message);
    sendGroupMessage(groupId, content, content);
    setInputText("");
    loadGroup();

    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  if (!group) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText style={styles.loadingText}>Loading...</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={group.messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <MessageBubble
            message={item}
            isOwn={item.senderId === identity?.id}
            senderName={getSenderName(item.senderId)}
            currentTime={currentTime}
          />
        )}
        contentContainerStyle={[
          styles.messagesList,
          {
            paddingTop: headerHeight + Spacing.md,
            paddingBottom: Spacing.md,
          },
        ]}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather name="users" size={48} color={Colors.dark.textDisabled} />
            <ThemedText style={styles.emptyText}>
              No messages yet. Start the conversation!
            </ThemedText>
          </View>
        }
      />

      <View style={[styles.inputContainer, { paddingBottom: insets.bottom + Spacing.sm }]}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type a message..."
          placeholderTextColor={Colors.dark.textDisabled}
          multiline
          maxLength={2000}
        />
        <Pressable
          onPress={handleSend}
          disabled={!inputText.trim()}
          style={({ pressed }) => [
            styles.sendButton,
            !inputText.trim() && styles.sendButtonDisabled,
            pressed && styles.sendButtonPressed,
          ]}
        >
          <Feather
            name="send"
            size={20}
            color={inputText.trim() ? Colors.dark.buttonText : Colors.dark.textDisabled}
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
  loadingText: {
    textAlign: "center",
    marginTop: 100,
    color: Colors.dark.textSecondary,
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
  messagesList: {
    paddingHorizontal: Spacing.lg,
    flexGrow: 1,
  },
  messageContainer: {
    marginBottom: Spacing.sm,
    maxWidth: "80%",
    alignSelf: "flex-start",
  },
  ownMessageContainer: {
    alignSelf: "flex-end",
  },
  senderName: {
    fontSize: 12,
    color: Colors.dark.secondary,
    marginBottom: 2,
    marginLeft: Spacing.sm,
  },
  messageBubble: {
    backgroundColor: Colors.dark.backgroundSecondary,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderBottomLeftRadius: BorderRadius.xs,
  },
  ownMessageBubble: {
    backgroundColor: Colors.dark.primary,
    borderBottomLeftRadius: BorderRadius.md,
    borderBottomRightRadius: BorderRadius.xs,
  },
  messageText: {
    fontSize: 16,
    color: Colors.dark.text,
  },
  ownMessageText: {
    color: Colors.dark.buttonText,
  },
  messageTime: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  ownMessageTime: {
    color: Colors.dark.buttonText + "99",
  },
  messageFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: Spacing.xs,
  },
  timerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 6,
  },
  timerText: {
    fontSize: 10,
    fontWeight: "600",
    marginLeft: 2,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 100,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginTop: Spacing.md,
    textAlign: "center",
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    backgroundColor: Colors.dark.backgroundDefault,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: 16,
    color: Colors.dark.text,
    maxHeight: 120,
    marginRight: Spacing.sm,
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
    backgroundColor: Colors.dark.backgroundSecondary,
  },
  sendButtonPressed: {
    opacity: 0.8,
  },
});
