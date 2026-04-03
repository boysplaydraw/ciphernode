import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  FlatList,
  TextInput,
  StyleSheet,
  Pressable,
  Platform,
  KeyboardAvoidingView,
  Alert,
  Linking,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import {
  useNavigation,
  useRoute,
  useFocusEffect,
} from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Fonts } from "@/constants/theme";
import {
  getChat,
  getContact,
  saveMessage,
  updateMessageStatus,
  markChatAsRead,
  generateMessageId,
  getSettings,
  calculateExpiresAt,
  cleanupExpiredMessagesForChat,
  deleteMessage,
  type Message,
} from "@/lib/storage";
import ActionSheet, { type ActionSheetOption } from "@/components/ActionSheet";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import {
  encryptMessage,
  decryptMessage,
  type Contact,
  type UserIdentity,
} from "@/lib/crypto";
import {
  sendMessage as socketSendMessage,
  onMessage,
  sendFileShare,
  onFileShare,
  type IncomingFileNotification,
} from "@/lib/socket";
import {
  shareFile,
  downloadAndDecryptFile,
  formatFileSize,
  getFileIcon,
  scrubFileMetadata,
} from "@/lib/file-share";
import { getApiUrl } from "@/lib/query-client";
import { getPrivacySettings } from "@/lib/storage";
import type { ChatsStackParamList } from "@/navigation/ChatsStackNavigator";
import { useIdentity } from "@/hooks/useIdentity";

type NavigationProp = NativeStackNavigationProp<
  ChatsStackParamList,
  "ChatThread"
>;
type ScreenRouteProp = RouteProp<ChatsStackParamList, "ChatThread">;

interface MessageBubbleProps {
  message: Message;
  isMine: boolean;
  currentTime: number;
  identity: UserIdentity | null;
  contact: Contact | null;
  onLongPress: (message: Message, displayContent: string) => void;
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

function MessageBubble({
  message,
  isMine,
  currentTime,
  identity,
  contact,
  onLongPress,
}: MessageBubbleProps) {
  const [displayContent, setDisplayContent] = useState(message.content);
  const [verified, setVerified] = useState<boolean | null>(null);

  const handleLongPress = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    onLongPress(message, displayContent);
  };

  useEffect(() => {
    const decrypt = async () => {
      if (isMine) {
        setDisplayContent(message.content);
        setVerified(true);
        return;
      }

      if (!identity?.privateKey) {
        setDisplayContent(message.content);
        return;
      }

      const encryptedPayload = message.encrypted || message.content;
      const isEncrypted = encryptedPayload.includes(
        "-----BEGIN PGP MESSAGE-----",
      );

      if (isEncrypted) {
        const senderPublicKey = contact?.publicKey;
        const result = await decryptMessage(
          encryptedPayload,
          identity.privateKey,
          senderPublicKey,
        );
        setDisplayContent(result.content);
        setVerified(result.verified);
      } else {
        setDisplayContent(message.content);
        setVerified(null);
      }
    };
    decrypt();
  }, [message.content, message.encrypted, identity, contact, isMine]);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Pressable
      onLongPress={handleLongPress}
      delayLongPress={500}
      style={[
        styles.messageBubble,
        isMine ? styles.messageBubbleMine : styles.messageBubbleTheirs,
      ]}
    >
      <ThemedText
        style={[
          styles.messageText,
          isMine ? styles.messageTextMine : styles.messageTextTheirs,
        ]}
      >
        {displayContent}
      </ThemedText>
      <View style={styles.messageFooter}>
        {message.expiresAt ? (
          <View style={styles.timerContainer}>
            <Feather
              name="clock"
              size={10}
              color={isMine ? Colors.dark.buttonText : Colors.dark.warning}
              style={styles.lockIcon}
            />
            <ThemedText
              style={[
                styles.timerText,
                {
                  color: isMine ? Colors.dark.buttonText : Colors.dark.warning,
                },
              ]}
            >
              {formatRemainingTime(message.expiresAt, currentTime)}
            </ThemedText>
          </View>
        ) : (
          <Feather
            name={verified === false ? "alert-triangle" : "lock"}
            size={10}
            color={
              verified === false
                ? Colors.dark.warning
                : isMine
                  ? Colors.dark.buttonText
                  : Colors.dark.secondary
            }
            style={styles.lockIcon}
          />
        )}
        <ThemedText
          style={[
            styles.messageTime,
            isMine ? styles.messageTimeMine : styles.messageTimeTheirs,
          ]}
        >
          {formatTime(message.timestamp)}
        </ThemedText>
      </View>
    </Pressable>
  );
}

