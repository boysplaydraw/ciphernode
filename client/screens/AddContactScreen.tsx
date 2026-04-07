import React, { useState, useCallback } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
} from "react-native";
import { useNavigation, CommonActions } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import QRCode from "react-native-qrcode-svg";
import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius, Fonts } from "@/constants/theme";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { parseContactId } from "@/lib/crypto";
import {
  addContact,
  getContacts,
  updateContact,
  pushContactsToServer,
} from "@/lib/storage";
import { useIdentity } from "@/hooks/useIdentity";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { useLanguage } from "@/constants/language";
import { getApiUrl } from "@/lib/query-client";

import { lookupUserPublicKey } from "@/lib/socket";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function AddContactScreen() {
  const navigation = useNavigation<NavigationProp>();
  const insets = useSafeAreaInsets();
  const { identity, loading } = useIdentity();
  const { language } = useLanguage();

  const [contactIdInput, setContactIdInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const t = {
    scanQR: language === "tr" ? "QR Kod Tara" : "Scan QR Code",
    scanQRSubtext:
      language === "tr"
        ? "Eklemek için kişinin QR kodunu tarayın"
        : "Scan a contact's QR code to add them",
    or: language === "tr" ? "VEYA" : "OR",
    enterContactId: language === "tr" ? "Kişi ID'si Girin" : "Enter Contact ID",
    addContact: language === "tr" ? "Kişi Ekle" : "Add Contact",
    adding: language === "tr" ? "Ekleniyor..." : "Adding...",
    shareYourId: language === "tr" ? "ID'nizi Paylaşın" : "Share Your ID",
    othersCanScan:
      language === "tr"
        ? "Diğerleri sizi eklemek için bunu tarayabilir"
        : "Others can scan this to add you",
    copied: language === "tr" ? "Kopyalandı" : "Copied",
    copiedToClipboard:
      language === "tr"
        ? "ID'niz panoya kopyalandı"
        : "Your ID has been copied to clipboard",
    invalidId: language === "tr" ? "Geçersiz ID" : "Invalid ID",
    invalidIdMsg:
      language === "tr"
        ? "Geçerli bir kişi ID'si girin (format: XXXX-XXXX)"
        : "Please enter a valid contact ID (format: XXXX-XXXX)",
    error: language === "tr" ? "Hata" : "Error",
    cannotAddSelf:
      language === "tr"
        ? "Kendinizi kişi olarak ekleyemezsiniz"
        : "You cannot add yourself as a contact",
    alreadyAdded: language === "tr" ? "Zaten Ekli" : "Already Added",
    alreadyAddedMsg:
      language === "tr"
        ? "Bu kişi zaten listenizde"
        : "This contact is already in your list",
    success: language === "tr" ? "Başarılı" : "Success",
    contactAdded:
      language === "tr"
        ? "Kişi başarıyla eklendi"
        : "Contact added successfully",
    failedToAdd:
      language === "tr" ? "Kişi eklenemedi" : "Failed to add contact",
    generatingIdentity:
      language === "tr" ? "Kimlik oluşturuluyor..." : "Generating identity...",
  };

  const handleScanQR = () => {
    navigation.navigate("QRScanner");
  };

  const copyOwnId = async () => {
    if (identity?.id) {
      await Clipboard.setStringAsync(identity.id);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert(t.copied, t.copiedToClipboard);
    }
  };

  const handleAddContact = useCallback(async () => {
    const parsedId = parseContactId(contactIdInput);
    if (!parsedId) {
      Alert.alert(t.invalidId, t.invalidIdMsg);
      return;
    }

    if (parsedId === identity?.id) {
      Alert.alert(t.error, t.cannotAddSelf);
      return;
    }

    const contacts = await getContacts();
    if (contacts.some((c) => c.id === parsedId)) {
      Alert.alert(t.alreadyAdded, t.alreadyAddedMsg);
      return;
    }

    setIsAdding(true);
    try {
      // 1. Önce sunucudan public key'i çek (REST API)
      let publicKey = "";
      let keySource = "none";

      try {
        const apiUrl = getApiUrl();
        const res = await fetch(
          `${apiUrl}api/users/${encodeURIComponent(parsedId)}/publickey`,
        );
        if (res.ok) {
          const data = await res.json();
          if (data.publicKey) {
            publicKey = data.publicKey;
            keySource = "api";
          }
        }
      } catch {
        // REST API başarısız olduysa socket ile dene
      }

      // 2. REST başarısız olduysa socket üzerinden gerçek zamanlı sorgula
      if (!publicKey) {
        const socketKey = await lookupUserPublicKey(parsedId);
        if (socketKey) {
          publicKey = socketKey;
          keySource = "socket";
        }
      }

      // 3. Fingerprint: public key varsa gerçek fingerprint hesapla, yoksa ID kullan
      let fingerprint = parsedId;
      if (publicKey) {
        try {
          const { parseContactId: _p, ...cryptoModule } =
            await import("@/lib/crypto");
          // @ts-ignore — parsePublicKeyFingerprint opsiyonel
          const { parsePublicKeyFingerprint } = cryptoModule;
          if (typeof parsePublicKeyFingerprint === "function") {
            fingerprint = await parsePublicKeyFingerprint(publicKey);
          }
        } catch {
          // fingerprint hesaplanamadı, ID kullan
        }
      }

      // Kişiyi kaydet (public key bulunduysa şifreli mesajlaşma hemen çalışır)
      await addContact({
        id: parsedId,
        publicKey,
        fingerprint,
        displayName: "",
        addedAt: Date.now(),
      });

      // Kişi listesini diğer cihazlarla senkronize et
      if (identity?.id) {
        try {
          await pushContactsToServer(identity.id, getApiUrl());
        } catch {}
      }

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setContactIdInput("");

      // 4. Kullanıcıya durumu bildir
      const successMsg = publicKey
        ? language === "tr"
          ? "Kişi eklendi. Açık anahtar alındı, mesajlar şifreli gönderilecek."
          : "Contact added. Public key received, messages will be encrypted."
        : language === "tr"
          ? "Kişi eklendi. Açık anahtar henüz yok — kişi ilk kez uygulamaya bağlandığında otomatik senkronize edilecek."
          : "Contact added. No public key yet — it will sync automatically when they first connect.";

      Alert.alert(t.success, successMsg, [
        {
          text: "OK",
          onPress: () => {
            (navigation as any).navigate("Main", {
              screen: "ChatsTab",
              params: {
                screen: "ChatThread",
                params: { contactId: parsedId },
              },
            });
          },
        },
      ]);
    } catch (error) {
      Alert.alert(t.error, t.failedToAdd);
    } finally {
      setIsAdding(false);
    }
  }, [contactIdInput, identity, t, navigation]);

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ThemedText style={styles.loadingText}>
          {t.generatingIdentity}
        </ThemedText>
      </View>
    );
  }

  return (
    <KeyboardAwareScrollViewCompat
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: Spacing.xl,
          paddingBottom: insets.bottom + Spacing.xl,
        },
      ]}
    >
      {/* QR kod tarama — yalnızca Android'de göster */}
      {Platform.OS === "android" && (
        <>
          <Pressable
            onPress={handleScanQR}
            style={({ pressed }) => [
              styles.scanButton,
              pressed && styles.scanButtonPressed,
            ]}
          >
            <View style={styles.scanIconContainer}>
              <Feather name="camera" size={32} color={Colors.dark.primary} />
            </View>
            <ThemedText style={styles.scanButtonText}>{t.scanQR}</ThemedText>
            <ThemedText style={styles.scanButtonSubtext}>
              {t.scanQRSubtext}
            </ThemedText>
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <ThemedText style={styles.dividerText}>{t.or}</ThemedText>
            <View style={styles.dividerLine} />
          </View>
        </>
      )}

      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>{t.enterContactId}</ThemedText>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={contactIdInput}
            onChangeText={setContactIdInput}
            placeholder="XXXX-XXXX"
            placeholderTextColor={Colors.dark.textDisabled}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={9}
          />
        </View>
        <Pressable
          onPress={handleAddContact}
          disabled={!contactIdInput.trim() || isAdding}
          style={({ pressed }) => [
            styles.addButton,
            (!contactIdInput.trim() || isAdding) && styles.addButtonDisabled,
            pressed && styles.addButtonPressed,
          ]}
        >
          <ThemedText
            style={[
              styles.addButtonText,
              (!contactIdInput.trim() || isAdding) &&
                styles.addButtonTextDisabled,
            ]}
          >
            {isAdding ? t.adding : t.addContact}
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>{t.shareYourId}</ThemedText>
        <View style={styles.shareSection}>
          <Pressable
            onPress={copyOwnId}
            style={({ pressed }) => [
              styles.idDisplay,
              pressed && styles.idDisplayPressed,
            ]}
          >
            <ThemedText style={styles.idText}>
              {identity?.id || "..."}
            </ThemedText>
            <Feather name="copy" size={18} color={Colors.dark.textSecondary} />
          </Pressable>

          <View style={styles.qrContainer}>
            {identity?.id ? (
              <QRCode
                value={JSON.stringify({
                  id: identity.id,
                })}
                size={180}
                backgroundColor={Colors.dark.backgroundSecondary}
                color={Colors.dark.text}
              />
            ) : null}
          </View>
          <ThemedText style={styles.qrHint}>{t.othersCanScan}</ThemedText>
        </View>
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
  loadingContainer: {
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
  },
  scanButton: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.md,
    padding: Spacing.xl,
    alignItems: "center",
    borderWidth: 2,
    borderColor: Colors.dark.primary,
    borderStyle: "dashed",
  },
  scanButtonPressed: {
    backgroundColor: Colors.dark.backgroundTertiary,
  },
  scanIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.dark.backgroundTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  scanButtonText: {
    fontSize: 18,
    fontWeight: "600",
    color: Colors.dark.text,
    marginBottom: Spacing.xs,
  },
  scanButtonSubtext: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: Spacing.xl,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.dark.border,
  },
  dividerText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.dark.textSecondary,
    marginHorizontal: Spacing.lg,
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
  },
  inputContainer: {
    marginBottom: Spacing.md,
  },
  input: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: 20,
    fontFamily: Fonts?.mono,
    color: Colors.dark.text,
    textAlign: "center",
    borderWidth: 1,
    borderColor: Colors.dark.border,
    letterSpacing: 2,
  },
  addButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.md,
    alignItems: "center",
  },
  addButtonDisabled: {
    backgroundColor: Colors.dark.backgroundSecondary,
  },
  addButtonPressed: {
    opacity: 0.8,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.buttonText,
  },
  addButtonTextDisabled: {
    color: Colors.dark.textDisabled,
  },
  shareSection: {
    alignItems: "center",
  },
  idDisplay: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    width: "100%",
    justifyContent: "space-between",
    marginBottom: Spacing.xl,
  },
  idDisplayPressed: {
    backgroundColor: Colors.dark.backgroundTertiary,
  },
  idText: {
    fontSize: 24,
    fontFamily: Fonts?.mono,
    fontWeight: "700",
    color: Colors.dark.primary,
    letterSpacing: 2,
  },
  qrContainer: {
    padding: Spacing.lg,
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
  },
  qrHint: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
  },
});
