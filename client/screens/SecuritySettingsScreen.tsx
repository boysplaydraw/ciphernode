import React, { useState } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Fonts } from "@/constants/theme";
import { useIdentity } from "@/hooks/useIdentity";
import { clearAllData } from "@/lib/storage";
import { useLanguage } from "@/constants/language";

export default function SecuritySettingsScreen() {
  const navigation = useNavigation();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { identity, regenerate } = useIdentity();
  const { language } = useLanguage();

  const [showFingerprint, setShowFingerprint] = useState(false);

  const t = {
    encryptionStatus: language === "tr" ? "Şifreleme Durumu" : "Encryption Status",
    e2eEncrypted: language === "tr" ? "Uçtan Uca Şifreli" : "End-to-End Encrypted",
    allMessagesSecure: language === "tr" ? "Tüm mesajlar güvenli" : "All messages are secured",
    yourIdentity: language === "tr" ? "Kimliğiniz" : "Your Identity",
    yourId: language === "tr" ? "ID'niz" : "Your ID",
    fingerprint: language === "tr" ? "Parmak İzi" : "Fingerprint",
    showFingerprint: language === "tr" ? "Parmak İzini Göster" : "Show Fingerprint",
    hideFingerprint: language === "tr" ? "Parmak İzini Gizle" : "Hide Fingerprint",
    keyManagement: language === "tr" ? "Anahtar Yönetimi" : "Key Management",
    exportPublicKey: language === "tr" ? "Genel Anahtarı Dışa Aktar" : "Export Public Key",
    exportPublicKeyDesc: language === "tr" ? "Genel anahtarınızı panoya kopyalayın" : "Copy your public key to clipboard",
    regenerateKeys: language === "tr" ? "Anahtarları Yeniden Oluştur" : "Regenerate Keys",
    regenerateKeysDesc: language === "tr" ? "Yeni bir kimlik oluşturun (tüm veriler silinir)" : "Create a new identity (deletes all data)",
    copied: language === "tr" ? "Kopyalandı" : "Copied",
    publicKeyCopied: language === "tr" ? "Genel anahtarınız panoya kopyalandı" : "Your public key has been copied to clipboard",
    regenerateTitle: language === "tr" ? "Anahtarları Yeniden Oluştur" : "Regenerate Keys",
    regenerateWarning: language === "tr" 
      ? "Bu yeni bir kimlik oluşturacak ve tüm kişilerinizi ve mesajlarınızı silecek. Bu işlem geri alınamaz.\n\nDevam etmek istediğinizden emin misiniz?"
      : "This will create a new identity and delete all your contacts and messages. This action cannot be undone.\n\nAre you sure you want to continue?",
    cancel: language === "tr" ? "İptal" : "Cancel",
    regenerate: language === "tr" ? "Yeniden Oluştur" : "Regenerate",
    success: language === "tr" ? "Başarılı" : "Success",
    newIdentityGenerated: language === "tr" ? "Yeni kimlik oluşturuldu" : "New identity has been generated",
  };

  const handleExportPublicKey = async () => {
    if (identity?.publicKey) {
      await Clipboard.setStringAsync(identity.publicKey);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert(t.copied, t.publicKeyCopied);
    }
  };

  const handleRegenerateKeys = () => {
    Alert.alert(
      t.regenerateTitle,
      t.regenerateWarning,
      [
        { text: t.cancel, style: "cancel" },
        {
          text: t.regenerate,
          style: "destructive",
          onPress: async () => {
            await clearAllData();
            await regenerate();
            if (Platform.OS !== "web") {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
            Alert.alert(t.success, t.newIdentityGenerated);
          },
        },
      ]
    );
  };

  const formatFingerprint = (fp: string) => {
    return fp.replace(/(.{4})/g, "$1 ").trim();
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
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>{t.encryptionStatus}</ThemedText>
          <View style={styles.statusCard}>
            <View style={styles.statusHeader}>
              <View style={styles.statusIcon}>
                <Feather name="shield" size={24} color={Colors.dark.success} />
              </View>
              <View>
                <ThemedText style={styles.statusTitle}>{t.e2eEncrypted}</ThemedText>
                <ThemedText style={styles.statusSubtitle}>
                  AES-256 + RSA (OpenPGP)
                </ThemedText>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>{t.yourIdentity}</ThemedText>
          <View style={styles.keyCard}>
            <View style={styles.keyHeader}>
              <ThemedText style={styles.keyLabel}>{t.fingerprint}</ThemedText>
              <Pressable
                onPress={() => setShowFingerprint(!showFingerprint)}
                style={({ pressed }) => [
                  styles.expandButton,
                  pressed && styles.expandButtonPressed,
                ]}
              >
                <ThemedText style={styles.expandButtonText}>
                  {showFingerprint ? t.hideFingerprint : t.showFingerprint}
                </ThemedText>
              </Pressable>
            </View>
            {showFingerprint ? (
              <ThemedText style={styles.fingerprint}>
                {formatFingerprint(identity?.fingerprint || "")}
              </ThemedText>
            ) : null}

            <Pressable
              onPress={handleExportPublicKey}
              style={({ pressed }) => [
                styles.exportButton,
                pressed && styles.exportButtonPressed,
              ]}
            >
              <Feather name="copy" size={18} color={Colors.dark.primary} />
              <ThemedText style={styles.exportButtonText}>
                {t.exportPublicKey}
              </ThemedText>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>{t.keyManagement}</ThemedText>
          <View style={styles.dangerCard}>
            <ThemedText style={styles.dangerTitle}>{t.regenerateKeys}</ThemedText>
            <ThemedText style={styles.dangerText}>
              {t.regenerateKeysDesc}
            </ThemedText>
            <Pressable
              onPress={handleRegenerateKeys}
              style={({ pressed }) => [
                styles.dangerButton,
                pressed && styles.dangerButtonPressed,
              ]}
            >
              <Feather name="refresh-cw" size={18} color={Colors.dark.error} />
              <ThemedText style={styles.dangerButtonText}>
                {t.regenerateKeys}
              </ThemedText>
            </Pressable>
          </View>
        </View>

        <View style={styles.infoSection}>
          <Feather name="info" size={18} color={Colors.dark.secondary} />
          <ThemedText style={styles.infoText}>
            {language === "tr" 
              ? "Özel anahtarınız asla cihazınızdan ayrılmaz. Sadece siz size gönderilen mesajları deşifre edebilirsiniz."
              : "Your private key never leaves your device. Only you can decrypt messages sent to you."}
          </ThemedText>
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
    marginBottom: Spacing.md,
    marginLeft: Spacing.sm,
  },
  statusCard: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
  },
  statusHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.dark.success + "20",
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.success,
  },
  statusSubtitle: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  keyCard: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
  },
  keyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.md,
  },
  keyLabel: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
  },
  expandButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  expandButtonPressed: {
    opacity: 0.6,
  },
  expandButtonText: {
    fontSize: 14,
    color: Colors.dark.primary,
  },
  fingerprint: {
    fontSize: 12,
    fontFamily: Fonts?.mono,
    color: Colors.dark.text,
    backgroundColor: Colors.dark.backgroundSecondary,
    padding: Spacing.md,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.md,
  },
  exportButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
    gap: Spacing.sm,
  },
  exportButtonPressed: {
    opacity: 0.6,
  },
  exportButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.primary,
  },
  dangerCard: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.dark.error + "40",
  },
  dangerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.text,
    marginBottom: Spacing.sm,
  },
  dangerText: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginBottom: Spacing.lg,
  },
  dangerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: Colors.dark.error,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: Spacing.sm,
  },
  dangerButtonPressed: {
    backgroundColor: Colors.dark.error + "20",
  },
  dangerButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.error,
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
