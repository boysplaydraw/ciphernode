import React, { useState, useEffect } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius, Fonts } from "@/constants/theme";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { getSettings, updateSettings } from "@/lib/storage";
import { setCustomServerUrl } from "@/lib/query-client";
import { reconnectToServer } from "@/lib/socket";
import { useLanguage } from "@/constants/language";

type ServerType = "official" | "custom";

export default function NetworkSettingsScreen() {
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { language } = useLanguage();

  const [serverType, setServerType] = useState<ServerType>("official");
  const [customUrl, setCustomUrl] = useState("");
  const [isTesting, setIsTesting] = useState(false);

  const t = {
    serverSettings: language === "tr" ? "Sunucu Ayarları" : "Server Settings",
    officialServer: language === "tr" ? "Resmi Sunucu" : "Official Server",
    officialServerDesc: language === "tr" ? "CipherNode resmi röle sunucusunu kullan" : "Use the official CipherNode relay server",
    customServer: language === "tr" ? "Özel Sunucu" : "Custom Server",
    customServerDesc: language === "tr" ? "Kendi röle sunucunuzu kullanın" : "Use your own relay server",
    serverUrl: language === "tr" ? "Sunucu URL" : "Server URL",
    testConnection: language === "tr" ? "Bağlantıyı Test Et" : "Test Connection",
    testing: language === "tr" ? "Test ediliyor..." : "Testing...",
    save: language === "tr" ? "Kaydet" : "Save",
    error: language === "tr" ? "Hata" : "Error",
    enterValidUrl: language === "tr" ? "Geçerli bir sunucu URL'si girin" : "Please enter a valid server URL",
    invalidUrl: language === "tr" ? "Geçerli bir URL girin (ör: https://example.com)" : "Please enter a valid URL (e.g., https://example.com)",
    saved: language === "tr" ? "Kaydedildi" : "Saved",
    customUrlSaved: language === "tr" ? "Özel sunucu URL'si kaydedildi" : "Custom server URL has been saved",
    connectionSuccess: language === "tr" ? "Bağlantı Başarılı" : "Connection Successful",
    serverOnline: language === "tr" ? "Sunucu çevrimiçi ve erişilebilir" : "Server is online and accessible",
    connectionFailed: language === "tr" ? "Bağlantı Başarısız" : "Connection Failed",
    serverUnreachable: language === "tr" ? "Sunucuya ulaşılamıyor" : "Could not reach the server",
    selfHostInfo: language === "tr" ? "Kendi Barındırma Bilgisi" : "Self-Hosting Info",
    selfHostDesc: language === "tr" 
      ? "Docker ile kendi röle sunucunuzu çalıştırın. Kayıt yok, izleme yok, tam kontrol."
      : "Run your own relay server with Docker. No logs, no tracking, complete control.",
    viewDocs: language === "tr" ? "Dokümantasyonu Görüntüle" : "View Documentation",
  };

  useEffect(() => {
    getSettings().then((s) => {
      if (s.serverUrl) {
        setServerType("custom");
        setCustomUrl(s.serverUrl);
      }
    });
  }, []);

  const handleServerTypeChange = async (type: ServerType) => {
    setServerType(type);
    if (type === "official") {
      await updateSettings({ serverUrl: "" });
      setCustomServerUrl(null);
      setCustomUrl("");
      
      try {
        await reconnectToServer();
      } catch {
        Alert.alert(t.error, t.connectionFailed);
      }
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
      await reconnectToServer();
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
    if (!customUrl.trim()) return;
    
    setIsTesting(true);
    try {
      const testUrl = new URL("/api/health", customUrl.trim());
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
          paddingTop: headerHeight + Spacing.xl,
          paddingBottom: insets.bottom + Spacing.xl,
        },
      ]}
    >
      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>{t.serverSettings}</ThemedText>

        <Pressable
          onPress={() => handleServerTypeChange("official")}
          style={({ pressed }) => [
            styles.serverOption,
            serverType === "official" && styles.serverOptionSelected,
            pressed && styles.serverOptionPressed,
          ]}
        >
          <View style={styles.serverOptionContent}>
            <View style={styles.serverOptionHeader}>
              <ThemedText style={styles.serverOptionTitle}>{t.officialServer}</ThemedText>
              {serverType === "official" ? (
                <Feather name="check-circle" size={20} color={Colors.dark.primary} />
              ) : null}
            </View>
            <ThemedText style={styles.serverOptionDesc}>
              {t.officialServerDesc}
            </ThemedText>
          </View>
        </Pressable>

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
              <ThemedText style={styles.serverOptionTitle}>{t.customServer}</ThemedText>
              {serverType === "custom" ? (
                <Feather name="check-circle" size={20} color={Colors.dark.primary} />
              ) : null}
            </View>
            <ThemedText style={styles.serverOptionDesc}>
              {t.customServerDesc}
            </ThemedText>
          </View>
        </Pressable>
      </View>

      {serverType === "custom" ? (
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>{t.serverUrl}</ThemedText>
          <TextInput
            style={styles.input}
            value={customUrl}
            onChangeText={setCustomUrl}
            placeholder="https://your-server.com"
            placeholderTextColor={Colors.dark.textDisabled}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <View style={styles.buttonRow}>
            <Pressable
              onPress={handleTestConnection}
              disabled={!customUrl.trim() || isTesting}
              style={({ pressed }) => [
                styles.secondaryButton,
                (!customUrl.trim() || isTesting) && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
            >
              <ThemedText
                style={[
                  styles.secondaryButtonText,
                  (!customUrl.trim() || isTesting) && styles.buttonTextDisabled,
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
                Save
              </ThemedText>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.infoSection}>
        <Feather name="shield" size={20} color={Colors.dark.secondary} />
        <ThemedText style={styles.infoText}>
          All relay servers follow a no-log policy. Messages are stored in RAM only and deleted immediately after delivery.
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
    gap: Spacing.sm,
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
    gap: Spacing.md,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: Colors.dark.textSecondary,
  },
});
