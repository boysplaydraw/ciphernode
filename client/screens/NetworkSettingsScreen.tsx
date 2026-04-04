import React, { useState, useEffect } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius, Fonts } from "@/constants/theme";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { getSettings, updateSettings } from "@/lib/storage";
import {
  setCustomServerUrl,
  getApiUrl,
  getOfficialServerUrl,
} from "@/lib/query-client";
import { reconnectToServer, initSocket, isConnected } from "@/lib/socket";
import { getOrCreateIdentity } from "@/lib/crypto";
import { useLanguage } from "@/constants/language";

type ServerType = "official" | "custom";

export default function NetworkSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { language } = useLanguage();

  const [serverType, setServerType] = useState<ServerType>("official");
  const [customUrl, setCustomUrl] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [connectionTimedOut, setConnectionTimedOut] = useState(false);
  const [onionAddress, setOnionAddress] = useState<string | null>(null);

  const officialUrl = getOfficialServerUrl();
  const hasOfficialServer = !!officialUrl;

  const t = {
    serverSettings: language === "tr" ? "Sunucu Ayarları" : "Server Settings",
    officialServer: language === "tr" ? "Varsayılan Sunucu" : "Default Server",
    officialServerDesc: hasOfficialServer
      ? officialUrl!
      : language === "tr"
        ? "Henüz yapılandırılmadı"
        : "Not configured yet",
    officialServerNotConfigured:
      language === "tr"
        ? "Bu uygulama henüz bir varsayılan sunucuya bağlanacak şekilde derlenmemiş. Aşağıdan kendi sunucu adresinizi girin."
        : "This app build has no default server configured. Enter your server address below.",
    customServer: language === "tr" ? "Özel Sunucu" : "Custom Server",
    customServerDesc:
      language === "tr"
        ? "Farklı bir röle sunucusuna bağlan"
        : "Connect to a different relay server",
    serverUrl: language === "tr" ? "Sunucu URL" : "Server URL",
    testConnection:
      language === "tr" ? "Bağlantıyı Test Et" : "Test Connection",
    testing: language === "tr" ? "Test ediliyor..." : "Testing...",
    retry: language === "tr" ? "Tekrar Bağlan" : "Reconnect",
    retrying: language === "tr" ? "Bağlanıyor..." : "Connecting...",
    connectionTimeout:
      language === "tr"
        ? "Bağlantı zaman aşımına uğradı"
        : "Connection timed out",
    retryHint:
      language === "tr"
        ? "Sunucu adresini kontrol edip tekrar deneyin."
        : "Check server address and try again.",
    save: language === "tr" ? "Kaydet" : "Save",
    error: language === "tr" ? "Hata" : "Error",
    enterValidUrl:
      language === "tr"
        ? "Geçerli bir sunucu URL'si girin"
        : "Please enter a valid server URL",
    invalidUrl:
      language === "tr"
        ? "Geçerli bir URL girin (ör: http://192.168.1.10:5000 veya https://sunucu.com)"
        : "Enter a valid URL (e.g., http://192.168.1.10:5000 or https://server.com)",
    saved: language === "tr" ? "Kaydedildi" : "Saved",
    customUrlSaved:
      language === "tr"
        ? "Özel sunucu URL'si kaydedildi"
        : "Custom server URL has been saved",
    connectionSuccess:
      language === "tr" ? "Bağlantı Başarılı" : "Connection Successful",
    serverOnline:
      language === "tr"
        ? "Sunucu çevrimiçi ve erişilebilir"
        : "Server is online and accessible",
    connectionFailed:
      language === "tr" ? "Bağlantı Başarısız" : "Connection Failed",
    serverUnreachable:
      language === "tr"
        ? "Sunucuya ulaşılamıyor"
        : "Could not reach the server",
    selfHostTitle:
      language === "tr" ? "Kendi Sunucunu Kur" : "Self-Host Your Server",
    selfHostDesc:
      language === "tr"
        ? "Docker, Termux veya herhangi bir Linux sunucusunda çalıştırın. Kayıt yok, izleme yok, tam kontrol."
        : "Run on Docker, Termux, or any Linux server. No logs, no tracking, complete control.",
    selfHostDocker: "docker compose up -d",
    selfHostTermux: "bash termux-start.sh",
  };

  useEffect(() => {
    getSettings().then((s) => {
      if (s.serverUrl) {
        setServerType("custom");
        setCustomUrl(s.serverUrl);
      }
    });
    // Sunucunun .onion adresini al
    fetch(new URL("/api/onion-address", getApiUrl()).toString())
      .then((r) => r.json())
      .then((d) => { if (d.onionAddress) setOnionAddress(d.onionAddress); })
      .catch(() => {});
  }, []);

  const handleServerTypeChange = async (type: ServerType) => {
    setServerType(type);
    if (type === "official") {
      await updateSettings({ serverUrl: "" });
      setCustomServerUrl(null);
      setCustomUrl("");
      await doReconnect();
    }
  };

  /** Sunucu değişikliğinde yeniden bağlan */
  const doReconnect = async () => {
    setConnectionTimedOut(false);
    try {
      if (isConnected()) {
        await reconnectToServer();
      } else {
        const identity = await getOrCreateIdentity();
        await initSocket(identity.id, identity.publicKey);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("timeout") || msg.includes("Timeout")) {
        setConnectionTimedOut(true);
      } else {
        Alert.alert(t.error, t.connectionFailed);
      }
    }
  };

  /** Manuel yeniden bağlan butonu */
  const handleManualReconnect = async () => {
    setIsReconnecting(true);
    setConnectionTimedOut(false);
    try {
      await doReconnect();
    } finally {
      setIsReconnecting(false);
    }
  };

  const handleSaveCustomUrl = async () => {
    if (!customUrl.trim()) {
      Alert.alert(t.error, t.enterValidUrl);
      return;
    }

    try {
      new URL(customUrl);
    } catch {
      Alert.alert(t.error, t.invalidUrl);
      return;
    }

    await updateSettings({ serverUrl: customUrl.trim() });
    setCustomServerUrl(customUrl.trim());

    try {
      await doReconnect();
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert(t.saved, t.customUrlSaved);
    } catch {
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      Alert.alert(t.error, t.connectionFailed);
    }
  };

  const handleTestConnection = async () => {
    // Resmi sunucu modunda veya URL boşsa mevcut aktif sunucuyu test et
    const targetUrl =
      serverType === "custom" && customUrl.trim()
        ? customUrl.trim()
        : getApiUrl();

    setIsTesting(true);
    try {
      const testUrl = new URL("/api/health", targetUrl);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(testUrl.toString(), {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (data.status === "ok") {
          if (Platform.OS !== "web") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          Alert.alert(t.connectionSuccess, t.serverOnline);
        } else {
          Alert.alert(t.connectionFailed, t.serverUnreachable);
        }
      } else {
        Alert.alert(t.connectionFailed, t.serverUnreachable);
      }
    } catch (error) {
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      Alert.alert(t.connectionFailed, t.serverUnreachable);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xl,
        },
      ]}
    >
      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>{t.serverSettings}</ThemedText>

        {/* Resmi sunucu seçeneği — sadece EXPO_PUBLIC_SERVER_URL set edilmişse aktif */}
        <Pressable
          onPress={() =>
            hasOfficialServer ? handleServerTypeChange("official") : undefined
          }
          style={({ pressed }) => [
            styles.serverOption,
            serverType === "official" &&
              hasOfficialServer &&
              styles.serverOptionSelected,
            !hasOfficialServer && styles.serverOptionDisabled,
            pressed && hasOfficialServer && styles.serverOptionPressed,
          ]}
        >
          <View style={styles.serverOptionContent}>
            <View style={styles.serverOptionHeader}>
              <ThemedText
                style={[
                  styles.serverOptionTitle,
                  !hasOfficialServer && styles.serverOptionTitleDisabled,
                ]}
              >
                {t.officialServer}
              </ThemedText>
              {serverType === "official" && hasOfficialServer ? (
                <Feather
                  name="check-circle"
                  size={20}
                  color={Colors.dark.primary}
                />
              ) : !hasOfficialServer ? (
                <Feather
                  name="x-circle"
                  size={18}
                  color={Colors.dark.textDisabled}
                />
              ) : null}
            </View>
            <ThemedText
              style={[
                styles.serverOptionDesc,
                !hasOfficialServer && styles.serverOptionDescWarning,
              ]}
            >
              {t.officialServerDesc}
            </ThemedText>
          </View>
        </Pressable>

        {/* Resmi sunucu yoksa açıklama banner */}
        {!hasOfficialServer ? (
          <View style={styles.noOfficialServerBanner}>
            <Feather name="info" size={14} color={Colors.dark.warning} />
            <ThemedText style={styles.noOfficialServerText}>
              {t.officialServerNotConfigured}
            </ThemedText>
          </View>
        ) : null}

        <Pressable
          onPress={() => handleServerTypeChange("custom")}
          style={({ pressed }) => [
            styles.serverOption,
            serverType === "custom" && styles.serverOptionSelected,
            pressed && styles.serverOptionPressed,
          ]}
        >
          <View style={styles.serverOptionContent}>
            <View style={styles.serverOptionHeader}>
              <ThemedText style={styles.serverOptionTitle}>
                {t.customServer}
              </ThemedText>
              {serverType === "custom" ? (
                <Feather
                  name="check-circle"
                  size={20}
                  color={Colors.dark.primary}
                />
              ) : null}
            </View>
            <ThemedText style={styles.serverOptionDesc}>
              {t.customServerDesc}
            </ThemedText>
          </View>
        </Pressable>
      </View>

      {serverType === "official" && hasOfficialServer ? (
        <View style={styles.section}>
          <Pressable
            onPress={handleTestConnection}
            disabled={isTesting}
            style={({ pressed }) => [
              styles.secondaryButton,
              isTesting && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
          >
            <ThemedText
              style={[
                styles.secondaryButtonText,
                isTesting && styles.buttonTextDisabled,
              ]}
            >
              {isTesting ? t.testing : t.testConnection}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}

      {serverType === "custom" ? (
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>{t.serverUrl}</ThemedText>
          <TextInput
            style={styles.input}
            value={customUrl}
            onChangeText={setCustomUrl}
            placeholder="http://192.168.1.10:5000"
            placeholderTextColor={Colors.dark.textDisabled}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <View style={styles.buttonRow}>
            <Pressable
              onPress={handleTestConnection}
              disabled={isTesting}
              style={({ pressed }) => [
                styles.secondaryButton,
                isTesting && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
            >
              <ThemedText
                style={[
                  styles.secondaryButtonText,
                  isTesting && styles.buttonTextDisabled,
                ]}
              >
                {isTesting ? t.testing : t.testConnection}
              </ThemedText>
            </Pressable>

            <Pressable
              onPress={handleSaveCustomUrl}
              disabled={!customUrl.trim()}
              style={({ pressed }) => [
                styles.primaryButton,
                !customUrl.trim() && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
            >
              <ThemedText
                style={[
                  styles.primaryButtonText,
                  !customUrl.trim() && styles.buttonTextDisabled,
                ]}
              >
                {t.save}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      ) : null}

      {connectionTimedOut ? (
        <View style={styles.timeoutSection}>
          <Feather name="wifi-off" size={20} color={Colors.dark.error} />
          <View style={styles.timeoutTextBlock}>
            <ThemedText style={styles.timeoutTitle}>
              {t.connectionTimeout}
            </ThemedText>
            <ThemedText style={styles.timeoutHint}>{t.retryHint}</ThemedText>
          </View>
          <Pressable
            onPress={handleManualReconnect}
            disabled={isReconnecting}
            style={({ pressed }) => [
              styles.retryButton,
              isReconnecting && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
          >
            <ThemedText style={styles.retryButtonText}>
              {isReconnecting ? t.retrying : t.retry}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}

      {/* Tor .onion adresi — sunucu Tor hidden service olarak yapılandırılmışsa göster */}
      {onionAddress ? (
        <View style={styles.onionCard}>
          <View style={styles.onionHeader}>
            <Feather name="shield" size={16} color="#7D4F9E" />
            <ThemedText style={styles.onionTitle}>
              {language === "tr" ? "Tor .onion Adresi" : "Tor .onion Address"}
            </ThemedText>
          </View>
          <Pressable
            onPress={() => {
              Clipboard.setStringAsync(onionAddress);
              Alert.alert(
                language === "tr" ? "Kopyalandı" : "Copied",
                language === "tr" ? ".onion adresi kopyalandı" : ".onion address copied",
              );
            }}
            style={({ pressed }) => [styles.onionAddressBox, pressed && { opacity: 0.7 }]}
          >
            <ThemedText style={styles.onionAddress} numberOfLines={1}>{onionAddress}</ThemedText>
            <Feather name="copy" size={14} color="#7D4F9E" />
          </Pressable>
          <ThemedText style={styles.onionHint}>
            {language === "tr"
              ? "Bu adres Tor Browser ile erişilebilir. Sunucu URL olarak http://[adres] kullanın."
              : "Accessible via Tor Browser. Use http://[address] as the server URL."}
          </ThemedText>
        </View>
      ) : null}

      {/* Self-host yönlendirme kartı */}
      <View style={styles.selfHostCard}>
        <View style={styles.selfHostHeader}>
          <Feather name="server" size={16} color={Colors.dark.secondary} />
          <ThemedText style={styles.selfHostTitle}>
            {t.selfHostTitle}
          </ThemedText>
        </View>
        <ThemedText style={styles.selfHostDesc}>{t.selfHostDesc}</ThemedText>
        <View style={styles.codeBlock}>
          <ThemedText style={styles.codeLabel}>Docker</ThemedText>
          <ThemedText style={styles.codeText}>{t.selfHostDocker}</ThemedText>
        </View>
        <View style={styles.codeBlock}>
          <ThemedText style={styles.codeLabel}>Termux</ThemedText>
          <ThemedText style={styles.codeText}>{t.selfHostTermux}</ThemedText>
        </View>
      </View>

      <View style={styles.infoSection}>
        <Feather name="shield" size={20} color={Colors.dark.secondary} />
        <ThemedText style={styles.infoText}>
          {language === "tr"
            ? "Tüm relay sunucuları kayıt tutmaz. Mesajlar yalnızca RAM'de saklanır ve iletimden sonra silinir."
            : "All relay servers follow a no-log policy. Messages are stored in RAM only and deleted after delivery."}
        </ThemedText>
      </View>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.dark.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: Spacing.md,
    marginLeft: Spacing.sm,
  },
  serverOption: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
    borderWidth: 2,
    borderColor: "transparent",
  },
  serverOptionSelected: {
    borderColor: Colors.dark.primary,
  },
  serverOptionPressed: {
    backgroundColor: Colors.dark.backgroundSecondary,
  },
  serverOptionContent: {},
  serverOptionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.xs,
  },
  serverOptionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.text,
  },
  serverOptionDesc: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
  },
  serverOptionDisabled: {
    opacity: 0.5,
  },
  serverOptionTitleDisabled: {
    color: Colors.dark.textDisabled,
  },
  serverOptionDescWarning: {
    color: Colors.dark.warning,
    fontSize: 12,
  },
  noOfficialServerBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: Spacing.sm,
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: Colors.dark.warning,
  },
  noOfficialServerText: {
    flex: 1,
    fontSize: 12,
    color: Colors.dark.textSecondary,
    lineHeight: 18,
  },
  selfHostCard: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    columnGap: Spacing.sm,
  },
  selfHostHeader: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  selfHostTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.dark.text,
  },
  selfHostDesc: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    lineHeight: 18,
  },
  codeBlock: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    columnGap: Spacing.md,
  },
  codeLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: Colors.dark.secondary,
    textTransform: "uppercase",
    minWidth: 50,
  },
  codeText: {
    fontSize: 12,
    fontFamily: Fonts?.mono,
    color: Colors.dark.text,
    flex: 1,
  },
  input: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: 16,
    fontFamily: Fonts?.mono,
    color: Colors.dark.text,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    marginBottom: Spacing.md,
  },
  buttonRow: {
    flexDirection: "row",
    columnGap: Spacing.sm,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: Colors.dark.primary,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.md,
    alignItems: "center",
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: "transparent",
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.buttonText,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.primary,
  },
  buttonTextDisabled: {
    color: Colors.dark.textDisabled,
  },
  infoSection: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
    columnGap: Spacing.md,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: Colors.dark.textSecondary,
  },
  timeoutSection: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
    columnGap: Spacing.md,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.dark.error,
  },
  timeoutTextBlock: {
    flex: 1,
  },
  timeoutTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.dark.error,
    marginBottom: 2,
  },
  timeoutHint: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
  },
  retryButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    alignItems: "center",
  },
  retryButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.dark.buttonText,
  },
  onionCard: {
    backgroundColor: "#1A0D24",
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    borderColor: "#7D4F9E55",
  },
  onionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.sm,
    columnGap: Spacing.sm,
  },
  onionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#B57BDE",
  },
  onionAddressBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2D1040",
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  onionAddress: {
    flex: 1,
    fontSize: 12,
    fontFamily: Fonts?.mono,
    color: "#B57BDE",
    marginRight: Spacing.sm,
  },
  onionHint: {
    fontSize: 11,
    color: "#7D4F9E",
    lineHeight: 16,
  },
});
