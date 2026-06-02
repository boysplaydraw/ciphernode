/**
 * OnboardingScreen — privay app'in 3 adımlı UX akışından port edildi.
 * Framer Motion → react-native-reanimated
 * Tailwind → StyleSheet
 * Sahte kimlik → Gerçek OpenPGP ile getOrCreateIdentity()
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
  Linking,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius, Fonts } from "@/constants/theme";
import {
  setOnboardingComplete,
  updateSettings,
  updateTorSettings,
} from "@/lib/storage";
import { getOrCreateIdentity, updateDisplayName } from "@/lib/crypto";
import {
  getOfficialServerUrl,
  setCustomServerUrl,
} from "@/lib/query-client";
import { useLanguage } from "@/constants/language";
import {
  isElectron,
  electronEnableTor,
  electronVerifyTor,
  electronOnTorStatus,
} from "@/lib/electron-bridge";

type ConnectionMode = "clearnet" | "tor";
type ServerType = "official" | "custom";

interface OnboardingScreenProps {
  onComplete: () => void;
}

export default function OnboardingScreen({
  onComplete,
}: OnboardingScreenProps) {
  const insets = useSafeAreaInsets();
  const { language } = useLanguage();
  const isTr = language === "tr";

  const [step, setStep] = useState(0);
  const [userId, setUserId] = useState("");
  const [displayedId, setDisplayedId] = useState("");
  const [typewriterDone, setTypewriterDone] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [connectionMode, setConnectionMode] =
    useState<ConnectionMode>("clearnet");
  const [serverType, setServerType] = useState<ServerType>("official");
  const [customServerUrl, setCustomServerUrlInput] = useState("");
  const [serverTesting, setServerTesting] = useState(false);
  const [serverTestResult, setServerTestResult] = useState<
    "idle" | "ok" | "fail"
  >("idle");
  const [checkingTor, setCheckingTor] = useState(false);
  const [torCheckResult, setTorCheckResult] = useState<
    "idle" | "checking" | "ok" | "fail"
  >("idle");

  const officialServerUrl = getOfficialServerUrl();
  const hasOfficialServer = !!officialServerUrl;

  // Progress dot shared values (hooks rule: no conditional calls)
  const dot0 = useSharedValue(true);
  const dot1 = useSharedValue(false);
  const dot2 = useSharedValue(false);
  const dot3 = useSharedValue(false);

  const dot0Style = useAnimatedStyle(() => ({
    width: withTiming(dot0.value ? 24 : 8, { duration: 300 }),
    opacity: withTiming(dot0.value ? 1 : 0.35, { duration: 300 }),
  }));
  const dot1Style = useAnimatedStyle(() => ({
    width: withTiming(dot1.value ? 24 : 8, { duration: 300 }),
    opacity: withTiming(dot1.value ? 1 : 0.35, { duration: 300 }),
  }));
  const dot2Style = useAnimatedStyle(() => ({
    width: withTiming(dot2.value ? 24 : 8, { duration: 300 }),
    opacity: withTiming(dot2.value ? 1 : 0.35, { duration: 300 }),
  }));
  const dot3Style = useAnimatedStyle(() => ({
    width: withTiming(dot3.value ? 24 : 8, { duration: 300 }),
    opacity: withTiming(dot3.value ? 1 : 0.35, { duration: 300 }),
  }));

  const dotStyles = [dot0Style, dot1Style, dot2Style, dot3Style];

  const goToStep = useCallback(
    (s: number) => {
      dot0.value = s === 0;
      dot1.value = s === 1;
      dot2.value = s === 2;
      dot3.value = s === 3;
      setStep(s);
    },
    [dot0, dot1, dot2, dot3],
  );

  // Adım 1'e ilk geçişte kimlik üret
  const generateIdentity = useCallback(async () => {
    setGenerating(true);
    setTypewriterDone(false);
    setDisplayedId("");

    try {
      const identity = await getOrCreateIdentity();
      const id = identity.id; // XXXX-XXXX
      setUserId(id);
      setGenerating(false);

      // Typewriter efekti
      let i = 0;
      const timer = setInterval(() => {
        i++;
        setDisplayedId(id.slice(0, i));
        if (i >= id.length) {
          clearInterval(timer);
          setTypewriterDone(true);
        }
      }, 55);
    } catch {
      setGenerating(false);
      setTypewriterDone(true);
      setDisplayedId("????-????");
    }
  }, []);

  useEffect(() => {
    if (step === 1 && !userId) {
      generateIdentity();
    }
  }, [step, userId, generateIdentity]);

  const haptic = () => {
    if (Platform.OS !== "web")
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleNext = () => {
    haptic();
    goToStep(step + 1);
  };

  const handleBack = () => {
    haptic();
    goToStep(step - 1);
  };

  const getSelectedServerUrl = () => {
    if (serverType === "custom") return customServerUrl.trim();
    return officialServerUrl || "";
  };

  const normalizeRelayUrl = (value: string) => {
    try {
      const url = new URL(value.trim());
      const allowedProtocol = url.protocol === "http:" || url.protocol === "https:";
      const hasCredentials = !!url.username || !!url.password;
      if (!allowedProtocol || hasCredentials) return null;
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    } catch {
      return null;
    }
  };

  const persistServerChoice = useCallback(async () => {
    if (serverType === "official") {
      await updateSettings({ serverUrl: "" });
      setCustomServerUrl(null);
      return true;
    }

    const url = customServerUrl.trim();
    if (!url) {
      Alert.alert(
        isTr ? "Sunucu gerekli" : "Server required",
        isTr
          ? "Kendi sunucunu kullanmak icin relay adresini gir."
          : "Enter a relay address to use your own server.",
      );
      return false;
    }

    const normalizedUrl = normalizeRelayUrl(url);
    if (!normalizedUrl) {
      Alert.alert(
        isTr ? "Gecersiz URL" : "Invalid URL",
        isTr
          ? "Sadece http:// veya https:// relay adresi gir. Kullanici adi/sifre iceren URL kullanma."
          : "Use only an http:// or https:// relay address. Do not include username/password credentials.",
      );
      return false;
    }

    await updateSettings({ serverUrl: normalizedUrl });
    setCustomServerUrl(normalizedUrl);
    return true;
  }, [customServerUrl, isTr, serverType]);

  const handleServerNext = async () => {
    haptic();
    const saved = await persistServerChoice();
    if (saved) goToStep(3);
  };

  const handleTestServer = async () => {
    const targetUrl = getSelectedServerUrl();
    if (!targetUrl) {
      Alert.alert(
        isTr ? "Sunucu yok" : "No server",
        isTr
          ? "Bu build icin varsayilan sunucu yok. Kendi sunucu adresini gir."
          : "This build has no default server. Enter your own server address.",
      );
      return;
    }

    const normalizedTargetUrl = normalizeRelayUrl(targetUrl);
    if (!normalizedTargetUrl) {
      Alert.alert(
        isTr ? "Gecersiz URL" : "Invalid URL",
        isTr
          ? "Sadece http:// veya https:// relay adresi kullan."
          : "Use only an http:// or https:// relay address.",
      );
      return;
    }

    setServerTesting(true);
    setServerTestResult("idle");
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const response = await fetch(
        new URL("/api/health", normalizedTargetUrl).toString(),
        { signal: controller.signal },
      );
      clearTimeout(timeoutId);
      const data = await response.json().catch(() => null);
      setServerTestResult(response.ok && data?.status === "ok" ? "ok" : "fail");
    } catch {
      setServerTestResult("fail");
    } finally {
      setServerTesting(false);
    }
  };

  const doFinish = useCallback(
    async (withTor: boolean) => {
      if (withTor) {
        await updateTorSettings({
          enabled: true,
          connectionStatus: "connecting",
        });
      }
      await setOnboardingComplete();
      onComplete();
    },
    [onComplete],
  );

  /** Tor bağlantısını check.torproject.org ile doğrula, sonra devam et */
  const checkTorAndFinish = useCallback(async () => {
    setCheckingTor(true);
    setTorCheckResult("checking");
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const res = await fetch("https://check.torproject.org/api/ip", {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();

      if (data.IsTor === true) {
        setTorCheckResult("ok");
        await updateTorSettings({
          enabled: true,
          connectionStatus: "connected",
        });
        await setOnboardingComplete();
        onComplete();
      } else {
        setTorCheckResult("fail");
        setCheckingTor(false);
        Alert.alert(
          isTr ? "Tor Tespit Edilmedi" : "Tor Not Detected",
          isTr
            ? `Bağlantı Clearnet üzerinden gidiyor.\nMevcut IP: ${data.IP}\n\nOrbot'ta "Tüm Uygulamalar için VPN" modunun açık olduğundan emin olun.`
            : `Traffic is not going through Tor.\nCurrent IP: ${data.IP}\n\nMake sure Orbot has "VPN for All Apps" enabled.`,
          [
            {
              text: isTr ? "Tekrar Dene" : "Retry",
              onPress: checkTorAndFinish,
            },
            {
              text: isTr ? "Clearnet ile Devam" : "Continue without Tor",
              style: "cancel",
              onPress: () => doFinish(false),
            },
          ],
        );
      }
    } catch {
      setTorCheckResult("fail");
      setCheckingTor(false);
      Alert.alert(
        isTr ? "Bağlantı Hatası" : "Connection Error",
        isTr
          ? "Tor durumu kontrol edilemedi. İnternet bağlantınızı ve Orbot'un çalıştığını kontrol edin."
          : "Could not verify Tor status. Check your internet connection and that Orbot is running.",
        [
          { text: isTr ? "Tekrar Dene" : "Retry", onPress: checkTorAndFinish },
          {
            text: isTr ? "Clearnet ile Devam" : "Continue without Tor",
            style: "cancel",
            onPress: () => doFinish(false),
          },
        ],
      );
    }
  }, [isTr, doFinish, onComplete]);

  const handleFinish = async () => {
    haptic();
    const saved = await persistServerChoice();
    if (!saved) return;

    if (displayNameInput.trim()) {
      await updateDisplayName(displayNameInput.trim());
    }

    // Electron'da Tor seçildiyse → Electron Tor yöneticisini kullan
    if (connectionMode === "tor" && isElectron()) {
      setCheckingTor(true);
      setTorCheckResult("checking");
      try {
        await updateTorSettings({
          enabled: true,
          connectionStatus: "connecting",
        });

        // Tor durumunu dinle
        const unsub = electronOnTorStatus?.((status) => {
          if (status.progress !== undefined) {
            // progress bilgisi için ek state kullanılabilir ama şimdilik sadece log
          }
        });

        const result = await electronEnableTor();
        unsub?.();

        if (!result.success) {
          setTorCheckResult("fail");
          setCheckingTor(false);
          Alert.alert(
            isTr ? "Tor Başlatılamadı" : "Tor Failed to Start",
            result.error ||
              (isTr
                ? "Tor başlatılırken hata oluştu."
                : "An error occurred while starting Tor."),
            [
              {
                text: isTr ? "Clearnet ile Devam" : "Continue with Clearnet",
                onPress: () => doFinish(false),
              },
              { text: isTr ? "Tekrar Dene" : "Retry", onPress: handleFinish },
            ],
          );
          return;
        }

        // Tor doğrulama
        const verify = await electronVerifyTor();
        if (verify?.isTor) {
          setTorCheckResult("ok");
          await updateTorSettings({ connectionStatus: "connected" });
          await setOnboardingComplete();
          onComplete();
        } else {
          setTorCheckResult("fail");
          setCheckingTor(false);
          Alert.alert(
            isTr ? "Tor Tespit Edilmedi" : "Tor Not Detected",
            isTr
              ? `Trafik Tor üzerinden geçmiyor.\nMevcut IP: ${verify?.ip || "?"}`
              : `Traffic is not going through Tor.\nCurrent IP: ${verify?.ip || "?"}`,
            [
              { text: isTr ? "Tekrar Dene" : "Retry", onPress: handleFinish },
              {
                text: isTr ? "Clearnet ile Devam" : "Continue with Clearnet",
                style: "cancel",
                onPress: () => doFinish(false),
              },
            ],
          );
        }
      } catch {
        setTorCheckResult("fail");
        setCheckingTor(false);
        Alert.alert(
          isTr ? "Bağlantı Hatası" : "Connection Error",
          isTr
            ? "Tor başlatılamadı veya doğrulanamadı."
            : "Could not start or verify Tor.",
          [
            { text: isTr ? "Tekrar Dene" : "Retry", onPress: handleFinish },
            {
              text: isTr ? "Clearnet ile Devam" : "Continue with Clearnet",
              style: "cancel",
              onPress: () => doFinish(false),
            },
          ],
        );
      }
      return;
    }

    // Android/iOS'ta Tor seçildiyse → Orbot kılavuzu göster
    if (connectionMode === "tor" && Platform.OS !== "web") {
      Alert.alert(
        isTr ? "Tor Modu — Orbot Gerekli" : "Tor Mode — Orbot Required",
        isTr
          ? "Android'de Tor trafiği için Orbot uygulaması VPN modunda çalışmalıdır.\n\n1. Play Store'dan Orbot'u yükleyin\n2. Orbot'ta \"Tüm Uygulamalar için VPN\" modunu açın\n3. Orbot bağlandıktan sonra \"Orbot Hazır, Bağlantıyı Test Et\" butonuna basın."
          : 'Tor traffic on Android requires the Orbot app running in VPN mode.\n\n1. Install Orbot from Play Store\n2. Enable "VPN for All Apps" in Orbot\n3. Once connected, tap "Test Tor Connection".',
        [
          {
            text: isTr ? "Clearnet ile Devam" : "Continue with Clearnet",
            style: "cancel",
            onPress: () => doFinish(false),
          },
          {
            text: isTr ? "Orbot'u İndir" : "Get Orbot",
            onPress: () => {
              Linking.openURL(
                "market://details?id=org.torproject.android",
              ).catch(() =>
                Linking.openURL(
                  "https://play.google.com/store/apps/details?id=org.torproject.android",
                ),
              );
            },
          },
          {
            text: isTr
              ? "Orbot Hazır, Bağlantıyı Test Et"
              : "Test Tor Connection",
            onPress: () => checkTorAndFinish(),
          },
        ],
      );
      return;
    }

    if (connectionMode === "tor") {
      await checkTorAndFinish();
      return;
    }

    await doFinish(false);
  };

  const modes: {
    id: ConnectionMode;
    icon: keyof typeof Feather.glyphMap;
    title: string;
    desc: string;
    badge: string;
    badgeColor: string;
  }[] = [
    {
      id: "clearnet",
      icon: "globe",
      title: "Clearnet",
      desc: isTr
        ? "Normal internet. Hızlı, ancak IP adresiniz görünür."
        : "Regular internet. Fast, but your IP is visible.",
      badge: isTr ? "Hızlı" : "Fast",
      badgeColor: Colors.dark.warning,
    },
    {
      id: "tor",
      icon: "shield",
      title: isTr ? "Tor Ağı" : "Tor Network",
      desc: isTr
        ? "Tam anonimlik. 3 katmanlı şifreleme. IP gizlenir. Orbot gerektirir."
        : "Full anonymity. 3-layer encryption. IP hidden. Requires Orbot.",
      badge: isTr ? "Önerilen" : "Recommended",
      badgeColor: Colors.dark.success,
    },
  ];

  const servers: {
    id: ServerType;
    icon: keyof typeof Feather.glyphMap;
    title: string;
    desc: string;
    url: string;
    disabled?: boolean;
  }[] = [
    {
      id: "official",
      icon: "zap",
      title: isTr ? "Hazir CipherNode Relay" : "Ready CipherNode Relay",
      desc: isTr
        ? "Hemen baslamak icin resmi relay sunucusunu kullan."
        : "Use the official relay server to start immediately.",
      url:
        officialServerUrl ||
        (isTr ? "Bu build icin ayarlanmadi" : "Not configured in this build"),
      disabled: !hasOfficialServer,
    },
    {
      id: "custom",
      icon: "server",
      title: isTr ? "Kendi Sunucum" : "My Own Server",
      desc: isTr
        ? "Docker, VPS, Termux veya .onion relay adresini kullan."
        : "Use a Docker, VPS, Termux, or .onion relay address.",
      url: customServerUrl || "https://relay.example.com",
    },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.lg }]}>
      {/* Progress dots */}
      <View style={styles.dots}>
        {dotStyles.map((style, i) => (
          <Animated.View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: Colors.dark.primary },
              style,
            ]}
          />
        ))}
      </View>

      {/* ── ADIM 0: Karşılama ── */}
      {step === 0 && (
        <ScrollView
          contentContainerStyle={styles.stepContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.iconWrap}>
            <Animated.View style={styles.iconInner}>
              <Feather name="shield" size={48} color={Colors.dark.primary} />
            </Animated.View>
          </View>

          <ThemedText style={styles.stepTitle}>
            {isTr ? "CipherNode'a Hoş Geldin" : "Welcome to CipherNode"}
          </ThemedText>
          <ThemedText style={styles.stepDesc}>
            {isTr
              ? "Tor tabanlı, iz bırakmayan, uçtan uca şifreli mesajlaşma platformu."
              : "Tor-based, trace-free, end-to-end encrypted messaging platform."}
          </ThemedText>

          <View style={styles.featureList}>
            {(isTr
              ? [
                  "Sunucu mesaj içeriğini göremez",
                  "Kimlik = kriptografik anahtar, kişisel veri yok",
                  "OpenPGP ile uçtan uca şifreleme",
                  "RAM-only mesaj kuyruğu, log kaydı yok",
                ]
              : [
                  "Server cannot read message content",
                  "Identity = cryptographic key, no personal data",
                  "End-to-end encryption via OpenPGP",
                  "RAM-only message queue, no logs",
                ]
            ).map((item, i) => (
              <View key={i} style={styles.featureItem}>
                <View style={styles.featureCheck}>
                  <Feather name="check" size={10} color={Colors.dark.primary} />
                </View>
                <ThemedText style={styles.featureText}>{item}</ThemedText>
              </View>
            ))}
          </View>

          <Pressable
            onPress={handleNext}
            style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
          >
            <ThemedText style={styles.btnText}>
              {isTr ? "Kimlik Oluştur" : "Create Identity"}
            </ThemedText>
            <Feather
              name="chevron-right"
              size={18}
              color={Colors.dark.buttonText}
            />
          </Pressable>
        </ScrollView>
      )}

      {/* ── ADIM 1: Kimlik ── */}
      {step === 1 && (
        <ScrollView
          contentContainerStyle={styles.stepContent}
          showsVerticalScrollIndicator={false}
        >
          <ThemedText style={styles.stepTitle}>
            {isTr ? "Kimliğin Oluşturuldu" : "Identity Created"}
          </ThemedText>
          <ThemedText style={styles.stepDesc}>
            {isTr
              ? "Benzersiz kriptografik kimliğin otomatik üretildi."
              : "Your unique cryptographic identity was automatically generated."}
          </ThemedText>

          {/* ID display */}
          <View style={styles.idBox}>
            <ThemedText style={styles.idLabel}>
              {isTr ? "KİMLİK ID'N" : "YOUR IDENTITY ID"}
            </ThemedText>
            {generating ? (
              <ActivityIndicator
                size="small"
                color={Colors.dark.primary}
                style={{ marginTop: Spacing.sm }}
              />
            ) : (
              <View style={styles.idRow}>
                <ThemedText style={styles.idValue}>
                  {displayedId}
                  {!typewriterDone && (
                    <ThemedText style={styles.cursor}> |</ThemedText>
                  )}
                </ThemedText>
              </View>
            )}
          </View>

          {/* Takma ad */}
          <View style={styles.inputWrap}>
            <ThemedText style={styles.inputLabel}>
              {isTr ? "TAKMA AD (OPSİYONEL)" : "DISPLAY NAME (OPTIONAL)"}
            </ThemedText>
            <TextInput
              style={styles.input}
              value={displayNameInput}
              onChangeText={(t) =>
                setDisplayNameInput(
                  t
                    .toLowerCase()
                    .replace(/[^a-z0-9_]/g, "")
                    .slice(0, 24),
                )
              }
              placeholder={isTr ? "örn: neon_ghost" : "e.g. neon_ghost"}
              placeholderTextColor={Colors.dark.textDisabled}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <ThemedText style={styles.inputHint}>
              {isTr
                ? "Harf, rakam ve _ kullanabilirsin (maks. 24 karakter)"
                : "Letters, numbers and _ (max 24 chars)"}
            </ThemedText>
          </View>

          <View style={styles.btnRow}>
            <Pressable onPress={handleBack} style={styles.btnSecondary}>
              <ThemedText style={styles.btnSecondaryText}>
                {isTr ? "Geri" : "Back"}
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={handleNext}
              disabled={!typewriterDone}
              style={({ pressed }) => [
                styles.btnFlex,
                !typewriterDone && styles.btnDisabled,
                pressed && typewriterDone && styles.btnPressed,
              ]}
            >
              <ThemedText style={styles.btnText}>
                {isTr ? "Devam Et" : "Continue"}
              </ThemedText>
              <Feather
                name="chevron-right"
                size={16}
                color={Colors.dark.buttonText}
              />
            </Pressable>
          </View>
        </ScrollView>
      )}

      {/* ── ADIM 2: Sunucu Seçimi ── */}
      {step === 2 && (
        <ScrollView
          contentContainerStyle={styles.stepContent}
          showsVerticalScrollIndicator={false}
        >
          <ThemedText style={styles.stepTitle}>
            {isTr ? "Sunucu Secimi" : "Server Choice"}
          </ThemedText>
          <ThemedText style={styles.stepDesc}>
            {isTr
              ? "Hazir relay ile basla veya kendi sunucunu bagla. Bunu ayarlardan daha sonra degistirebilirsin."
              : "Start with the ready relay or connect your own server. You can change this later in settings."}
          </ThemedText>

          <View style={styles.modeList}>
            {servers.map(({ id, icon, title, desc, url, disabled }) => (
              <Pressable
                key={id}
                onPress={() => {
                  if (!disabled) {
                    setServerType(id);
                    setServerTestResult("idle");
                  }
                }}
                style={[
                  styles.modeCard,
                  serverType === id && !disabled && styles.modeCardSelected,
                  disabled && styles.modeCardDisabled,
                ]}
              >
                <View
                  style={[
                    styles.modeIcon,
                    serverType === id && !disabled && styles.modeIconSelected,
                  ]}
                >
                  <Feather
                    name={icon}
                    size={20}
                    color={
                      serverType === id && !disabled
                        ? Colors.dark.primary
                        : Colors.dark.textSecondary
                    }
                  />
                </View>
                <View style={styles.modeContent}>
                  <View style={styles.modeTitleRow}>
                    <ThemedText
                      style={[
                        styles.modeTitle,
                        serverType === id &&
                          !disabled &&
                          styles.modeTitleSelected,
                      ]}
                    >
                      {title}
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.modeDesc}>{desc}</ThemedText>
                  <ThemedText style={styles.serverUrlPreview} numberOfLines={1}>
                    {url}
                  </ThemedText>
                </View>
                {serverType === id && !disabled && (
                  <View style={styles.modeCheck}>
                    <Feather name="check" size={14} color="#fff" />
                  </View>
                )}
              </Pressable>
            ))}
          </View>

          {serverType === "custom" && (
            <View style={styles.inputWrap}>
              <ThemedText style={styles.inputLabel}>RELAY URL</ThemedText>
              <TextInput
                style={styles.input}
                value={customServerUrl}
                onChangeText={(value) => {
                  setCustomServerUrlInput(value);
                  setServerTestResult("idle");
                }}
                placeholder="https://relay.domain.com"
                placeholderTextColor={Colors.dark.textDisabled}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <ThemedText style={styles.inputHint}>
                {isTr
                  ? "Sunucuda /api/health ve Socket.IO/WebSocket erisilebilir olmali."
                  : "The server must expose /api/health and Socket.IO/WebSocket."}
              </ThemedText>
            </View>
          )}

          <View
            style={[
              styles.serverStatus,
              serverTestResult === "ok" && styles.serverStatusOk,
              serverTestResult === "fail" && styles.serverStatusFail,
            ]}
          >
            {serverTesting ? (
              <ActivityIndicator size="small" color={Colors.dark.primary} />
            ) : (
              <Feather
                name={
                  serverTestResult === "ok"
                    ? "check-circle"
                    : serverTestResult === "fail"
                      ? "alert-circle"
                      : "wifi"
                }
                size={14}
                color={
                  serverTestResult === "ok"
                    ? Colors.dark.success
                    : serverTestResult === "fail"
                      ? Colors.dark.warning
                      : Colors.dark.textSecondary
                }
              />
            )}
            <ThemedText
              style={[
                styles.serverStatusText,
                serverTestResult === "ok" && { color: Colors.dark.success },
                serverTestResult === "fail" && { color: Colors.dark.warning },
              ]}
            >
              {serverTesting
                ? isTr
                  ? "Sunucu test ediliyor..."
                  : "Testing server..."
                : serverTestResult === "ok"
                  ? isTr
                    ? "Sunucu erisilebilir."
                    : "Server is reachable."
                  : serverTestResult === "fail"
                    ? isTr
                      ? "Sunucuya ulasilamadi. Yine de kaydedip devam edebilirsin."
                      : "Server could not be reached. You can still save and continue."
                    : isTr
                      ? "Istersen devam etmeden once baglantiyi test et."
                      : "You can test the connection before continuing."}
            </ThemedText>
          </View>

          <View style={styles.btnRow}>
            <Pressable onPress={handleBack} style={styles.btnSecondary}>
              <ThemedText style={styles.btnSecondaryText}>
                {isTr ? "Geri" : "Back"}
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={handleTestServer}
              disabled={serverTesting}
              style={[styles.btnSecondary, serverTesting && { opacity: 0.4 }]}
            >
              <ThemedText style={styles.btnSecondaryText}>Test</ThemedText>
            </Pressable>
            <Pressable
              onPress={handleServerNext}
              disabled={
                serverTesting || (serverType === "official" && !hasOfficialServer)
              }
              style={({ pressed }) => [
                styles.btnFlex,
                (serverTesting ||
                  (serverType === "official" && !hasOfficialServer)) &&
                  styles.btnDisabled,
                pressed &&
                  !serverTesting &&
                  !(serverType === "official" && !hasOfficialServer) &&
                  styles.btnPressed,
              ]}
            >
              <ThemedText style={styles.btnText}>
                {isTr ? "Devam" : "Continue"}
              </ThemedText>
              <Feather
                name="chevron-right"
                size={16}
                color={Colors.dark.buttonText}
              />
            </Pressable>
          </View>
        </ScrollView>
      )}

      {/* ── ADIM 3: Bağlantı Modu ── */}
      {step === 3 && (
        <ScrollView
          contentContainerStyle={styles.stepContent}
          showsVerticalScrollIndicator={false}
        >
          <ThemedText style={styles.stepTitle}>
            {isTr ? "Bağlantı Modu" : "Connection Mode"}
          </ThemedText>
          <ThemedText style={styles.stepDesc}>
            {isTr
              ? "Relay secildi. Simdi trafik yolunu belirle."
              : "Relay selected. Now choose the traffic route."}
          </ThemedText>

          <View style={styles.selectedServerPill}>
            <Feather name="server" size={14} color={Colors.dark.primary} />
            <ThemedText style={styles.selectedServerText} numberOfLines={1}>
              {getSelectedServerUrl() ||
                (isTr ? "Sunucu secilmedi" : "No server selected")}
            </ThemedText>
          </View>

          <View style={styles.modeList}>
            {modes.map(({ id, icon, title, desc, badge, badgeColor }) => (
              <Pressable
                key={id}
                onPress={() => setConnectionMode(id)}
                style={[
                  styles.modeCard,
                  connectionMode === id && styles.modeCardSelected,
                ]}
              >
                <View
                  style={[
                    styles.modeIcon,
                    connectionMode === id && styles.modeIconSelected,
                  ]}
                >
                  <Feather
                    name={icon}
                    size={20}
                    color={
                      connectionMode === id
                        ? Colors.dark.primary
                        : Colors.dark.textSecondary
                    }
                  />
                </View>
                <View style={styles.modeContent}>
                  <View style={styles.modeTitleRow}>
                    <ThemedText
                      style={[
                        styles.modeTitle,
                        connectionMode === id && styles.modeTitleSelected,
                      ]}
                    >
                      {title}
                    </ThemedText>
                    <View
                      style={[
                        styles.modeBadge,
                        { backgroundColor: badgeColor + "22" },
                      ]}
                    >
                      <ThemedText
                        style={[styles.modeBadgeText, { color: badgeColor }]}
                      >
                        {badge}
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText style={styles.modeDesc}>{desc}</ThemedText>
                </View>
                {connectionMode === id && (
                  <View style={styles.modeCheck}>
                    <Feather name="check" size={14} color="#fff" />
                  </View>
                )}
              </Pressable>
            ))}
          </View>

          {connectionMode === "tor" && (
            <View
              style={[
                styles.torNote,
                torCheckResult === "ok" && styles.torNoteSuccess,
                torCheckResult === "fail" && styles.torNoteFail,
              ]}
            >
              {checkingTor ? (
                <ActivityIndicator size="small" color={Colors.dark.primary} />
              ) : (
                <Feather
                  name={
                    torCheckResult === "ok"
                      ? "check-circle"
                      : torCheckResult === "fail"
                        ? "alert-circle"
                        : "info"
                  }
                  size={14}
                  color={
                    torCheckResult === "ok"
                      ? Colors.dark.success
                      : torCheckResult === "fail"
                        ? Colors.dark.warning
                        : Colors.dark.textSecondary
                  }
                />
              )}
              <ThemedText
                style={[
                  styles.torNoteText,
                  torCheckResult === "ok" && { color: Colors.dark.success },
                  torCheckResult === "fail" && { color: Colors.dark.warning },
                ]}
              >
                {checkingTor
                  ? isTr
                    ? "Tor bağlantısı kontrol ediliyor..."
                    : "Checking Tor connection..."
                  : torCheckResult === "ok"
                    ? isTr
                      ? "✓ Tor bağlantısı doğrulandı"
                      : "✓ Tor connection verified"
                    : torCheckResult === "fail"
                      ? isTr
                        ? "Tor tespit edilemedi. Orbot aktif mi?"
                        : "Tor not detected. Is Orbot running?"
                      : isTr
                        ? "Orbot uygulaması VPN modunda çalışmalıdır."
                        : "Orbot app must be running in VPN mode."}
              </ThemedText>
            </View>
          )}

          <View style={styles.btnRow}>
            <Pressable
              onPress={handleBack}
              disabled={checkingTor}
              style={[styles.btnSecondary, checkingTor && { opacity: 0.4 }]}
            >
              <ThemedText style={styles.btnSecondaryText}>
                {isTr ? "Geri" : "Back"}
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={handleFinish}
              disabled={checkingTor}
              style={({ pressed }) => [
                styles.btnFlex,
                checkingTor && styles.btnDisabled,
                pressed && !checkingTor && styles.btnPressed,
              ]}
            >
              {checkingTor ? (
                <ActivityIndicator
                  size="small"
                  color={Colors.dark.buttonText}
                />
              ) : (
                <>
                  <ThemedText style={styles.btnText}>
                    {isTr ? "CipherNode'a Gir" : "Enter CipherNode"}
                  </ThemedText>
                  <Feather
                    name="check"
                    size={16}
                    color={Colors.dark.buttonText}
                  />
                </>
              )}
            </Pressable>
          </View>
        </ScrollView>
      )}

      <View style={{ height: Math.max(insets.bottom, Spacing.lg) }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginBottom: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  stepContent: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing["2xl"],
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 22,
    backgroundColor: Colors.dark.primary + "18",
    borderWidth: 1,
    borderColor: Colors.dark.primary + "33",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: Spacing["2xl"],
  },
  iconInner: {
    alignItems: "center",
    justifyContent: "center",
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: Colors.dark.text,
    marginBottom: Spacing.sm,
    textAlign: "center",
  },
  stepDesc: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: Spacing["2xl"],
  },
  featureList: {
    gap: Spacing.md,
    marginBottom: Spacing["2xl"],
  },
  featureItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
  },
  featureCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.dark.primary + "22",
    borderWidth: 1,
    borderColor: Colors.dark.primary + "44",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  featureText: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    flex: 1,
    lineHeight: 20,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.dark.primary,
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.xs,
    gap: Spacing.sm,
  },
  btnFlex: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.dark.primary,
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.xs,
    gap: Spacing.sm,
  },
  btnPressed: { opacity: 0.8 },
  btnDisabled: { opacity: 0.4 },
  btnText: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.dark.buttonText,
  },
  btnRow: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  btnSecondary: {
    flex: 1,
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    alignItems: "center",
    justifyContent: "center",
  },
  btnSecondaryText: {
    fontSize: 14,
    fontWeight: "500",
    color: Colors.dark.textSecondary,
  },
  // Identity step
  idBox: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.xs,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  idLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: Colors.dark.textSecondary,
    textTransform: "uppercase",
    marginBottom: Spacing.sm,
  },
  idRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 34,
  },
  idValue: {
    fontSize: 22,
    fontFamily: Fonts?.mono ?? undefined,
    color: Colors.dark.primary,
    fontWeight: "700",
    letterSpacing: 2,
  },
  cursor: {
    color: Colors.dark.primary,
    opacity: 0.7,
  },
  inputWrap: { marginBottom: Spacing.xl },
  inputLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: Colors.dark.textSecondary,
    textTransform: "uppercase",
    marginBottom: Spacing.sm,
  },
  input: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: 14,
    color: Colors.dark.text,
    fontFamily: Fonts?.mono ?? undefined,
  },
  inputHint: {
    fontSize: 11,
    color: Colors.dark.textDisabled,
    marginTop: Spacing.xs,
  },
  // Connection mode
  modeList: {
    marginBottom: Spacing.xl,
  },
  modeCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.lg,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    backgroundColor: Colors.dark.backgroundSecondary,
    marginBottom: Spacing.md,
  },
  modeCardSelected: {
    borderColor: Colors.dark.primary,
    backgroundColor: Colors.dark.primary + "0D",
  },
  modeCardDisabled: {
    opacity: 0.45,
  },
  modeIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Colors.dark.backgroundRoot,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginRight: Spacing.md,
  },
  modeIconSelected: {
    backgroundColor: Colors.dark.primary + "22",
  },
  modeContent: { flex: 1 },
  modeTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
    flexWrap: "wrap",
    columnGap: Spacing.sm,
  },
  modeTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.dark.textSecondary,
  },
  modeTitleSelected: { color: Colors.dark.text },
  modeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  modeBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  modeDesc: {
    fontSize: 12,
    color: Colors.dark.textDisabled,
    lineHeight: 18,
  },
  serverUrlPreview: {
    fontSize: 11,
    color: Colors.dark.primary,
    fontFamily: Fonts?.mono ?? undefined,
    marginTop: Spacing.sm,
  },
  modeCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.dark.primary,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    alignSelf: "center",
  },
  torNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.xs,
    padding: Spacing.md,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  torNoteSuccess: {
    borderColor: Colors.dark.success + "66",
    backgroundColor: Colors.dark.success + "11",
  },
  torNoteFail: {
    borderColor: Colors.dark.warning + "66",
    backgroundColor: Colors.dark.warning + "11",
  },
  torNoteText: {
    flex: 1,
    fontSize: 12,
    color: Colors.dark.textSecondary,
    lineHeight: 18,
  },
  serverStatus: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.xs,
    padding: Spacing.md,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  serverStatusOk: {
    borderColor: Colors.dark.success + "66",
    backgroundColor: Colors.dark.success + "11",
  },
  serverStatusFail: {
    borderColor: Colors.dark.warning + "66",
    backgroundColor: Colors.dark.warning + "11",
  },
  serverStatusText: {
    flex: 1,
    fontSize: 12,
    color: Colors.dark.textSecondary,
    lineHeight: 18,
  },
  selectedServerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  selectedServerText: {
    flex: 1,
    fontSize: 12,
    color: Colors.dark.textSecondary,
    fontFamily: Fonts?.mono ?? undefined,
  },
});
