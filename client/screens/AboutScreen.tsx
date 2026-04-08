import React, { useState, useCallback } from "react";
import { View, ScrollView, StyleSheet, Pressable, Linking, Alert, ActivityIndicator } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { useLanguage } from "@/constants/language";

const CURRENT_VERSION = "1.0.0";
const GITHUB_RELEASES_API = "https://api.github.com/repos/boysplaydraw/ciphernode/releases/latest";
const GITHUB_RELEASES_URL = "https://github.com/boysplaydraw/ciphernode/releases/latest";

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

interface LinkRowProps {
  icon: string;
  title: string;
  url: string;
}

function LinkRow({ icon, title, url }: LinkRowProps) {
  return (
    <Pressable
      onPress={() => Linking.openURL(url)}
      style={({ pressed }) => [
        styles.linkRow,
        pressed && styles.linkRowPressed,
      ]}
    >
      <Feather name={icon as any} size={20} color={Colors.dark.primary} />
      <ThemedText style={styles.linkTitle}>{title}</ThemedText>
      <Feather
        name="external-link"
        size={16}
        color={Colors.dark.textSecondary}
      />
    </Pressable>
  );
}

export default function AboutScreen() {
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { language } = useLanguage();
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "up-to-date" | "available" | "error">("idle");
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  const checkForUpdates = useCallback(async () => {
    setUpdateStatus("checking");
    try {
      // Electron: IPC üzerinden
      const win = typeof window !== "undefined" ? (window as any) : null;
      if (win?.electronAPI?.updater) {
        win.electronAPI.updater.onStatus((info: any) => {
          if (info.status === "available") {
            setLatestVersion(info.version);
            setUpdateStatus("available");
            Alert.alert(
              language === "tr" ? "Güncelleme Mevcut" : "Update Available",
              `v${info.version} ${language === "tr" ? "mevcut. Yüklenince bildirim alacaksınız." : "is available and will be installed on restart."}`,
            );
          } else if (info.status === "not-available") {
            setUpdateStatus("up-to-date");
          } else if (info.status === "error") {
            setUpdateStatus("error");
          }
        });
        win.electronAPI.updater.check();
        return;
      }

      // Mobil: GitHub API
      const res = await fetch(GITHUB_RELEASES_API, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const latest = (data.tag_name as string).replace(/^v/, "");
      setLatestVersion(latest);

      if (compareVersions(latest, CURRENT_VERSION) > 0) {
        setUpdateStatus("available");
        Alert.alert(
          language === "tr" ? "Güncelleme Mevcut" : "Update Available",
          `v${latest} ${language === "tr" ? "mevcut. İndirmek için tıklayın." : "is available. Tap to download."}`,
          [
            { text: language === "tr" ? "İptal" : "Cancel", style: "cancel" },
            { text: language === "tr" ? "İndir" : "Download", onPress: () => Linking.openURL(GITHUB_RELEASES_URL) },
          ],
        );
      } else {
        setUpdateStatus("up-to-date");
      }
    } catch {
      setUpdateStatus("error");
    }
  }, [language]);

  const t = {
    version: language === "tr" ? "Sürüm" : "Version",
    description:
      language === "tr"
        ? "Hesap, izleme ve veri toplama olmadan gizlilik öncelikli, uçtan uca şifreli mesajlaşma."
        : "Privacy-first, end-to-end encrypted messaging with no accounts, no tracking, and no data collection.",
    features: language === "tr" ? "Özellikler" : "Features",
    noAccountRequired:
      language === "tr" ? "Hesap gerekmez" : "No account required",
    e2eEncryption:
      language === "tr"
        ? "Uçtan uca şifreleme (OpenPGP)"
        : "End-to-end encryption (OpenPGP)",
    p2pRelay: language === "tr" ? "Yedek ile P2P" : "P2P with relay fallback",
    noLogServers:
      language === "tr" ? "Kayıt tutmayan sunucular" : "No-log relay servers",
    selfHostable:
      language === "tr" ? "Kendi barındırılabilir" : "Self-hostable",
    openSource:
      language === "tr" ? "Açık kaynak (GPLv3)" : "Open source (GPLv3)",
    links: language === "tr" ? "Bağlantılar" : "Links",
    sourceCode: language === "tr" ? "Kaynak Kodu" : "Source Code",
    documentation: language === "tr" ? "Dokümantasyon" : "Documentation",
    reportIssue: language === "tr" ? "Sorun Bildir" : "Report Issue",
    legal: language === "tr" ? "Yasal" : "Legal",
    privacyPolicy: language === "tr" ? "Gizlilik Politikası" : "Privacy Policy",
    termsOfService:
      language === "tr" ? "Kullanım Şartları" : "Terms of Service",
    license: language === "tr" ? "Lisans" : "License",
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
      >
        <View style={styles.logoSection}>
          <View style={styles.logoContainer}>
            <Feather name="shield" size={48} color={Colors.dark.primary} />
          </View>
          <ThemedText style={styles.appName}>CipherNode</ThemedText>
          <ThemedText style={styles.version}>{t.version} {CURRENT_VERSION}</ThemedText>
          <Pressable
            onPress={updateStatus === "checking" ? undefined : checkForUpdates}
            style={({ pressed }) => [styles.updateBtn, pressed && { opacity: 0.7 }]}
          >
            {updateStatus === "checking" ? (
              <ActivityIndicator size="small" color={Colors.dark.primary} />
            ) : (
              <Feather
                name={updateStatus === "available" ? "download" : updateStatus === "up-to-date" ? "check-circle" : "refresh-cw"}
                size={14}
                color={updateStatus === "available" ? Colors.dark.success : updateStatus === "up-to-date" ? Colors.dark.success : Colors.dark.primary}
              />
            )}
            <ThemedText style={[styles.updateBtnText, updateStatus === "available" && { color: Colors.dark.success }, updateStatus === "up-to-date" && { color: Colors.dark.success }]}>
              {updateStatus === "checking"
                ? (language === "tr" ? "Kontrol ediliyor…" : "Checking…")
                : updateStatus === "available"
                ? (language === "tr" ? `v${latestVersion} mevcut` : `v${latestVersion} available`)
                : updateStatus === "up-to-date"
                ? (language === "tr" ? "Güncel" : "Up to date")
                : updateStatus === "error"
                ? (language === "tr" ? "Tekrar dene" : "Retry")
                : (language === "tr" ? "Güncelleme Kontrol Et" : "Check for Updates")}
            </ThemedText>
          </Pressable>
        </View>

        <View style={styles.descSection}>
          <ThemedText style={styles.description}>{t.description}</ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>{t.features}</ThemedText>
          <View style={styles.featureList}>
            <View style={styles.featureItem}>
              <Feather name="check" size={16} color={Colors.dark.success} />
              <ThemedText style={styles.featureText}>
                {t.noAccountRequired}
              </ThemedText>
            </View>
            <View style={styles.featureItem}>
              <Feather name="check" size={16} color={Colors.dark.success} />
              <ThemedText style={styles.featureText}>
                {t.e2eEncryption}
              </ThemedText>
            </View>
            <View style={styles.featureItem}>
              <Feather name="check" size={16} color={Colors.dark.success} />
              <ThemedText style={styles.featureText}>{t.p2pRelay}</ThemedText>
            </View>
            <View style={styles.featureItem}>
              <Feather name="check" size={16} color={Colors.dark.success} />
              <ThemedText style={styles.featureText}>
                {t.noLogServers}
              </ThemedText>
            </View>
            <View style={styles.featureItem}>
              <Feather name="check" size={16} color={Colors.dark.success} />
              <ThemedText style={styles.featureText}>
                {t.selfHostable}
              </ThemedText>
            </View>
            <View style={styles.featureItem}>
              <Feather name="check" size={16} color={Colors.dark.success} />
              <ThemedText style={styles.featureText}>{t.openSource}</ThemedText>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>{t.links}</ThemedText>
          <View style={styles.linksCard}>
            <LinkRow
              icon="github"
              title={t.sourceCode}
              url="https://github.com/boysplaydraw/ciphernode"
            />
            <LinkRow
              icon="file-text"
              title={t.license}
              url="https://www.gnu.org/licenses/gpl-3.0.html"
            />
            <LinkRow
              icon="book"
              title={t.documentation}
              url="https://github.com/boysplaydraw/ciphernode#readme"
            />
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Technology</ThemedText>
          <View style={styles.techCard}>
            <ThemedText style={styles.techItem}>React Native + Expo</ThemedText>
            <ThemedText style={styles.techItem}>OpenPGP.js (E2EE)</ThemedText>
            <ThemedText style={styles.techItem}>Socket.io (Relay)</ThemedText>
            <ThemedText style={styles.techItem}>WebRTC (P2P)</ThemedText>
          </View>
        </View>

        <ThemedText style={styles.copyright}>
          Made with privacy in mind
        </ThemedText>
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
  logoSection: {
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  logoContainer: {
    width: 96,
    height: 96,
    borderRadius: 24,
    backgroundColor: Colors.dark.backgroundSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  appName: {
    fontSize: 28,
    fontWeight: "700",
    color: Colors.dark.text,
  },
  version: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginTop: Spacing.xs,
  },
  updateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.dark.backgroundSecondary,
    minWidth: 140,
    justifyContent: "center",
  },
  updateBtnText: {
    fontSize: 12,
    color: Colors.dark.primary,
    fontWeight: "500",
  },
  descSection: {
    marginBottom: Spacing.xl,
  },
  description: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
    textAlign: "center",
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
  featureList: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  featureItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  featureText: {
    fontSize: 15,
    color: Colors.dark.text,
  },
  linksCard: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
    gap: Spacing.md,
  },
  linkRowPressed: {
    backgroundColor: Colors.dark.backgroundSecondary,
  },
  linkTitle: {
    flex: 1,
    fontSize: 16,
    color: Colors.dark.text,
  },
  techCard: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  techItem: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
  },
  copyright: {
    fontSize: 13,
    color: Colors.dark.textDisabled,
    textAlign: "center",
    marginTop: Spacing.xl,
  },
});
