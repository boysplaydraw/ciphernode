import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  ScrollView,
  TextInput,
  StyleSheet,
  Pressable,
  Switch,
  Platform,
  Alert,
  Modal,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { ComingSoonBadge } from "@/components/ComingSoonBadge";
import { Colors, Spacing, BorderRadius, Fonts } from "@/constants/theme";
import { useIdentity } from "@/hooks/useIdentity";
import {
  getSettings,
  updateSettings,
  getPrivacySettings,
  updatePrivacySettings,
  getTorSettings,
  updateTorSettings,
  setLanguage as saveLanguage,
  type PrivacySettings,
  type TorSettings,
} from "@/lib/storage";
import { exportIdentityBackup, importIdentityFromBackup } from "@/lib/crypto";
import * as Clipboard from "expo-clipboard";
import * as ScreenCapture from "expo-screen-capture";
import { reconnectWithTor, setStegMode, setP2POnlyMode } from "@/lib/socket";
import {
  SUPPORTED_LANGUAGES,
  type Language,
  useLanguage,
} from "@/constants/language";
import { Linking } from "react-native";
import {
  isElectron,
  electronEnableTor,
  electronDisableTor,
  electronVerifyTor,
  electronOnTorStatus,
  electronOpenExternal,
  electronBiometricIsAvailable,
  electronBiometricAuthenticate,
} from "@/lib/electron-bridge";
import { setGhostMode } from "@/lib/socket";
import { useLowPower } from "@/constants/lowPower";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";

type NavigationProp = NativeStackNavigationProp<
  SettingsStackParamList,
  "Settings"
>;

// Tüm privacy flags gerçek implementasyona sahip
const COMING_SOON_FLAGS: readonly string[] = [] as const;

interface SettingsRowProps {
  icon: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  comingSoon?: boolean;
}

