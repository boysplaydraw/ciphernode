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
  updateTorSettings,
} from "@/lib/storage";
import { getOrCreateIdentity, updateDisplayName } from "@/lib/crypto";
import { useLanguage } from "@/constants/language";

type ConnectionMode = "clearnet" | "tor";

interface OnboardingScreenProps {
  onComplete: () => void;
}

export default function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const insets = useSafeAreaInsets();
  const { language } = useLanguage();
  const isTr = language === "tr";

  const [step, setStep] = useState(0);
  const [userId, setUserId] = useState("");
  const [displayedId, setDisplayedId] = useState("");
  const [typewriterDone, setTypewriterDone] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("clearnet");

  // 3 adet progress dot için ayrı shared values (hooks kuralı: koşullu çağrılmaz)
  const dot0 = useSharedValue(true);
  const dot1 = useSharedValue(false);
  const dot2 = useSharedValue(false);

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

  const dotStyles = [dot0Style, dot1Style, dot2Style];

  const goToStep = useCallback((s: number) => {
    dot0.value = s === 0;
    dot1.value = s === 1;
    dot2.value = s === 2;
    setStep(s);
  }, [dot0, dot1, dot2]);

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
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleNext = () => {
    haptic();
    goToStep(step + 1);
  };

  const handleBack = () => {
    haptic();
    goToStep(step - 1);
  };

  const handleFinish = async () => {
    haptic();
    if (displayNameInput.trim()) {
      await updateDisplayName(displayNameInput.trim());
    }
    if (connectionMode === "tor") {
      await updateTorSettings({ enabled: true, connectionStatus: "connecting" });
    }
    await setOnboardingComplete();
    onComplete();
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

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.lg }]}>
      {/* Progress dots */}
      <View style={styles.dots}>
        {dotStyles.map((style, i) => (
          <Animated.View
            key={i}
            style={[styles.dot, { backgroundColor: Colors.dark.primary }, style]}
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
            <Feather name="chevron-right" size={18} color={Colors.dark.buttonText} />
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
              {isTr ? "TAKMa AD (OPSİYONEL)" : "DISPLAY NAME (OPTIONAL)"}
            </ThemedText>
            <TextInput
              style={styles.input}
              value={displayNameInput}
              onChangeText={(t) =>
                setDisplayNameInput(t.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24))
              }
              placeholder={isTr ? "örn: neon_ghost" : "e.g. neon_ghost"}
              placeholderTextColor={Colors.dark.textDisabled}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <ThemedText style={styles.inputHint}>
              {isTr ? "Harf, rakam ve _ kullanabilirsin (maks. 24 karakter)" : "Letters, numbers and _ (max 24 chars)"}
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
              <Feather name="chevron-right" size={16} color={Colors.dark.buttonText} />
            </Pressable>
          </View>
        </ScrollView>
      )}

      {/* ── ADIM 2: Bağlantı Modu ── */}
      {step === 2 && (
        <ScrollView
          contentContainerStyle={styles.stepContent}
          showsVerticalScrollIndicator={false}
        >
          <ThemedText style={styles.stepTitle}>
            {isTr ? "Bağlantı Modu" : "Connection Mode"}
          </ThemedText>
          <ThemedText style={styles.stepDesc}>
            {isTr ? "Nasıl bağlanmak istediğini seç." : "Choose how you want to connect."}
          </ThemedText>

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
            <View style={styles.torNote}>
              <Feather name="info" size={12} color={Colors.dark.textSecondary} />
              <ThemedText style={styles.torNoteText}>
                {isTr
                  ? "Tor kullanmak için Android'de Orbot uygulamasının çalışıyor olması gerekir."
                  : "Orbot app must be running on Android to use Tor."}
              </ThemedText>
            </View>
          )}

          <View style={styles.btnRow}>
            <Pressable onPress={handleBack} style={styles.btnSecondary}>
              <ThemedText style={styles.btnSecondaryText}>
                {isTr ? "Geri" : "Back"}
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={handleFinish}
              style={({ pressed }) => [styles.btnFlex, pressed && styles.btnPressed]}
            >
              <ThemedText style={styles.btnText}>
                {isTr ? "CipherNode'a Gir" : "Enter CipherNode"}
              </ThemedText>
              <Feather name="check" size={16} color={Colors.dark.buttonText} />
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
    gap: Spacing.md,
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
    gap: Spacing.md,
  },
  modeCardSelected: {
    borderColor: Colors.dark.primary,
    backgroundColor: Colors.dark.primary + "0D",
  },
  modeIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Colors.dark.backgroundRoot,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  modeIconSelected: {
    backgroundColor: Colors.dark.primary + "22",
  },
  modeContent: { flex: 1 },
  modeTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: 2,
    flexWrap: "wrap",
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
  },
  torNoteText: {
    flex: 1,
    fontSize: 12,
    color: Colors.dark.textSecondary,
    lineHeight: 18,
  },
});