export default function ChatThreadScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<ScreenRouteProp>();
  const { contactId } = route.params;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { identity } = useIdentity();

  const [messages, setMessages] = useState<Message[]>([]);
  const [contact, setContact] = useState<Contact | null>(null);
  const [inputText, setInputText] = useState("");
  const [messageTimer, setMessageTimer] = useState(0);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const flatListRef = useRef<FlatList>(null);
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<{
    message: Message;
    displayContent: string;
  } | null>(null);
  const [sendingFile, setSendingFile] = useState(false);
  const [incomingFiles, setIncomingFiles] = useState<
    IncomingFileNotification[]
  >([]);
  const [sentFiles, setSentFiles] = useState<
    Array<{ fileId: string; fileName: string; fileSize: number }>
  >([]);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

  useEffect(() => {
    const tickerInterval = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(tickerInterval);
  }, []);

  const loadData = useCallback(async () => {
    await cleanupExpiredMessagesForChat(contactId);
    const [chatDataRaw, contactData, settings] = await Promise.all([
      getChat(contactId),
      getContact(contactId),
      getSettings(),
    ]);
    const clonedMessages = chatDataRaw?.messages.map((m) => ({ ...m })) || [];
    setMessages(clonedMessages);
    setContact(contactData);
    setMessageTimer(settings.defaultMessageTimer);
    if (chatDataRaw) {
      await markChatAsRead(contactId);
    }
  }, [contactId]);

  useEffect(() => {
    const interval = setInterval(async () => {
      await cleanupExpiredMessagesForChat(contactId);
      const chatData = await getChat(contactId);
      if (chatData) {
        const clonedMessages = chatData.messages.map((m) => ({ ...m }));
        setMessages(clonedMessages);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [contactId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  React.useLayoutEffect(() => {
    const displayName = contact?.displayName || contact?.id || "Chat";
    navigation.setOptions({
      headerTitle: displayName,
      headerRight: () => (
        <Pressable
          onPress={() => navigation.navigate("ContactInfo", { contactId })}
          style={{ paddingHorizontal: 12, paddingVertical: 8 }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather name="info" size={22} color={Colors.dark.primary} />
        </Pressable>
      ),
    });
  }, [navigation, contact, contactId]);

  useEffect(() => {
    // Mesaj zaten App.tsx global handler tarafından kaydedildi,
    // sadece bu ekranla ilgili mesajlarda UI'yi güncelle
    const unsubscribe = onMessage((msg) => {
      if (msg.from === contactId) {
        loadData();
      }
    });
    return unsubscribe;
  }, [contactId, loadData]);

  // Gelen dosya bildirimlerini dinle
  useEffect(() => {
    const unsubscribe = onFileShare((notification) => {
      if (notification.from === contactId) {
        setIncomingFiles((prev) => [...prev, notification]);
      }
    });
    return unsubscribe;
  }, [contactId]);

  // Dosya gönder
  const handleSendFile = useCallback(async () => {
    if (!contact?.publicKey) {
      Alert.alert("Hata", "Bu kişinin açık anahtarı yok. Dosya şifrelenemez.", [
        { text: "Tamam" },
      ]);
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];

      setSendingFile(true);

      // autoMetadataScrubbing ayarını oku
      const privacySettings = await getPrivacySettings();

      let fileId: string;
      let encryptedKey: string;

      if (Platform.OS === "web") {
        // Web: fetch ile blob al, File nesnesi oluştur
        const response = await fetch(asset.uri);
        const fileBlob = await response.blob();
        const file = new File([fileBlob], asset.name, {
          type: asset.mimeType || "application/octet-stream",
        });
        ({ fileId, encryptedKey } = await shareFile({
          file,
          recipientPublicKey: contact.publicKey,
          senderPrivateKey: identity?.privateKey,
          scrubMetadata: privacySettings.autoMetadataScrubbing,
          onProgress: (p) => {
            if (p.stage === "error") Alert.alert("Yükleme Hatası", p.message);
          },
        }));
      } else {
        // Native (Android/iOS): base64 olarak oku, Blob oluşturmadan gönder
        const base64 = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        ({ fileId, encryptedKey } = await shareFile({
          fileBase64: base64,
          fileName: asset.name,
          fileMimeType: asset.mimeType || "application/octet-stream",
          fileSize: asset.size || 0,
          recipientPublicKey: contact.publicKey,
          senderPrivateKey: identity?.privateKey,
          onProgress: (p) => {
            if (p.stage === "error") Alert.alert("Yükleme Hatası", p.message);
          },
        }));
      }

      // Alıcıya socket bildirimi gönder
      sendFileShare(contactId, {
        fileId,
        fileName: asset.name,
        fileSize: asset.size || 0,
        mimeType: asset.mimeType || "application/octet-stream",
        encryptedKey,
      });

      setSentFiles((prev) => [
        ...prev,
        { fileId, fileName: asset.name, fileSize: asset.size || 0 },
      ]);
    } catch (err) {
      Alert.alert(
        "Hata",
        err instanceof Error ? err.message : "Dosya gönderilemedi",
      );
    } finally {
      setSendingFile(false);
    }
  }, [contact, identity, contactId]);

  // Dosya indir ve aç
  const handleDownloadFile = useCallback(
    async (notification: IncomingFileNotification) => {
      if (!identity?.privateKey) {
        Alert.alert("Hata", "Özel anahtar bulunamadı.");
        return;
      }
      setDownloadingFile(notification.fileId);
      try {
        const { data, dataBase64, name, mimeType } = await downloadAndDecryptFile({
          fileId: notification.fileId,
          encryptedKey: notification.encryptedKey,
          recipientPrivateKey: identity.privateKey,
        });

        // Dosyayı tarayıcıda / cihazda aç
        if (Platform.OS === "web") {
          const url = URL.createObjectURL(data!);
          const a = document.createElement("a");
          a.href = url;
          a.download = name;
          a.click();
          URL.revokeObjectURL(url);
        } else {
          // Native: base64'ü direkt yaz (Blob.arrayBuffer() Android'de çalışmaz)
          const fileUri = `${FileSystem.cacheDirectory}${name}`;
          await FileSystem.writeAsStringAsync(fileUri, dataBase64!, {
            encoding: "base64",
          });
          await Sharing.shareAsync(fileUri, { mimeType, dialogTitle: name });
        }

        // Bildirimden kaldır
        setIncomingFiles((prev) =>
          prev.filter((f) => f.fileId !== notification.fileId),
        );
      } catch (err) {
        Alert.alert(
          "İndirme Hatası",
          err instanceof Error ? err.message : "Dosya indirilemedi",
        );
      } finally {
        setDownloadingFile(null);
      }
    },
    [identity],
  );

  const handleSendMessage = useCallback(async () => {
    if (!inputText.trim() || !identity || !contact) return;

    const messageId = generateMessageId();
    const plaintext = inputText.trim();
    let encryptedContent: string;

    try {
      if (contact.publicKey && identity.privateKey) {
        encryptedContent = await encryptMessage(
          plaintext,
          contact.publicKey,
          identity.privateKey,
        );
      } else if (contact.publicKey) {
        encryptedContent = await encryptMessage(plaintext, contact.publicKey);
      } else {
        // Kişinin açık anahtarı yok — şifreleme imkânsız
        Alert.alert(
          "Şifreleme Hatası",
          "Bu kişinin açık anahtarı bulunamadı. Mesaj gönderilmedi.\n\nKişiyi yeniden QR ile ekleyin.",
          [{ text: "Tamam" }],
        );
        return;
      }
    } catch (error) {
      // Şifreleme başarısız → düz metin ASLA gönderilmez
      Alert.alert(
        "Şifreleme Başarısız",
        "Mesajınız şifrelenemedi, güvenlik nedeniyle gönderilmedi.\n\n" +
          (error instanceof Error ? error.message : String(error)),
        [{ text: "Tamam" }],
      );
      return;
    }

    const message: Message = {
      id: messageId,
      content: plaintext,
      encrypted: encryptedContent,
      senderId: identity.id,
      recipientId: contactId,
      timestamp: Date.now(),
      status: "sending",
      expiresAt: calculateExpiresAt(messageTimer),
    };

    await saveMessage(contactId, message);
    setMessages((prev) => [...prev, message]);
    setInputText("");

    socketSendMessage(contactId, encryptedContent, messageId);

    // Mesaj gönderildi → "sent" yap
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, status: "sent" } : m)),
    );
    await updateMessageStatus(contactId, messageId, "sent");

    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [inputText, identity, contact, contactId, messageTimer]);

  const handleMessageLongPress = useCallback(
    (message: Message, displayContent: string) => {
      setSelectedMessage({ message, displayContent });
      setActionSheetVisible(true);
    },
    [],
  );

  const handleCopyMessage = useCallback(async () => {
    if (selectedMessage) {
      await Clipboard.setStringAsync(selectedMessage.displayContent);
    }
  }, [selectedMessage]);

  const handleDeleteMessage = useCallback(async () => {
    if (selectedMessage) {
      await deleteMessage(contactId, selectedMessage.message.id);
      setMessages((prev) =>
        prev.filter((m) => m.id !== selectedMessage.message.id),
      );
    }
  }, [selectedMessage, contactId]);

  const handleShareMessage = useCallback(async () => {
    if (selectedMessage) {
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(
          `data:text/plain;base64,${btoa(selectedMessage.displayContent)}`,
          {
            mimeType: "text/plain",
            dialogTitle: "Share Message",
          },
        );
      }
    }
  }, [selectedMessage]);

  const getActionSheetOptions = useCallback((): ActionSheetOption[] => {
    return [
      {
        text: "Copy",
        onPress: handleCopyMessage,
      },
      {
        text: "Share",
        onPress: handleShareMessage,
      },
      {
        text: "Delete",
        onPress: handleDeleteMessage,
        style: "destructive",
      },
      {
        text: "Cancel",
        onPress: () => {},
        style: "cancel",
      },
    ];
  }, [handleCopyMessage, handleShareMessage, handleDeleteMessage]);

  const bottomPadding = Math.max(insets.bottom, Spacing.md);

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={headerHeight}
      >
        <FlatList
          ref={flatListRef}
          style={styles.flatList}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              isMine={item.senderId === identity?.id}
              currentTime={currentTime}
              identity={identity}
              contact={contact}
              onLongPress={handleMessageLongPress}
            />
          )}
          contentContainerStyle={[
            styles.listContent,
            {
              paddingTop: headerHeight + Spacing.lg,
              paddingBottom: Spacing.md,
            },
          ]}
          inverted={false}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
          ListEmptyComponent={
            <View style={styles.emptyMessages}>
              <Feather name="lock" size={32} color={Colors.dark.secondary} />
              <ThemedText style={styles.emptyText}>
                Messages are end-to-end encrypted
              </ThemedText>
            </View>
          }
        />

        {/* Gönderilen ve gelen dosyalar */}
        {(sentFiles.length > 0 || incomingFiles.length > 0) && (
          <View style={styles.incomingFilesContainer}>
            {sentFiles.map((file) => (
              <View key={`sent-${file.fileId}`} style={[styles.incomingFileRow, styles.sentFileRow]}>
                <Feather name="upload" size={14} color={Colors.dark.secondary} />
                <ThemedText style={styles.incomingFileName} numberOfLines={1}>
                  {file.fileName}
                </ThemedText>
                <ThemedText style={styles.incomingFileSize}>
                  {formatFileSize(file.fileSize)}
                </ThemedText>
                <View style={styles.sentBadge}>
                  <ThemedText style={styles.sentBadgeText}>✓ Gönderildi</ThemedText>
                </View>
              </View>
            ))}
            {incomingFiles.map((file) => (
              <View key={file.fileId} style={styles.incomingFileRow}>
                <Feather
                  name="paperclip"
                  size={14}
                  color={Colors.dark.primary}
                />
                <ThemedText style={styles.incomingFileName} numberOfLines={1}>
                  {file.fileName}
                </ThemedText>
                <ThemedText style={styles.incomingFileSize}>
                  {formatFileSize(file.fileSize)}
                </ThemedText>
                <Pressable
                  onPress={() => handleDownloadFile(file)}
                  disabled={downloadingFile === file.fileId}
                  style={({ pressed }) => [
                    styles.downloadBtn,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Feather
                    name={
                      downloadingFile === file.fileId ? "loader" : "download"
                    }
                    size={14}
                    color={Colors.dark.buttonText}
                  />
                  <ThemedText style={styles.downloadBtnText}>
                    {downloadingFile === file.fileId
                      ? "İndiriliyor..."
                      : "İndir"}
                  </ThemedText>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={[styles.inputContainer, { paddingBottom: bottomPadding }]}>
          <Pressable
            onPress={handleSendFile}
            disabled={sendingFile}
            style={({ pressed }) => [
              styles.attachButton,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Feather
              name={sendingFile ? "loader" : "paperclip"}
              size={20}
              color={
                sendingFile
                  ? Colors.dark.textDisabled
                  : Colors.dark.textSecondary
              }
            />
          </Pressable>
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
            onPress={handleSendMessage}
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
              color={
                inputText.trim()
                  ? Colors.dark.buttonText
                  : Colors.dark.textDisabled
              }
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <ActionSheet
        visible={actionSheetVisible}
        onClose={() => setActionSheetVisible(false)}
        options={getActionSheetOptions()}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
  keyboardView: {
    flex: 1,
  },
  flatList: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
  },
  messageBubble: {
    maxWidth: "75%",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    marginVertical: Spacing.xs,
  },
  messageBubbleMine: {
    backgroundColor: Colors.dark.messageSent,
    alignSelf: "flex-end",
    borderBottomRightRadius: 4,
  },
  messageBubbleTheirs: {
    backgroundColor: Colors.dark.messageReceived,
    alignSelf: "flex-start",
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 16,
  },
  messageTextMine: {
    color: Colors.dark.buttonText,
  },
  messageTextTheirs: {
    color: Colors.dark.text,
  },
  messageFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: Spacing.xs,
  },
  lockIcon: {
    marginRight: 4,
  },
  timerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 6,
  },
  timerText: {
    fontSize: 10,
    fontWeight: "600",
  },
  messageTime: {
    fontSize: 10,
  },
  messageTimeMine: {
    color: Colors.dark.buttonText,
    opacity: 0.7,
  },
  messageTimeTheirs: {
    color: Colors.dark.textSecondary,
  },
  emptyMessages: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing["5xl"],
  },
  emptyText: {
    marginTop: Spacing.md,
    fontSize: 14,
    color: Colors.dark.textSecondary,
  },
  incomingFilesContainer: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  incomingFileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.dark.primary + "10",
    borderRadius: BorderRadius.xs,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.dark.primary + "33",
  },
  incomingFileName: {
    flex: 1,
    fontSize: 13,
    color: Colors.dark.text,
  },
  incomingFileSize: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  downloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.xs,
  },
  downloadBtnText: {
    fontSize: 11,
    color: Colors.dark.buttonText,
    fontWeight: "600",
  },
  sentFileRow: {
    backgroundColor: Colors.dark.secondary + "15",
    borderColor: Colors.dark.secondary + "33",
  },
  sentBadge: {
    backgroundColor: Colors.dark.secondary + "30",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  sentBadgeText: {
    fontSize: 11,
    color: Colors.dark.secondary,
    fontWeight: "600",
  },
  attachButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.xs,
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
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    fontSize: 16,
    color: Colors.dark.text,
    fontFamily: Fonts?.sans,
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