function SettingsRow({
  icon,
  title,
  subtitle,
  onPress,
  rightElement,
  comingSoon,
}: SettingsRowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress || comingSoon}
      style={({ pressed }) => [
        styles.settingsRow,
        pressed && onPress && !comingSoon && styles.settingsRowPressed,
        comingSoon && styles.settingsRowDisabled,
      ]}
    >
      <View style={styles.settingsRowIcon}>
        <Feather
          name={icon as any}
          size={20}
          color={comingSoon ? Colors.dark.textDisabled : Colors.dark.primary}
        />
      </View>
      <View style={styles.settingsRowContent}>
        <View style={styles.settingsRowTitleRow}>
          <ThemedText
            style={[
              styles.settingsRowTitle,
              comingSoon && styles.settingsRowTitleDisabled,
            ]}
          >
            {title}
          </ThemedText>
          {comingSoon ? <ComingSoonBadge /> : null}
        </View>
        {subtitle ? (
          <ThemedText style={styles.settingsRowSubtitle}>{subtitle}</ThemedText>
        ) : null}
      </View>
      {rightElement ? (
        rightElement
      ) : onPress && !comingSoon ? (
        <Feather
          name="chevron-right"
          size={20}
          color={Colors.dark.textSecondary}
        />
      ) : null}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  // Android'de headerTransparent:true ile useHeaderHeight status bar'ı dahil etmeyebilir
  const safeTopOffset = Platform.OS === "android"
    ? Math.max(headerHeight, insets.top + 56)
    : headerHeight;
  const { identity, setDisplayName } = useIdentity();
  const { language: currentLanguage, setLanguage: setContextLanguage } =
    useLanguage();
  const { setLowPowerMode } = useLowPower();

  const [displayNameInput, setDisplayNameInput] = useState("");
  const [defaultTimer, setDefaultTimer] = useState(0);
  const [privacySettings, setPrivacySettings] = useState<PrivacySettings>({
    screenProtection: false,
    biometricLock: false,
    autoMetadataScrubbing: true,
    steganographyMode: false,
    ghostMode: false,
    p2pOnlyMode: false,
    lowPowerMode: false,
  });
  const [torSettings, setTorSettings] = useState<TorSettings>({
    enabled: false,
    proxyHost: "127.0.0.1",
    proxyPort: 9050,
    connectionStatus: "disconnected",
  });
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricAvailableDesktop, setBiometricAvailableDesktop] =
    useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [showTimerModal, setShowTimerModal] = useState(false);
  const [showTorModal, setShowTorModal] = useState(false);
  const [torProxyInput, setTorProxyInput] = useState("127.0.0.1:9050");
  const [showImportModal, setShowImportModal] = useState(false);
  const [importBackupInput, setImportBackupInput] = useState("");
  const [torStatusMessage, setTorStatusMessage] = useState<string>("");
  const [torBootstrapProgress, setTorBootstrapProgress] = useState(0);

  useEffect(() => {
    if (identity?.displayName) {
      setDisplayNameInput(identity.displayName);
    }
    getSettings().then((s) => {
      setDefaultTimer(s.defaultMessageTimer);
    });
    getPrivacySettings().then(setPrivacySettings);
    getTorSettings().then((t) => {
      setTorSettings(t);
      setTorProxyInput(`${t.proxyHost}:${t.proxyPort}`);
    });
    LocalAuthentication.hasHardwareAsync().then(setBiometricAvailable);

    // Electron'da Touch ID / Windows Hello kullanılabilirliği kontrol et
    if (isElectron()) {
      electronBiometricIsAvailable().then(setBiometricAvailableDesktop);
    }
  }, [identity]);

  const handleDisplayNameChange = async () => {
    if (displayNameInput !== identity?.displayName) {
      await setDisplayName(displayNameInput);
      await updateSettings({ displayName: displayNameInput });
    }
  };

  const handleToggle = useCallback(
    async (key: keyof PrivacySettings, value: boolean) => {
      // Yakında gelecek özellikler — state değişikliğine izin verme
      if ((COMING_SOON_FLAGS as readonly string[]).includes(key)) return;

      if (key === "biometricLock" && value) {
        // ── Electron: Touch ID / Windows Hello ──────────────────────────
        if (isElectron()) {
          if (!biometricAvailableDesktop) {
            Alert.alert(
              currentLanguage === "tr" ? "Biyometrik Kilit" : "Biometric Lock",
              currentLanguage === "tr"
                ? "Bu cihazda Touch ID veya Windows Hello desteklenmiyor."
                : "Touch ID or Windows Hello is not available on this device.",
            );
            return;
          }
          const result = await electronBiometricAuthenticate(
            currentLanguage === "tr"
              ? "CipherNode biyometrik kilidi etkinleştirmek için doğrulayın"
              : "Authenticate to enable CipherNode biometric lock",
          );
          if (!result.success) {
            Alert.alert(
              currentLanguage === "tr"
                ? "Doğrulama Başarısız"
                : "Authentication Failed",
              result.error ||
                (currentLanguage === "tr"
                  ? "Biyometrik doğrulama reddedildi."
                  : "Biometric authentication was rejected."),
            );
            return;
          }
        } else if (Platform.OS === "web") {
          // Web — desteklenmiyor
          Alert.alert(
            currentLanguage === "tr" ? "Biyometrik Kilit" : "Biometric Lock",
            currentLanguage === "tr"
              ? "Bu özellik sadece mobil cihazlarda ve masaüstü uygulamada kullanılabilir."
              : "This feature is only available on mobile devices and the desktop app.",
          );
          return;
        } else {
          // Mobil: expo-local-authentication
          const result = await LocalAuthentication.authenticateAsync({
            promptMessage:
              currentLanguage === "tr"
                ? "Biyometrik kilidi etkinleştirmek için doğrulayın"
                : "Authenticate to enable biometric lock",
            fallbackLabel:
              currentLanguage === "tr" ? "Şifre kullan" : "Use password",
          });
          if (!result.success) return;
        }
      }

      // Ekran koruması: screenshot/kayıt engelle veya serbest bırak
      if (key === "screenProtection") {
        try {
          if (value) {
            await ScreenCapture.preventScreenCaptureAsync();
          } else {
            await ScreenCapture.allowScreenCaptureAsync();
          }
        } catch {}
      }

      // Ghost mode: socket'e bildir
      if (key === "ghostMode") {
        setGhostMode(value);
      }

      // Steganografi modu: socket'e bildir
      if (key === "steganographyMode") {
        setStegMode(value);
        if (value) {
          Alert.alert(
            currentLanguage === "tr"
              ? "Steganografi Modu Aktif"
              : "Steganography Mode Active",
            currentLanguage === "tr"
              ? "Mesajlar artık görünmez Unicode karakterlere gizlenerek gönderilecek. Alıcı da bu uygulamayı kullanıyorsa otomatik decode edilir."
              : "Messages will now be hidden inside invisible Unicode characters. Recipients using this app will automatically decode them.",
            [{ text: "OK" }],
          );
        }
      }

      // P2P Only modu: socket'e bildir
      if (key === "p2pOnlyMode") {
        setP2POnlyMode(value);
        if (value) {
          Alert.alert(
            currentLanguage === "tr"
              ? "Sadece P2P Modu Aktif"
              : "P2P Only Mode Active",
            currentLanguage === "tr"
              ? "Mesajlar artık yalnızca alıcı çevrimiçiyken iletilir. Çevrimdışı kullanıcılara mesaj kuyruğa alınmaz."
              : "Messages will only be delivered when the recipient is online. No offline message queuing.",
            [{ text: "OK" }],
          );
        }
      }

      // Low Power mode: context'e bildir
      if (key === "lowPowerMode") {
        setLowPowerMode(value);
      }

      setPrivacySettings((prev) => ({ ...prev, [key]: value }));
      await updatePrivacySettings({ [key]: value });
    },
    [currentLanguage, biometricAvailableDesktop, setLowPowerMode],
  );

  const timerLabels: Record<number, string> = {
    0: currentLanguage === "tr" ? "Kapalı" : "Off",
    30: currentLanguage === "tr" ? "30 saniye" : "30 seconds",
    60: currentLanguage === "tr" ? "1 dakika" : "1 minute",
    300: currentLanguage === "tr" ? "5 dakika" : "5 minutes",
    3600: currentLanguage === "tr" ? "1 saat" : "1 hour",
    86400: currentLanguage === "tr" ? "1 gün" : "1 day",
  };

  const timerOptions = [0, 30, 60, 300, 3600, 86400];

  const handleTimerChange = async (timer: number) => {
    setDefaultTimer(timer);
    await updateSettings({ defaultMessageTimer: timer });
    setShowTimerModal(false);
  };

  const handleLanguageChange = async (lang: Language) => {
    setContextLanguage(lang);
    await saveLanguage(lang);
    setShowLanguageModal(false);
  };

  const handleTorToggle = async (enabled: boolean) => {
    if (enabled) {
      // ── Electron: Otomatik Tor yönetimi ─────────────────────────────
      if (isElectron()) {
        setTorSettings((prev) => ({
          ...prev,
          enabled: true,
          connectionStatus: "connecting",
        }));
        await updateTorSettings({
          enabled: true,
          connectionStatus: "connecting",
        });
        setTorStatusMessage(
          currentLanguage === "tr" ? "Tor başlatılıyor..." : "Starting Tor...",
        );
        setTorBootstrapProgress(0);

        // Electron Tor durumunu dinle
        const unsub = electronOnTorStatus((status) => {
          setTorBootstrapProgress(status.progress ?? 0);
          setTorStatusMessage(status.message ?? "");
          if (status.stage === "ready") {
            setTorSettings((prev) => ({
              ...prev,
              connectionStatus: "connected",
            }));
            updateTorSettings({ connectionStatus: "connected" });
          } else if (status.stage === "error") {
            setTorSettings((prev) => ({ ...prev, connectionStatus: "error" }));
            updateTorSettings({ connectionStatus: "error" });
          }
        });

        const result = await electronEnableTor();
        unsub?.();

        if (result.success) {
          // Gerçek Tor doğrulama
          const verify = await electronVerifyTor();
          if (verify?.isTor) {
            Alert.alert(
              "✓ Tor Aktif",
              currentLanguage === "tr"
                ? `Tüm trafik Tor üzerinden şifreleniyor.\nTor IP: ${verify.ip}`
                : `All traffic is routed through Tor.\nTor IP: ${verify.ip}`,
            );
          } else {
            Alert.alert(
              currentLanguage === "tr" ? "Tor Bağlandı" : "Tor Connected",
              currentLanguage === "tr"
                ? "Tor proxy'si başlatıldı. Doğrulama için internet bağlantısı kontrol edin."
                : "Tor proxy started. Check internet for verification.",
            );
          }
        } else {
          setTorSettings((prev) => ({ ...prev, connectionStatus: "error" }));
          await updateTorSettings({ connectionStatus: "error" });
          Alert.alert(
            currentLanguage === "tr" ? "Tor Hatası" : "Tor Error",
            result.error ||
              (currentLanguage === "tr"
                ? "Tor başlatılamadı."
                : "Failed to start Tor."),
          );
        }
        return;
      }

      // ── Web tarayıcısı ───────────────────────────────────────────────
      if (Platform.OS === "web") {
        Alert.alert(
          currentLanguage === "tr"
            ? "Tor - Tarayıcı Limiti"
            : "Tor - Browser Limitation",
          currentLanguage === "tr"
            ? "Web tarayıcısında Tor doğrudan desteklenmez.\n\nGerçek Tor gizliliği için:\n• Tor Browser'ı indirin (torproject.org)\n• Uygulamayı Tor Browser'da açın\n\nBu durumda tüm trafik otomatik olarak Tor üzerinden geçer."
            : "Tor is not directly supported in web browsers.\n\nFor real Tor privacy:\n• Download Tor Browser (torproject.org)\n• Open the app in Tor Browser\n\nAll traffic will automatically route through Tor.",
          [{ text: "OK" }],
        );
        return;
      }

      // Mobil: Orbot yüklü mü kontrol et, gerçek Tor bağlantısını doğrula
      Alert.alert(
        currentLanguage === "tr" ? "Tor Modu Hakkında" : "About Tor Mode",
        currentLanguage === "tr"
          ? "Tor modu için gerçek bir Tor proxy'si gereklidir.\n\nAndroid: Orbot uygulamasını yükleyin ve 'Tüm Uygulamalar için VPN' modunu etkinleştirin.\n\niOS: Onion Browser uygulamasını kullanın.\n\nOrbot aktifken uygulama tüm trafiği Tor üzerinden yönlendirir. Proxy adresi: 127.0.0.1:9050"
          : "Tor mode requires a real Tor proxy.\n\nAndroid: Install Orbot and enable 'VPN for All Apps' mode.\n\niOS: Use Onion Browser app.\n\nWith Orbot active, all traffic routes through Tor. Proxy: 127.0.0.1:9050",
        [
          {
            text: currentLanguage === "tr" ? "İptal" : "Cancel",
            style: "cancel",
          },
          {
            text: currentLanguage === "tr" ? "Etkinleştir" : "Enable",
            onPress: async () => {
              setTorSettings((prev) => ({
                ...prev,
                enabled: true,
                connectionStatus: "connecting",
              }));
              await updateTorSettings({
                enabled: true,
                connectionStatus: "connecting",
              });
              try {
                // Gerçek Tor bağlantısını check.torproject.org ile doğrula
                await verifyTorConnection(true);
              } catch {
                setTorSettings((prev) => ({
                  ...prev,
                  connectionStatus: "error",
                }));
                await updateTorSettings({ connectionStatus: "error" });
              }
            },
          },
        ],
      );
    } else {
      setTorSettings((prev) => ({
        ...prev,
        enabled: false,
        connectionStatus: "disconnected",
      }));
      await updateTorSettings({
        enabled: false,
        connectionStatus: "disconnected",
      });
      setTorStatusMessage("");
      setTorBootstrapProgress(0);

      if (isElectron()) {
        await electronDisableTor();
      } else {
        try {
          await reconnectWithTor();
        } catch {
          // sessizce başarısız
        }
      }
    }
  };

  /** check.torproject.org API'si üzerinden gerçek Tor bağlantısını doğrula */
  const verifyTorConnection = async (connect: boolean) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      const res = await fetch("https://check.torproject.org/api/ip", {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data.IsTor === true) {
        setTorSettings((prev) => ({ ...prev, connectionStatus: "connected" }));
        await updateTorSettings({ connectionStatus: "connected" });
        if (connect) await reconnectWithTor();
        Alert.alert(
          currentLanguage === "tr" ? "✓ Tor Aktif" : "✓ Tor Active",
          currentLanguage === "tr"
            ? `Tor üzerinden bağlısınız.\nIP: ${data.IP}`
            : `You are connected via Tor.\nIP: ${data.IP}`,
        );
      } else {
        setTorSettings((prev) => ({ ...prev, connectionStatus: "error" }));
        await updateTorSettings({ connectionStatus: "error" });
        Alert.alert(
          currentLanguage === "tr" ? "Tor Tespit Edilmedi" : "Tor Not Detected",
          currentLanguage === "tr"
            ? `Tor bağlantısı doğrulanamadı. Mevcut IP: ${data.IP}\n\nOrbot'u açıp 'Tüm Uygulamalar için VPN' modunu etkinleştirdiğinizden emin olun.`
            : `Tor connection could not be verified. Current IP: ${data.IP}\n\nMake sure Orbot is running with 'VPN for All Apps' mode enabled.`,
        );
      }
    } catch {
      // Ağ hatası veya timeout — Tor aktif olup check.torproject.org ulaşılamıyor olabilir
      // Kullanıcıya "Yine de Kullan" seçeneği sun
      Alert.alert(
        currentLanguage === "tr"
          ? "Doğrulama Başarısız"
          : "Verification Failed",
        currentLanguage === "tr"
          ? "check.torproject.org'a ulaşılamadı. Tor yavaş olduğundan zaman aşımına uğramış olabilir.\n\nOrbot'un 'Tüm Uygulamalar için VPN' modunda çalıştığından emin olup tekrar deneyin, ya da Tor aktifken yine de devam edin."
          : "Could not reach check.torproject.org. Tor may have timed out due to slow connection.\n\nMake sure Orbot runs in 'VPN for All Apps' mode and retry, or continue anyway with Tor active.",
        [
          {
            text: currentLanguage === "tr" ? "İptal" : "Cancel",
            style: "cancel",
            onPress: async () => {
              setTorSettings((prev) => ({ ...prev, enabled: false, connectionStatus: "disconnected" }));
              await updateTorSettings({ enabled: false, connectionStatus: "disconnected" });
            },
          },
          {
            text: currentLanguage === "tr" ? "Yine de Kullan" : "Use Anyway",
            onPress: async () => {
              setTorSettings((prev) => ({ ...prev, connectionStatus: "connected" }));
              await updateTorSettings({ connectionStatus: "connected" });
              if (connect) await reconnectWithTor();
            },
          },
        ],
      );
    }
  };

  const handleTorProxySave = async () => {
    const parts = torProxyInput.split(":");
    if (parts.length === 2) {
      const host = parts[0];
      const port = parseInt(parts[1], 10);
      if (!isNaN(port)) {
        setTorSettings((prev) => ({
          ...prev,
          proxyHost: host,
          proxyPort: port,
        }));
        await updateTorSettings({ proxyHost: host, proxyPort: port });
        setShowTorModal(false);
        return;
      }
    }
    Alert.alert(
      currentLanguage === "tr" ? "Geçersiz Format" : "Invalid Format",
      currentLanguage === "tr"
        ? "Lütfen host:port formatında girin (örnek: 127.0.0.1:9050)"
        : "Please enter in host:port format (example: 127.0.0.1:9050)",
    );
  };

  const getTorStatusText = () => {
    switch (torSettings.connectionStatus) {
      case "connected":
        return currentLanguage === "tr" ? "Bağlı" : "Connected";
      case "connecting":
        return currentLanguage === "tr" ? "Bağlanıyor..." : "Connecting...";
      case "error":
        return currentLanguage === "tr" ? "Hata" : "Error";
      default:
        return currentLanguage === "tr" ? "Bağlı Değil" : "Disconnected";
    }
  };

  const getTorStatusColor = () => {
    switch (torSettings.connectionStatus) {
      case "connected":
        return Colors.dark.success;
      case "connecting":
        return Colors.dark.warning;
      case "error":
        return Colors.dark.error;
      default:
        return Colors.dark.textSecondary;
    }
  };

  const handleExportIdentity = async () => {
    try {
      const backup = await exportIdentityBackup();
      await Clipboard.setStringAsync(backup);
      Alert.alert(
        currentLanguage === "tr" ? "Kimlik Kopyalandı" : "Identity Copied",
        currentLanguage === "tr"
          ? "Kimlik yedeğiniz panoya kopyalandı. Diğer cihazda 'Kimlik İçe Aktar' seçeneğine yapıştırın."
          : "Your identity backup was copied to clipboard. Paste it using 'Import Identity' on the other device.",
      );
    } catch {
      Alert.alert(
        currentLanguage === "tr" ? "Hata" : "Error",
        currentLanguage === "tr"
          ? "Kimlik dışa aktarılamadı."
          : "Failed to export identity.",
      );
    }
  };

  const handleResetIdentity = async () => {
    Alert.alert(
      currentLanguage === "tr" ? "Kimliği Sıfırla" : "Reset Identity",
      currentLanguage === "tr"
        ? "Bu işlem mevcut kimliğinizi silecek ve yeni bir kimlik oluşturacak. Kişileriniz ve sohbetleriniz kaybolacak. Emin misiniz?"
        : "This will delete your current identity and create a new one. Your contacts and chats will be lost. Are you sure?",
      [
        { text: currentLanguage === "tr" ? "İptal" : "Cancel", style: "cancel" },
        {
          text: currentLanguage === "tr" ? "Sıfırla" : "Reset",
          style: "destructive",
          onPress: async () => {
            try {
              const { regenerateIdentity } = await import("@/lib/crypto");
              await regenerateIdentity();
              Alert.alert(
                currentLanguage === "tr" ? "Sıfırlandı" : "Reset",
                currentLanguage === "tr"
                  ? "Kimlik sıfırlandı. Uygulamayı yeniden başlatın."
                  : "Identity reset. Please restart the app.",
              );
            } catch {
              Alert.alert(
                currentLanguage === "tr" ? "Hata" : "Error",
                currentLanguage === "tr" ? "Sıfırlama başarısız." : "Reset failed.",
              );
            }
          },
        },
      ],
    );
  };

  const handleImportIdentity = async () => {
    if (!importBackupInput.trim()) return;
    Alert.alert(
      currentLanguage === "tr" ? "Kimliği İçe Aktar" : "Import Identity",
      currentLanguage === "tr"
        ? "Bu işlem mevcut kimliğinizin üzerine yazar. Emin misiniz?"
        : "This will overwrite your current identity. Are you sure?",
      [
        {
          text: currentLanguage === "tr" ? "İptal" : "Cancel",
          style: "cancel",
        },
        {
          text: currentLanguage === "tr" ? "Aktar" : "Import",
          style: "destructive",
          onPress: async () => {
            try {
              await importIdentityFromBackup(importBackupInput.trim());
              setShowImportModal(false);
              setImportBackupInput("");
              Alert.alert(
                currentLanguage === "tr" ? "Başarılı" : "Success",
                currentLanguage === "tr"
                  ? "Kimlik başarıyla içe aktarıldı. Uygulamayı yeniden başlatın."
                  : "Identity imported successfully. Please restart the app.",
              );
            } catch {
              Alert.alert(
                currentLanguage === "tr" ? "Hata" : "Error",
                currentLanguage === "tr"
                  ? "Geçersiz kimlik yedeği. Lütfen doğru JSON yapıştırdığınızdan emin olun."
                  : "Invalid identity backup. Make sure you pasted the correct JSON.",
              );
            }
          },
        },
      ],
    );
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: safeTopOffset + Spacing.xl,
            paddingBottom: tabBarHeight + Spacing.xl,
          },
        ]}
      >
        <View style={styles.identityCard}>
          <ThemedText style={styles.identityCardLabel}>
            {currentLanguage === "tr" ? "Kimliğiniz" : "Your ID"}
          </ThemedText>
          <ThemedText style={styles.identityCardValue}>
            {identity?.id || "—"}
          </ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>
            {currentLanguage === "tr" ? "Kimlik" : "Identity"}
          </ThemedText>
          <View style={styles.sectionContent}>
            <View style={styles.inputRow}>
              <ThemedText style={styles.inputLabel}>
                {currentLanguage === "tr" ? "Gösterim Adı" : "Display Name"}
              </ThemedText>
              <TextInput
                style={styles.input}
                value={displayNameInput}
                onChangeText={setDisplayNameInput}
                onBlur={handleDisplayNameChange}
                placeholder={
                  currentLanguage === "tr" ? "Opsiyonel Ad" : "Optional name"
                }
                placeholderTextColor={Colors.dark.textDisabled}
                maxLength={30}
              />
            </View>
            <SettingsRow
              icon="upload"
              title={
                currentLanguage === "tr"
                  ? "Kimliği Dışa Aktar"
                  : "Export Identity"
              }
              subtitle={
                currentLanguage === "tr"
                  ? "Aynı kimliği başka cihazda kullanmak için kopyala"
                  : "Copy to use the same identity on another device"
              }
              onPress={handleExportIdentity}
            />
            <SettingsRow
              icon="download"
              title={
                currentLanguage === "tr"
                  ? "Kimliği İçe Aktar"
                  : "Import Identity"
              }
              subtitle={
                currentLanguage === "tr"
                  ? "Başka cihazdan aktarılan kimliği yükle"
                  : "Load an identity exported from another device"
              }
              onPress={() => setShowImportModal(true)}
            />
            <SettingsRow
              icon="refresh-cw"
              title={
                currentLanguage === "tr"
                  ? "Kimliği Sıfırla"
                  : "Reset Identity"
              }
              subtitle={
                currentLanguage === "tr"
                  ? "Yeni kimlik oluştur (geri alınamaz)"
                  : "Generate a new identity (irreversible)"
              }
              onPress={handleResetIdentity}
            />
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>
            {currentLanguage === "tr" ? "Gizlilik" : "Privacy"}
          </ThemedText>
          <View style={styles.sectionContent}>
            <SettingsRow
              icon="clock"
              title={
                currentLanguage === "tr"
                  ? "Varsayılan Mesaj Zamanlayıcısı"
                  : "Default Message Timer"
              }
              subtitle={
                timerLabels[defaultTimer] ||
                (currentLanguage === "tr" ? "Kapalı" : "Off")
              }
              onPress={() => setShowTimerModal(true)}
            />
            <SettingsRow
              icon="eye-off"
              title={
                currentLanguage === "tr"
                  ? "Ekran Koruması"
                  : "Screen Protection"
              }
              subtitle={
                currentLanguage === "tr"
                  ? "Ekran görüntüsü ve kaydı engelle"
                  : "Prevent screenshots and screen recording"
              }
              rightElement={
                <Switch
                  value={privacySettings.screenProtection}
                  onValueChange={(v) => handleToggle("screenProtection", v)}
                  trackColor={{
                    false: Colors.dark.border,
                    true: Colors.dark.primary,
                  }}
                  thumbColor={
                    privacySettings.screenProtection
                      ? Colors.dark.text
                      : Colors.dark.textSecondary
                  }
                />
              }
            />
            <SettingsRow
              icon="lock"
              title={
                currentLanguage === "tr" ? "Biyometrik Kilit" : "Biometric Lock"
              }
              subtitle={
                isElectron()
                  ? biometricAvailableDesktop
                    ? currentLanguage === "tr"
                      ? "Touch ID / Windows Hello ile kilitle"
                      : "Lock with Touch ID / Windows Hello"
                    : currentLanguage === "tr"
                      ? "Bu cihazda desteklenmiyor"
                      : "Not supported on this device"
                  : biometricAvailable
                    ? currentLanguage === "tr"
                      ? "Parmak izi / Yüz kimliği ile giriş"
                      : "Require fingerprint / Face ID to open app"
                    : currentLanguage === "tr"
                      ? "Cihaz desteklemiyor"
                      : "Device not supported"
              }
              rightElement={
                <Switch
                  value={privacySettings.biometricLock}
                  onValueChange={(v) => handleToggle("biometricLock", v)}
                  trackColor={{
                    false: Colors.dark.border,
                    true: Colors.dark.primary,
                  }}
                  thumbColor={
                    privacySettings.biometricLock
                      ? Colors.dark.text
                      : Colors.dark.textSecondary
                  }
                  disabled={
                    isElectron()
                      ? !biometricAvailableDesktop
                      : !biometricAvailable && Platform.OS !== "web"
                  }
                />
              }
            />
            <SettingsRow
              icon="image"
              title={
                currentLanguage === "tr"
                  ? "Otomatik Metadata Temizliği"
                  : "Auto Metadata Scrubbing"
              }
              subtitle={
                currentLanguage === "tr"
                  ? "Medya gönderirken EXIF verilerini otomatik siler"
                  : "Automatically remove EXIF data from images when sharing"
              }
              rightElement={
                <Switch
                  value={privacySettings.autoMetadataScrubbing}
                  onValueChange={(v) =>
                    handleToggle("autoMetadataScrubbing", v)
                  }
                  trackColor={{
                    false: Colors.dark.border,
                    true: Colors.dark.primary,
                  }}
                  thumbColor={
                    privacySettings.autoMetadataScrubbing
                      ? Colors.dark.text
                      : Colors.dark.textSecondary
                  }
                />
              }
            />
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>
            {currentLanguage === "tr" ? "Guvenlik" : "Security"}
          </ThemedText>
          <View style={styles.sectionContent}>
            <SettingsRow
              icon="layers"
              title={
                currentLanguage === "tr"
                  ? "Steganografi Modu"
                  : "Steganography Mode"
              }
              subtitle={
                currentLanguage === "tr"
                  ? "Mesajları görünmez Unicode karakterlere gömer"
                  : "Hide messages in invisible Unicode characters"
              }
              rightElement={
                <Switch
                  value={privacySettings.steganographyMode}
                  onValueChange={(v) => handleToggle("steganographyMode", v)}
                  trackColor={{
                    false: Colors.dark.border,
                    true: Colors.dark.secondary,
                  }}
                  thumbColor={
                    privacySettings.steganographyMode
                      ? Colors.dark.text
                      : Colors.dark.textSecondary
                  }
                />
              }
            />
            <SettingsRow
              icon="user-x"
              title={currentLanguage === "tr" ? "Hayalet Modu" : "Ghost Mode"}
              subtitle={
                currentLanguage === "tr"
                  ? "Yazıyor göstergesi ve okundu bilgisi gizlenir"
                  : "Hide typing indicator and read receipts from others"
              }
              rightElement={
                <Switch
                  value={privacySettings.ghostMode}
                  onValueChange={(v) => handleToggle("ghostMode", v)}
                  trackColor={{
                    false: Colors.dark.border,
                    true: Colors.dark.secondary,
                  }}
                  thumbColor={
                    privacySettings.ghostMode
                      ? Colors.dark.text
                      : Colors.dark.textSecondary
                  }
                />
              }
            />
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>
            {currentLanguage === "tr" ? "Performans" : "Performance"}
          </ThemedText>
          <View style={styles.sectionContent}>
            <SettingsRow
              icon="wifi"
              title={
                currentLanguage === "tr" ? "Sadece P2P Modu" : "P2P Only Mode"
              }
              subtitle={
                currentLanguage === "tr"
                  ? "Çevrimdışı kullanıcılara mesaj kuyruğa alınmaz"
                  : "Messages not queued for offline recipients"
              }
              rightElement={
                <Switch
                  value={privacySettings.p2pOnlyMode}
                  onValueChange={(v) => handleToggle("p2pOnlyMode", v)}
                  trackColor={{
                    false: Colors.dark.border,
                    true: Colors.dark.warning,
                  }}
                  thumbColor={
                    privacySettings.p2pOnlyMode
                      ? Colors.dark.text
                      : Colors.dark.textSecondary
                  }
                />
              }
            />
            <SettingsRow
              icon="battery"
              title={
                currentLanguage === "tr" ? "Düşük Güç Modu" : "Low Power Mode"
              }
              subtitle={
                currentLanguage === "tr"
                  ? "Animasyonları ve UI efektlerini kapatır, pil ömrünü uzatır"
                  : "Disable animations and effects to save battery"
              }
              rightElement={
                <Switch
                  value={privacySettings.lowPowerMode}
                  onValueChange={(v) => handleToggle("lowPowerMode", v)}
                  trackColor={{
                    false: Colors.dark.border,
                    true: Colors.dark.warning,
                  }}
                  thumbColor={
                    privacySettings.lowPowerMode
                      ? Colors.dark.text
                      : Colors.dark.textSecondary
                  }
                />
              }
            />
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>
            {currentLanguage === "tr" ? "Dil" : "Language"}
          </ThemedText>
          <View style={styles.sectionContent}>
            <SettingsRow
              icon="globe"
              title={
                currentLanguage === "tr" ? "Dili Degistir" : "Change Language"
              }
              subtitle={SUPPORTED_LANGUAGES[currentLanguage]}
              onPress={() => setShowLanguageModal(true)}
            />
          </View>
        </View>

        <Modal visible={showImportModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <ThemedText style={styles.modalTitle}>
                {currentLanguage === "tr"
                  ? "Kimliği İçe Aktar"
                  : "Import Identity"}
              </ThemedText>
              <ThemedText
                style={[
                  styles.settingsRowSubtitle,
                  { marginBottom: Spacing.md },
                ]}
              >
                {currentLanguage === "tr"
                  ? "Diğer cihazdan kopyalanan kimlik JSON'ını buraya yapıştırın."
                  : "Paste the identity JSON copied from the other device."}
              </ThemedText>
              <TextInput
                style={[
                  styles.input,
                  {
                    height: 100,
                    textAlignVertical: "top",
                    textAlign: "left",
                    marginBottom: Spacing.xs,
                  },
                ]}
                value={importBackupInput}
                onChangeText={setImportBackupInput}
                placeholder={
                  currentLanguage === "tr"
                    ? "JSON yapıştır..."
                    : "Paste JSON..."
                }
                placeholderTextColor={Colors.dark.textDisabled}
                multiline
                autoCorrect={false}
                autoCapitalize="none"
              />
              <Pressable
                onPress={async () => {
                  const text = await Clipboard.getStringAsync();
                  if (text) setImportBackupInput(text);
                }}
                style={[styles.modalCloseButton, { marginBottom: Spacing.md, backgroundColor: Colors.dark.backgroundSecondary }]}
              >
                <ThemedText style={[styles.modalCloseButtonText, { color: Colors.dark.textSecondary }]}>
                  {currentLanguage === "tr" ? "Panodan Yapıştır" : "Paste from Clipboard"}
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={handleImportIdentity}
                style={styles.modalCloseButton}
              >
                <ThemedText
                  style={[
                    styles.modalCloseButtonText,
                    { color: Colors.dark.primary },
                  ]}
                >
                  {currentLanguage === "tr" ? "İçe Aktar" : "Import"}
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => {
                  setShowImportModal(false);
                  setImportBackupInput("");
                }}
                style={styles.modalCloseButton}
              >
                <ThemedText style={styles.modalCloseButtonText}>
                  {currentLanguage === "tr" ? "İptal" : "Cancel"}
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal visible={showLanguageModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <ThemedText style={styles.modalTitle}>
                {currentLanguage === "tr" ? "Dil Secin" : "Select Language"}
              </ThemedText>
              {(Object.keys(SUPPORTED_LANGUAGES) as Language[]).map((lang) => (
                <Pressable
                  key={lang}
                  onPress={() => handleLanguageChange(lang)}
                  style={[
                    styles.languageOption,
                    currentLanguage === lang && styles.languageOptionSelected,
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.languageOptionText,
                      currentLanguage === lang &&
                        styles.languageOptionTextSelected,
                    ]}
                  >
                    {SUPPORTED_LANGUAGES[lang]}
                  </ThemedText>
                </Pressable>
              ))}
              <Pressable
                onPress={() => setShowLanguageModal(false)}
                style={styles.modalCloseButton}
              >
                <ThemedText style={styles.modalCloseButtonText}>
                  {currentLanguage === "tr" ? "Kapat" : "Close"}
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal visible={showTimerModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <ThemedText style={styles.modalTitle}>
                {currentLanguage === "tr"
                  ? "Mesaj Zamanlayıcısını Ayarla"
                  : "Set Message Timer"}
              </ThemedText>
              {timerOptions.map((timer) => (
                <Pressable
                  key={timer}
                  onPress={() => handleTimerChange(timer)}
                  style={[
                    styles.languageOption,
                    defaultTimer === timer && styles.languageOptionSelected,
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.languageOptionText,
                      defaultTimer === timer &&
                        styles.languageOptionTextSelected,
                    ]}
                  >
                    {timerLabels[timer]}
                  </ThemedText>
                </Pressable>
              ))}
              <Pressable
                onPress={() => setShowTimerModal(false)}
                style={styles.modalCloseButton}
              >
                <ThemedText style={styles.modalCloseButtonText}>
                  {currentLanguage === "tr" ? "Kapat" : "Close"}
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal visible={showTorModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <ThemedText style={styles.modalTitle}>
                {currentLanguage === "tr"
                  ? "Tor Proxy Ayarlari"
                  : "Tor Proxy Settings"}
              </ThemedText>
              <ThemedText style={styles.settingsRowSubtitle}>
                {currentLanguage === "tr"
                  ? "Host:Port formatinda girin"
                  : "Enter in Host:Port format"}
              </ThemedText>
              <TextInput
                style={styles.torModalInput}
                value={torProxyInput}
                onChangeText={setTorProxyInput}
                placeholder="127.0.0.1:9050"
                placeholderTextColor={Colors.dark.textDisabled}
                keyboardType="default"
                autoCapitalize="none"
              />
              <View style={styles.torModalButtons}>
                <Pressable
                  onPress={() => setShowTorModal(false)}
                  style={[
                    styles.torModalButton,
                    styles.torModalButtonSecondary,
                  ]}
                >
                  <ThemedText style={styles.torModalButtonText}>
                    {currentLanguage === "tr" ? "Iptal" : "Cancel"}
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={handleTorProxySave}
                  style={[styles.torModalButton, styles.torModalButtonPrimary]}
                >
                  <ThemedText style={styles.torModalButtonText}>
                    {currentLanguage === "tr" ? "Kaydet" : "Save"}
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>
            {currentLanguage === "tr" ? "Tor Baglantisi" : "Tor Connection"}
          </ThemedText>
          <View style={styles.sectionContent}>
            <SettingsRow
              icon="shield"
              title={
                currentLanguage === "tr"
                  ? "Tor Uzerinden Baglan"
                  : "Connect via Tor"
              }
              subtitle={getTorStatusText()}
              rightElement={
                <View style={styles.torStatusRow}>
                  <View
                    style={[
                      styles.torStatusDot,
                      { backgroundColor: getTorStatusColor() },
                    ]}
                  />
                  <Switch
                    value={torSettings.enabled}
                    onValueChange={handleTorToggle}
                    trackColor={{
                      false: Colors.dark.border,
                      true: Colors.dark.secondary,
                    }}
                    thumbColor={
                      torSettings.enabled
                        ? Colors.dark.text
                        : Colors.dark.textSecondary
                    }
                  />
                </View>
              }
            />
            <SettingsRow
              icon="settings"
              title={
                currentLanguage === "tr" ? "Proxy Ayarlari" : "Proxy Settings"
              }
              subtitle={`${torSettings.proxyHost}:${torSettings.proxyPort}`}
              onPress={() => setShowTorModal(true)}
            />

            {/* Bootstrap progress (Electron bağlanıyor) */}
            {torSettings.enabled &&
              torSettings.connectionStatus === "connecting" &&
              torBootstrapProgress > 0 && (
                <View style={styles.torProgressRow}>
                  <View style={styles.torProgressBar}>
                    <View
                      style={[
                        styles.torProgressFill,
                        { width: `${torBootstrapProgress}%` as any },
                      ]}
                    />
                  </View>
                  <ThemedText style={styles.torProgressText}>
                    {torStatusMessage || `${torBootstrapProgress}%`}
                  </ThemedText>
                </View>
              )}

            {/* Bağlantı doğrulama butonu (Tor açık ve bağlıyken) */}
            {torSettings.enabled &&
              torSettings.connectionStatus === "connected" && (
                <SettingsRow
                  icon="check-circle"
                  title={
                    currentLanguage === "tr"
                      ? "Bağlantıyı Doğrula"
                      : "Verify Connection"
                  }
                  subtitle={
                    currentLanguage === "tr"
                      ? "check.torproject.org API ile kontrol et"
                      : "Check via check.torproject.org API"
                  }
                  onPress={() => {
                    if (isElectron()) {
                      electronVerifyTor().then((v) => {
                        if (v?.isTor) {
                          Alert.alert("✓ Tor", `IP: ${v.ip}`);
                        } else {
                          Alert.alert(
                            currentLanguage === "tr"
                              ? "Tor Tespit Edilmedi"
                              : "Tor Not Detected",
                            currentLanguage === "tr"
                              ? "Trafik Tor üzerinden geçmiyor."
                              : "Traffic is not going through Tor.",
                          );
                        }
                      });
                    } else {
                      verifyTorConnection(false);
                    }
                  }}
                />
              )}

            {/* check.torproject.org web sitesinde görsel doğrulama */}
            {torSettings.enabled && (
              <SettingsRow
                icon="external-link"
                title="check.torproject.org"
                subtitle={
                  currentLanguage === "tr"
                    ? "Tarayıcıda görsel Tor doğrulaması yap"
                    : "Visual Tor verification in browser"
                }
                onPress={() => {
                  const url = "https://check.torproject.org";
                  if (isElectron()) {
                    electronOpenExternal(url);
                  } else {
                    Linking.openURL(url);
                  }
                }}
              />
            )}

            {/* Yeniden bağlan butonu (hata durumunda) */}
            {torSettings.enabled &&
              torSettings.connectionStatus === "error" && (
                <SettingsRow
                  icon="refresh-cw"
                  title={
                    currentLanguage === "tr" ? "Yeniden Bağlan" : "Reconnect"
                  }
                  subtitle={
                    currentLanguage === "tr"
                      ? "Tor bağlantısını yeniden dene"
                      : "Retry Tor connection"
                  }
                  onPress={() => handleTorToggle(true)}
                />
              )}

            <View style={styles.torInfoRow}>
              <Feather
                name="info"
                size={14}
                color={Colors.dark.textSecondary}
              />
              <ThemedText style={styles.torInfoText}>
                {isElectron()
                  ? currentLanguage === "tr"
                    ? "Masaüstü uygulamada Tor otomatik yönetilir. Tor binary yoksa otomatik indirilir."
                    : "On desktop, Tor is managed automatically. Binary is downloaded if missing."
                  : currentLanguage === "tr"
                    ? "Tor kullanmak icin cihazinizda Orbot uygulamasinin calisir durumda olmasi gerekir."
                    : "Orbot app must be running on your device to use Tor."}
              </ThemedText>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>
            {currentLanguage === "tr" ? "Ag" : "Network"}
          </ThemedText>
          <View style={styles.sectionContent}>
            <SettingsRow
              icon="server"
              title={
                currentLanguage === "tr" ? "Sunucu Ayarlari" : "Server Settings"
              }
              subtitle={
                currentLanguage === "tr"
                  ? "Relay sunucusunu yapilandir"
                  : "Configure relay server"
              }
              onPress={() => navigation.navigate("NetworkSettings")}
            />
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>
            {currentLanguage === "tr"
              ? "Guvenlik ve Anahtar Yonetimi"
              : "Security & Key Management"}
          </ThemedText>
          <View style={styles.sectionContent}>
            <SettingsRow
              icon="key"
              title={
                currentLanguage === "tr" ? "Anahtar Yonetimi" : "Key Management"
              }
              subtitle={
                currentLanguage === "tr"
                  ? "Anahtarlari disa aktar veya yeniden olustur"
                  : "Export or regenerate keys"
              }
              onPress={() => navigation.navigate("SecuritySettings")}
            />
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>
            {currentLanguage === "tr" ? "Hakkinda" : "About"}
          </ThemedText>
          <View style={styles.sectionContent}>
            <SettingsRow
              icon="info"
              title={
                currentLanguage === "tr"
                  ? "CipherNode Hakkinda"
                  : "About CipherNode"
              }
              subtitle={
                currentLanguage === "tr"
                  ? "Surum, lisanslar, kaynak kodu"
                  : "Version, licenses, source code"
              }
              onPress={() => navigation.navigate("About")}
            />
            {/* Web uygulaması — sadece mobil/desktop'ta göster */}
            {Platform.OS !== "web" ? (
              <SettingsRow
                icon="monitor"
                title={
                  currentLanguage === "tr"
                    ? "Web Uygulamasına Git"
                    : "Open Web App"
                }
                subtitle={
                  currentLanguage === "tr"
                    ? "Tarayıcıda CipherNode'u aç"
                    : "Use CipherNode in your browser"
                }
                onPress={() => {
                  const webUrl = process.env.EXPO_PUBLIC_SERVER_URL
                    ? process.env.EXPO_PUBLIC_SERVER_URL
                    : "http://localhost:5000";
                  if (isElectron()) {
                    electronOpenExternal(webUrl);
                  } else {
                    Linking.openURL(webUrl);
                  }
                }}
              />
            ) : null}
          </View>
        </View>
      </ScrollView>
    </ThemedView>
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
    marginBottom: Spacing.sm,
    marginLeft: Spacing.sm,
  },
  sectionContent: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  settingsRowPressed: {
    backgroundColor: Colors.dark.backgroundSecondary,
  },
  settingsRowDisabled: {
    opacity: 0.5,
  },
  settingsRowTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  settingsRowTitleDisabled: {
    color: Colors.dark.textDisabled,
  },
  settingsRowIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.dark.backgroundSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  settingsRowContent: {
    flex: 1,
  },
  settingsRowTitle: {
    fontSize: 16,
    color: Colors.dark.text,
  },
  settingsRowSubtitle: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  identityCard: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.dark.primary,
    alignItems: "center",
  },
  identityCardLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.dark.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: Spacing.xs,
  },
  identityCardValue: {
    fontSize: 28,
    fontFamily: Fonts?.mono,
    fontWeight: "700",
    color: Colors.dark.primary,
    letterSpacing: 3,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.lg,
  },
  inputLabel: {
    fontSize: 16,
    color: Colors.dark.text,
    marginRight: Spacing.lg,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: Colors.dark.text,
    textAlign: "right",
    padding: 0,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    width: "80%",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: Spacing.lg,
    color: Colors.dark.text,
  },
  languageOption: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.dark.backgroundSecondary,
  },
  languageOptionSelected: {
    backgroundColor: Colors.dark.primary,
  },
  languageOptionText: {
    fontSize: 16,
    color: Colors.dark.text,
  },
  languageOptionTextSelected: {
    color: Colors.dark.backgroundRoot,
    fontWeight: "600",
  },
  modalCloseButton: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.dark.secondary,
    marginTop: Spacing.lg,
  },
  modalCloseButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.text,
    textAlign: "center",
  },
  torStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  torStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  torProgressRow: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.dark.backgroundSecondary,
    gap: Spacing.xs,
  },
  torProgressBar: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.dark.border,
    overflow: "hidden",
  },
  torProgressFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.dark.secondary,
  },
  torProgressText: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  torInfoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.lg,
    gap: Spacing.sm,
    backgroundColor: Colors.dark.backgroundSecondary,
  },
  torInfoText: {
    flex: 1,
    fontSize: 12,
    color: Colors.dark.textSecondary,
    lineHeight: 16,
  },
  torModalInput: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    fontSize: 16,
    color: Colors.dark.text,
    marginBottom: Spacing.lg,
    fontFamily: Fonts?.mono,
  },
  torModalButtons: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  torModalButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
  },
  torModalButtonPrimary: {
    backgroundColor: Colors.dark.secondary,
  },
  torModalButtonSecondary: {
    backgroundColor: Colors.dark.backgroundSecondary,
  },
  torModalButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.text,
  },
});
