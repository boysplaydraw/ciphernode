/**
 * MatchingScreen — privay app'in MatchingView'ından port + gerçek backend bağlantısı.
 * socket.ts üzerinden matching:start / accept / decline / cancel kullanır.
 * Bağlantı kurulunca şifreli mesajlaşma + dosya paylaşımı aktif olur.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Animated,
  Platform,
  Alert,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as DocumentPicker from "expo-document-picker";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { useLanguage } from "@/constants/language";
import {
  startMatching as socketStartMatching,
  cancelMatching as socketCancelMatching,
  acceptMatch as socketAcceptMatch,
  declineMatch as socketDeclineMatch,
  endMatchSession as socketEndSession,
  sendMatchingMessage,
  sendMatchingFileShare,
  onMatchingEvent,
  isConnected,
} from "@/lib/socket";
import { formatFileSize } from "@/lib/file-share";
import { getApiUrl, getTunnelBypassHeaders } from "@/lib/query-client";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useLowPower } from "@/constants/lowPower";

type MatchStatus =
  | "idle"
  | "searching"
  | "found"
  | "waiting_partner"
  | "connected"
  | "declined"
  | "partner_left";

interface MatchInfo {
  sessionId: string;
  partnerAlias: string;
  trustScore: number;
}

interface ChatItem {
  id: string;
  type: "text" | "file";
  content: string;
  mine: boolean;
  timestamp: number;
  // file alanları
  fileId?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  encryptedKey?: string;
}

// ── Radar dalgası ────────────────────────────────────────────────────
function RadarRing({ delay, disabled }: { delay: number; disabled?: boolean }) {
  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(disabled ? 0 : 0.6)).current;

  useEffect(() => {
    if (disabled) {
      scale.setValue(1);
      opacity.setValue(0);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 2.8,
            duration: 2200,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 2200,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 0.6,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.6,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [disabled]);

  return (
    <Animated.View
      style={[styles.radarRing, { transform: [{ scale }], opacity }]}
    />
  );
}

// ── Ana ekran ────────────────────────────────────────────────────────
export default function MatchingScreen() {
  const { language } = useLanguage();
  const isTr = language === "tr";
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { lowPowerMode } = useLowPower();
  const [status, setStatus] = useState<MatchStatus>("idle");
  const [myAlias, setMyAlias] = useState<string>("");
  const [matchInfo, setMatchInfo] = useState<MatchInfo | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Bağlantı kurulunca chat
  const [chatItems, setChatItems] = useState<ChatItem[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sendingFile, setSendingFile] = useState(false);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const chatListRef = useRef<FlatList>(null);

  const haptic = () => {
    if (Platform.OS !== "web")
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // Socket olaylarını dinle
  useEffect(() => {
    const unsub = onMatchingEvent((event) => {
      switch (event.type) {
        case "queued":
          setMyAlias(event.alias);
          setStatus("searching");
          break;

        case "found":
          setMatchInfo({
            sessionId: event.sessionId,
            partnerAlias: event.partnerAlias,
            trustScore: event.trustScore,
          });
          setSessionId(event.sessionId);
          setStatus("found");
          if (Platform.OS !== "web")
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          break;

        case "partner_accepted":
          setStatus("waiting_partner");
          break;

        case "connected":
          setStatus("connected");
          setSessionId(event.sessionId);
          if (Platform.OS !== "web")
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          break;

        case "declined":
        case "declined_by_you":
          setStatus("declined");
          setMatchInfo(null);
          setSessionId(null);
          break;

        case "partner_left":
        case "session_ended":
          setStatus("partner_left");
          setSessionId(null);
          break;

        case "cancelled":
          setStatus("idle");
          break;

        case "message":
          setChatItems((prev) => [
            ...prev,
            {
              id: `msg-${Date.now()}-${Math.random()}`,
              type: "text",
              content: event.encrypted,
              mine: false,
              timestamp: event.timestamp,
            },
          ]);
          if (Platform.OS !== "web")
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          break;

        case "file_share":
          setChatItems((prev) => [
            ...prev,
            {
              id: `file-${event.fileId}`,
              type: "file",
              content: event.fileName,
              mine: false,
              timestamp: event.timestamp,
              fileId: event.fileId,
              fileName: event.fileName,
              fileSize: event.fileSize,
              mimeType: event.mimeType,
              encryptedKey: event.encryptedKey,
            },
          ]);
          if (Platform.OS !== "web")
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          break;

        case "error":
          Alert.alert(isTr ? "Hata" : "Error", event.message, [
            { text: "Tamam" },
          ]);
          setStatus("idle");
          break;
      }
    });
    return unsub;
  }, [isTr]);

  const handleStart = () => {
    haptic();
    if (!isConnected()) {
      Alert.alert(
        isTr ? "Bağlantı Yok" : "Not Connected",
        isTr
          ? "Sunucuya bağlı değilsiniz. Lütfen ağ bağlantınızı kontrol edin."
          : "Not connected to server. Please check your network.",
        [{ text: "Tamam" }],
      );
      return;
    }
    setStatus("searching");
    socketStartMatching();
  };

  const handleCancel = () => {
    haptic();
    socketCancelMatching();
    setStatus("idle");
  };

  const handleAccept = () => {
    haptic();
    if (sessionId) {
      socketAcceptMatch(sessionId);
      setStatus("waiting_partner");
    }
  };

  const handleDecline = () => {
    haptic();
    if (sessionId) {
      socketDeclineMatch(sessionId);
      setStatus("declined");
      setMatchInfo(null);
      setSessionId(null);
    }
  };

  const handleEndSession = () => {
    haptic();
    if (sessionId) socketEndSession(sessionId);
    setStatus("idle");
    setMatchInfo(null);
    setSessionId(null);
    setChatItems([]);
  };

  // Mesaj gönder (anonim oturumda)
  const handleSendChatMessage = useCallback(() => {
    if (!chatInput.trim() || !sessionId) return;
    if (!isConnected()) {
      Alert.alert(
        isTr ? "Bağlantı Yok" : "Not Connected",
        isTr ? "Sunucuya bağlı değilsiniz." : "Not connected to server.",
        [{ text: "OK" }],
      );
      return;
    }
    const text = chatInput.trim();
    // Anonim oturumda mesaj şifreleme yoktur (her iki taraf da anonim key'e sahip değil)
    // Mesajlar transit şifreleme ile gönderilir (TLS/Tor)
    sendMatchingMessage(sessionId, text);
    setChatItems((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}`,
        type: "text",
        content: text,
        mine: true,
        timestamp: Date.now(),
      },
    ]);
    setChatInput("");
    if (Platform.OS !== "web")
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [chatInput, sessionId, isTr]);

  // Dosya gönder (anonim oturumda)
  const handleSendFile = useCallback(async () => {
    if (!sessionId) return;
    if (!isConnected()) {
      Alert.alert(
        isTr ? "Bağlantı Yok" : "Not Connected",
        isTr ? "Sunucuya bağlı değilsiniz." : "Not connected to server.",
        [{ text: "OK" }],
      );
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

      // Platform-aware dosya okuma (new Response(blob).arrayBuffer() native'de çalışmaz)
      let fileData: ArrayBuffer;
      if (Platform.OS === "web") {
        const response = await fetch(asset.uri);
        const blob = await response.blob();
        fileData = await blob.arrayBuffer();
      } else {
        const base64 = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const binaryStr = atob(base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++)
          bytes[i] = binaryStr.charCodeAt(i);
        fileData = bytes.buffer;
      }
      const aesKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"],
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv as unknown as BufferSource },
        aesKey,
        fileData,
      );
      const rawKey = await crypto.subtle.exportKey("raw", aesKey);

      // iv + key birleştir, base64 yap
      const combined = new Uint8Array(12 + 32);
      combined.set(iv);
      combined.set(new Uint8Array(rawKey), 12);
      const encryptedKey = btoa(String.fromCharCode(...combined));

      // Şifreli dosyayı base64'e çevir
      const encBytes = new Uint8Array(encrypted);
      let encBin = "";
      for (let i = 0; i < encBytes.length; i += 8192) {
        encBin += String.fromCharCode(...encBytes.slice(i, i + 8192));
      }
      const encryptedBase64 = btoa(encBin);

      // Relay'e yükle
      const apiUrl = getApiUrl();
      const uploadRes = await fetch(`${apiUrl}api/files/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getTunnelBypassHeaders(apiUrl),
        },
        body: JSON.stringify({
          name: asset.name,
          size: asset.size || fileData.byteLength,
          mimeType: asset.mimeType || "application/octet-stream",
          encryptedData: encryptedBase64,
          uploadedBy: "anonymous",
          maxDownloads: 2,
        }),
      });

      if (!uploadRes.ok) {
        throw new Error(
          isTr
            ? "Dosya sunucuya yüklenemedi. Ağ bağlantınızı kontrol edin."
            : "Failed to upload file. Check your network connection.",
        );
      }
      const { fileId } = await uploadRes.json();

      const fileSize = asset.size || fileData.byteLength;

      // Anonim partnere bildir
      sendMatchingFileShare(sessionId, {
        fileId,
        fileName: asset.name,
        fileSize,
        mimeType: asset.mimeType || "application/octet-stream",
        encryptedKey,
      });

      setChatItems((prev) => [
        ...prev,
        {
          id: `file-${fileId}`,
          type: "file",
          content: asset.name,
          mine: true,
          timestamp: Date.now(),
          fileId,
          fileName: asset.name,
          fileSize,
          mimeType: asset.mimeType || "application/octet-stream",
          encryptedKey,
        },
      ]);

      if (Platform.OS !== "web")
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert(
        isTr ? "Hata" : "Error",
        err instanceof Error ? err.message : "Dosya gönderilemedi",
      );
    } finally {
      setSendingFile(false);
    }
  }, [sessionId, isTr]);

  // Dosya indir (anonim modda — raw AES key ile)
  const handleDownloadAnonymousFile = useCallback(
    async (item: ChatItem) => {
      if (!item.fileId || !item.encryptedKey) return;
      setDownloadingFile(item.fileId);
      try {
        const apiUrl = getApiUrl();
        const res = await fetch(`${apiUrl}api/files/${item.fileId}`, {
          headers: getTunnelBypassHeaders(apiUrl),
        });
        if (!res.ok) throw new Error("Dosya indirilemedi");
        const fileData = await res.json();

        // raw AES key çöz
        const combined = Uint8Array.from(atob(item.encryptedKey), (c) =>
          c.charCodeAt(0),
        );
        const iv = combined.slice(0, 12);
        const keyBytes = combined.slice(12);
        const aesKey = await crypto.subtle.importKey(
          "raw",
          keyBytes,
          { name: "AES-GCM" },
          false,
          ["decrypt"],
        );

        // Deşifre et
        const encBin = atob(fileData.encryptedData);
        const encBytes = new Uint8Array(encBin.length);
        for (let i = 0; i < encBin.length; i++)
          encBytes[i] = encBin.charCodeAt(i);
        const decrypted = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: iv as unknown as BufferSource },
          aesKey,
          encBytes.buffer,
        );

        if (Platform.OS === "web") {
          const blob = new Blob([decrypted], { type: fileData.mimeType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = fileData.name;
          a.click();
          URL.revokeObjectURL(url);
        } else {
          // Native: base64 olarak kaydet ve paylaş
          const decBytes = new Uint8Array(decrypted);
          let binary = "";
          for (let i = 0; i < decBytes.length; i += 8192) {
            binary += String.fromCharCode(...decBytes.slice(i, i + 8192));
          }
          const base64 = btoa(binary);
          const fileUri = `${FileSystem.cacheDirectory}${fileData.name}`;
          await FileSystem.writeAsStringAsync(fileUri, base64, {
            encoding: "base64",
          });
          await Sharing.shareAsync(fileUri, {
            mimeType: fileData.mimeType,
            dialogTitle: fileData.name,
          });
        }
      } catch (err) {
        Alert.alert(
          isTr ? "Hata" : "Error",
          err instanceof Error ? err.message : "İndirme başarısız",
        );
      } finally {
        setDownloadingFile(null);
      }
    },
    [isTr],
  );

  // Bağlantı kurulunca tam ekran chat göster
  if (status === "connected") {
    return (
      <ThemedView style={styles.container}>
        <KeyboardAvoidingView
          style={[
            styles.chatContainer,
            { paddingTop: headerHeight, paddingBottom: tabBarHeight },
          ]}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={headerHeight}
        >
          {/* Başlık */}
          <View style={styles.chatHeader}>
            <View style={styles.chatHeaderLeft}>
              <View style={styles.connectedDot} />
              <ThemedText style={styles.chatHeaderTitle}>
                {matchInfo?.partnerAlias || "Anonymous"}
              </ThemedText>
              <View style={styles.encryptedBadge}>
                <Feather name="lock" size={10} color={Colors.dark.success} />
                <ThemedText style={styles.encryptedBadgeText}>
                  {isTr ? "Şifreli" : "Encrypted"}
                </ThemedText>
              </View>
            </View>
            <Pressable
              onPress={handleEndSession}
              style={({ pressed }) => [
                styles.endSessionBtnSmall,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Feather name="log-out" size={14} color={Colors.dark.error} />
              <ThemedText style={styles.endSessionTextSmall}>
                {isTr ? "Sonlandır" : "End"}
              </ThemedText>
            </Pressable>
          </View>

          {/* Mesajlar */}
          <FlatList
            ref={chatListRef}
            style={styles.chatList}
            data={chatItems}
            keyExtractor={(item) => item.id}
            onContentSizeChange={() =>
              chatListRef.current?.scrollToEnd({ animated: true })
            }
            renderItem={({ item }) => (
              <View
                style={[
                  styles.chatBubble,
                  item.mine ? styles.chatBubbleMine : styles.chatBubbleTheirs,
                ]}
              >
                {item.type === "text" ? (
                  <ThemedText
                    style={[styles.chatText, item.mine && styles.chatTextMine]}
                  >
                    {item.content}
                  </ThemedText>
                ) : (
                  <View style={styles.fileBubble}>
                    <Feather
                      name="paperclip"
                      size={14}
                      color={
                        item.mine ? Colors.dark.buttonText : Colors.dark.primary
                      }
                    />
                    <View style={styles.fileBubbleInfo}>
                      <ThemedText
                        style={[
                          styles.fileBubbleName,
                          item.mine && styles.chatTextMine,
                        ]}
                        numberOfLines={1}
                      >
                        {item.fileName}
                      </ThemedText>
                      <ThemedText
                        style={[
                          styles.fileBubbleSize,
                          item.mine && { color: Colors.dark.buttonText + "99" },
                        ]}
                      >
                        {formatFileSize(item.fileSize || 0)}
                      </ThemedText>
                    </View>
                    {!item.mine && (
                      <Pressable
                        onPress={() => handleDownloadAnonymousFile(item)}
                        disabled={downloadingFile === item.fileId}
                        style={({ pressed }) => [
                          styles.fileDlBtn,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <Feather
                          name={
                            downloadingFile === item.fileId
                              ? "loader"
                              : "download"
                          }
                          size={14}
                          color={Colors.dark.buttonText}
                        />
                      </Pressable>
                    )}
                  </View>
                )}
                <ThemedText
                  style={[styles.chatTime, item.mine && styles.chatTimeMine]}
                >
                  {new Date(item.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </ThemedText>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.chatEmpty}>
                <Feather
                  name="message-circle"
                  size={28}
                  color={Colors.dark.textSecondary}
                />
                <ThemedText style={styles.chatEmptyText}>
                  {isTr
                    ? "Anonim oturum başladı. Mesaj veya dosya gönderebilirsiniz."
                    : "Anonymous session started. You can send messages or files."}
                </ThemedText>
              </View>
            }
            contentContainerStyle={styles.chatListContent}
          />

          {/* Input */}
          <View style={styles.chatInputRow}>
            <Pressable
              onPress={handleSendFile}
              disabled={sendingFile}
              style={({ pressed }) => [
                styles.chatAttachBtn,
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
              style={styles.chatTextInput}
              value={chatInput}
              onChangeText={setChatInput}
              placeholder={isTr ? "Mesaj yaz..." : "Type a message..."}
              placeholderTextColor={Colors.dark.textDisabled}
              multiline
              maxLength={2000}
            />
            <Pressable
              onPress={handleSendChatMessage}
              disabled={!chatInput.trim()}
              style={({ pressed }) => [
                styles.chatSendBtn,
                !chatInput.trim() && styles.chatSendBtnDisabled,
                pressed && { opacity: 0.8 },
              ]}
            >
              <Feather
                name="send"
                size={18}
                color={
                  chatInput.trim()
                    ? Colors.dark.buttonText
                    : Colors.dark.textDisabled
                }
              />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View
        style={[
          styles.inner,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: tabBarHeight + Spacing.xl,
          },
        ]}
      >
        {/* ── BOŞ DURUM ── */}
        {status === "idle" && (
          <View style={styles.card}>
            <View style={styles.idleIcon}>
              <Feather name="shuffle" size={32} color={Colors.dark.primary} />
            </View>
            <ThemedText style={styles.cardTitle}>
              {isTr ? "Anonim Eşleşme" : "Anonymous Match"}
            </ThemedText>
            <ThemedText style={styles.cardDesc}>
              {isTr
                ? "Rastgele bir kişiyle anonim, geçici bir sohbet başlat. Oturum sona erince tüm veriler silinir."
                : "Start an anonymous, temporary chat with a random person. All data is deleted when the session ends."}
            </ThemedText>

            <View style={styles.infoGrid}>
              {[
                {
                  icon: "shield",
                  label: isTr ? "Kimlik gizli" : "Identity hidden",
                },
                {
                  icon: "users",
                  label: isTr ? "Anonim eşleşme" : "Anonymous match",
                },
                {
                  icon: "trash-2",
                  label: isTr ? "Veri silinir" : "Data deleted",
                },
              ].map(({ icon, label }, i) => (
                <View key={i} style={styles.infoItem}>
                  <Feather
                    name={icon as any}
                    size={16}
                    color={Colors.dark.primary}
                  />
                  <ThemedText style={styles.infoLabel}>{label}</ThemedText>
                </View>
              ))}
            </View>

            <Pressable
              onPress={handleStart}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && styles.btnPressed,
              ]}
            >
              <Feather
                name="shuffle"
                size={18}
                color={Colors.dark.buttonText}
              />
              <ThemedText style={styles.primaryBtnText}>
                {isTr ? "Eşleşme Başlat" : "Start Matching"}
              </ThemedText>
            </Pressable>
          </View>
        )}

        {/* ── ARAMA ── */}
        {status === "searching" && (
          <View style={styles.card}>
            <View style={styles.radarContainer}>
              <RadarRing delay={0} disabled={lowPowerMode} />
              <RadarRing delay={550} disabled={lowPowerMode} />
              <RadarRing delay={1100} disabled={lowPowerMode} />
              <RadarRing delay={1650} disabled={lowPowerMode} />
              <View style={styles.radarCenter}>
                <Feather name="shuffle" size={24} color={Colors.dark.primary} />
              </View>
            </View>

            <ThemedText style={styles.cardTitle}>
              {isTr ? "Eşleşme Aranıyor..." : "Searching..."}
            </ThemedText>
            {myAlias ? (
              <ThemedText style={styles.aliasTag}>{myAlias}</ThemedText>
            ) : null}
            <ThemedText style={styles.cardDesc}>
              {isTr
                ? "Anonim bağlantılar taranıyor"
                : "Scanning anonymous connections"}
            </ThemedText>

            <Pressable
              onPress={handleCancel}
              style={({ pressed }) => [
                styles.secondaryBtn,
                pressed && styles.btnPressed,
              ]}
            >
              <ThemedText style={styles.secondaryBtnText}>
                {isTr ? "İptal" : "Cancel"}
              </ThemedText>
            </Pressable>
          </View>
        )}

        {/* ── EŞLEŞME BULUNDU ── */}
        {(status === "found" || status === "waiting_partner") && matchInfo && (
          <View style={styles.card}>
            <ThemedText style={styles.foundLabel}>
              {status === "waiting_partner"
                ? isTr
                  ? "PARTNER BEKLENİYOR..."
                  : "WAITING FOR PARTNER..."
                : isTr
                  ? "EŞLEŞmE BULUNDU"
                  : "MATCH FOUND"}
            </ThemedText>

            <View style={styles.matchCard}>
              <View style={styles.avatarCircle}>
                <ThemedText style={styles.avatarLetter}>
                  {matchInfo.partnerAlias[0].toUpperCase()}
                </ThemedText>
              </View>
              <ThemedText style={styles.matchAlias}>
                {matchInfo.partnerAlias}
              </ThemedText>

              <View style={styles.trustRow}>
                <Feather name="star" size={12} color={Colors.dark.warning} />
                <ThemedText style={styles.trustText}>
                  {isTr
                    ? `Güven Puanı: ${matchInfo.trustScore}/100`
                    : `Trust Score: ${matchInfo.trustScore}/100`}
                </ThemedText>
              </View>
            </View>

            {status === "found" ? (
              <View style={styles.btnRow}>
                <Pressable
                  onPress={handleDecline}
                  style={({ pressed }) => [
                    styles.declineBtn,
                    pressed && styles.btnPressed,
                  ]}
                >
                  <Feather name="x" size={22} color={Colors.dark.error} />
                </Pressable>
                <Pressable
                  onPress={handleAccept}
                  style={({ pressed }) => [
                    styles.acceptBtn,
                    pressed && styles.btnPressed,
                  ]}
                >
                  <Feather
                    name="check"
                    size={18}
                    color={Colors.dark.buttonText}
                  />
                  <ThemedText style={styles.acceptBtnText}>
                    {isTr ? "Bağlan" : "Connect"}
                  </ThemedText>
                </Pressable>
              </View>
            ) : (
              <ThemedText style={styles.cardDesc}>
                {isTr
                  ? "Partnerinizin kabul etmesi bekleniyor..."
                  : "Waiting for partner to accept..."}
              </ThemedText>
            )}
          </View>
        )}

        {/* ── REDDEDİLDİ ── */}
        {status === "declined" && (
          <View style={styles.card}>
            <View
              style={[
                styles.idleIcon,
                { backgroundColor: Colors.dark.error + "18" },
              ]}
            >
              <Feather name="x-circle" size={36} color={Colors.dark.error} />
            </View>
            <ThemedText
              style={[styles.cardTitle, { color: Colors.dark.error }]}
            >
              {isTr ? "Reddedildi" : "Declined"}
            </ThemedText>
            <ThemedText style={styles.cardDesc}>
              {isTr ? "Eşleşme reddedildi." : "The match was declined."}
            </ThemedText>
            <Pressable
              onPress={() => setStatus("idle")}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && styles.btnPressed,
              ]}
            >
              <Feather
                name="shuffle"
                size={18}
                color={Colors.dark.buttonText}
              />
              <ThemedText style={styles.primaryBtnText}>
                {isTr ? "Tekrar Dene" : "Try Again"}
              </ThemedText>
            </Pressable>
          </View>
        )}

        {/* ── PARTNER AYRILDI ── */}
        {status === "partner_left" && (
          <View style={styles.card}>
            <View
              style={[
                styles.idleIcon,
                { backgroundColor: Colors.dark.warning + "18" },
              ]}
            >
              <Feather name="user-x" size={36} color={Colors.dark.warning} />
            </View>
            <ThemedText
              style={[styles.cardTitle, { color: Colors.dark.warning }]}
            >
              {isTr ? "Partner Ayrıldı" : "Partner Left"}
            </ThemedText>
            <ThemedText style={styles.cardDesc}>
              {isTr
                ? "Oturum sona erdi. Yeni bir eşleşme başlatabilirsiniz."
                : "The session has ended. You can start a new match."}
            </ThemedText>
            <Pressable
              onPress={() => {
                setStatus("idle");
                setMatchInfo(null);
                setChatItems([]);
              }}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && styles.btnPressed,
              ]}
            >
              <Feather
                name="shuffle"
                size={18}
                color={Colors.dark.buttonText}
              />
              <ThemedText style={styles.primaryBtnText}>
                {isTr ? "Yeni Eşleşme" : "New Match"}
              </ThemedText>
            </Pressable>
          </View>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
  inner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
  },
  idleIcon: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: Colors.dark.primary + "18",
    borderWidth: 1,
    borderColor: Colors.dark.primary + "33",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xl,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.dark.text,
    marginBottom: Spacing.sm,
    textAlign: "center",
  },
  cardDesc: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  aliasTag: {
    fontSize: 13,
    color: Colors.dark.primary,
    fontWeight: "600",
    marginBottom: Spacing.sm,
    backgroundColor: Colors.dark.primary + "18",
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: 12,
  },
  infoGrid: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
    width: "100%",
  },
  infoItem: {
    flex: 1,
    alignItems: "center",
    gap: Spacing.xs,
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.xs,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  infoLabel: {
    fontSize: 10,
    color: Colors.dark.textSecondary,
    textAlign: "center",
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.dark.primary,
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.xs,
    gap: Spacing.sm,
    width: "100%",
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.dark.buttonText,
  },
  btnPressed: { opacity: 0.8 },
  secondaryBtn: {
    paddingHorizontal: Spacing["2xl"],
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  secondaryBtnText: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
  },
  // Radar
  radarContainer: {
    width: 160,
    height: 160,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xl,
  },
  radarRing: {
    position: "absolute",
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 1,
    borderColor: Colors.dark.primary + "44",
  },
  radarCenter: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.dark.primary + "22",
    borderWidth: 2,
    borderColor: Colors.dark.primary + "55",
    alignItems: "center",
    justifyContent: "center",
  },
  // Found
  foundLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
    color: Colors.dark.textSecondary,
    marginBottom: Spacing.lg,
    textTransform: "uppercase",
  },
  matchCard: {
    width: "100%",
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    padding: Spacing.xl,
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.dark.primary + "22",
    borderWidth: 2,
    borderColor: Colors.dark.primary + "55",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  avatarLetter: {
    fontSize: 26,
    fontWeight: "700",
    color: Colors.dark.primary,
  },
  matchAlias: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.dark.text,
    marginBottom: Spacing.sm,
  },
  trustRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  trustText: {
    fontSize: 12,
    color: Colors.dark.warning,
  },
  btnRow: {
    flexDirection: "row",
    gap: Spacing.md,
    width: "100%",
  },
  declineBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.dark.error + "18",
    borderWidth: 1,
    borderColor: Colors.dark.error + "44",
    alignItems: "center",
    justifyContent: "center",
  },
  acceptBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.dark.primary,
    borderRadius: BorderRadius.xs,
    gap: Spacing.sm,
    height: 56,
  },
  acceptBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.dark.buttonText,
  },
  endSessionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderColor: Colors.dark.error + "55",
    backgroundColor: Colors.dark.error + "10",
  },
  endSessionText: {
    fontSize: 14,
    color: Colors.dark.error,
    fontWeight: "600",
  },
  // ── Chat ekranı ────────────────────────────────────────────────────
  chatContainer: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
    backgroundColor: Colors.dark.backgroundDefault,
  },
  chatHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flex: 1,
  },
  connectedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.dark.success,
  },
  chatHeaderTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.dark.text,
  },
  encryptedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: Colors.dark.success + "18",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  encryptedBadgeText: {
    fontSize: 10,
    color: Colors.dark.success,
    fontWeight: "600",
  },
  endSessionBtnSmall: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderColor: Colors.dark.error + "44",
    backgroundColor: Colors.dark.error + "10",
  },
  endSessionTextSmall: {
    fontSize: 12,
    color: Colors.dark.error,
    fontWeight: "600",
  },
  chatList: {
    flex: 1,
  },
  chatListContent: {
    flexGrow: 1,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  chatEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    gap: Spacing.md,
  },
  chatEmptyText: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    maxWidth: 260,
  },
  chatBubble: {
    maxWidth: "78%",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  chatBubbleMine: {
    alignSelf: "flex-end",
    backgroundColor: Colors.dark.messageSent,
    borderBottomRightRadius: 4,
  },
  chatBubbleTheirs: {
    alignSelf: "flex-start",
    backgroundColor: Colors.dark.messageReceived,
    borderBottomLeftRadius: 4,
  },
  chatText: {
    fontSize: 15,
    color: Colors.dark.text,
  },
  chatTextMine: {
    color: Colors.dark.buttonText,
  },
  chatTime: {
    fontSize: 10,
    color: Colors.dark.textSecondary,
    textAlign: "right",
    marginTop: 2,
  },
  chatTimeMine: {
    color: Colors.dark.buttonText,
    opacity: 0.7,
  },
  fileBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    minWidth: 160,
  },
  fileBubbleInfo: {
    flex: 1,
  },
  fileBubbleName: {
    fontSize: 13,
    color: Colors.dark.text,
    fontWeight: "600",
  },
  fileBubbleSize: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  fileDlBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.dark.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  chatInputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.dark.backgroundDefault,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
    gap: Spacing.sm,
  },
  chatAttachBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  chatTextInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 15,
    color: Colors.dark.text,
  },
  chatSendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  chatSendBtnDisabled: {
    backgroundColor: Colors.dark.backgroundSecondary,
  },
});
