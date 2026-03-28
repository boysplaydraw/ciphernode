import React, { useState } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Platform,
  Alert,
} from "react-native";
import { useNavigation, CommonActions } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { addContact, getContacts } from "@/lib/storage";
import { useIdentity } from "@/hooks/useIdentity";
import { useLanguage } from "@/constants/language";

export default function QRScannerScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { identity } = useIdentity();
  const { language } = useLanguage();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  const t = {
    loadingCamera: language === "tr" ? "Kamera yukleniyor..." : "Loading camera...",
    cameraAccessRequired: language === "tr" ? "Kamera Erişimi Gerekli" : "Camera Access Required",
    enableCameraInSettings: language === "tr" 
      ? "QR kodlari taramak icin Ayarlar'dan kamera erisimini etkinlestirin"
      : "Please enable camera access in Settings to scan QR codes",
    openSettings: language === "tr" ? "Ayarlari Ac" : "Open Settings",
    goBack: language === "tr" ? "Geri Don" : "Go Back",
    cameraPermission: language === "tr" ? "Kamera Izni" : "Camera Permission",
    needCameraAccess: language === "tr" 
      ? "QR kodlari taramak icin kamera erisimi gerekiyor"
      : "We need camera access to scan QR codes",
    enableCamera: language === "tr" ? "Kamerayi Etkinlestir" : "Enable Camera",
    cancel: language === "tr" ? "Iptal" : "Cancel",
    useExpoGo: language === "tr" ? "Expo Go Kullanin" : "Use Expo Go",
    qrScanningBest: language === "tr" 
      ? "QR tarama mobilde en iyi calisir. QR kodlari taramak icin bu uygulamayi Expo Go'da acin."
      : "QR scanning is best on mobile. Open this app in Expo Go to scan QR codes.",
    error: language === "tr" ? "Hata" : "Error",
    cannotAddSelf: language === "tr" ? "Kendinizi kisi olarak ekleyemezsiniz" : "You cannot add yourself as a contact",
    alreadyAdded: language === "tr" ? "Zaten Ekli" : "Already Added",
    alreadyAddedMsg: language === "tr" ? "Bu kisi zaten listenizde" : "This contact is already in your list",
    success: language === "tr" ? "Basarili" : "Success",
    contactAdded: language === "tr" ? "Kisi basariyla eklendi" : "Contact added successfully",
    ok: language === "tr" ? "Tamam" : "OK",
    invalidQR: language === "tr" ? "Gecersiz QR Kodu" : "Invalid QR Code",
    invalidQRMsg: language === "tr" 
      ? "Bu QR kodu gecerli bir CipherNode kisisi degil"
      : "This QR code is not a valid CipherNode contact",
    scanQR: language === "tr" ? "QR Kod Tara" : "Scan QR Code",
    positionQR: language === "tr" 
      ? "QR kodu cerceve icine yerlestirin"
      : "Position QR code within the frame",
  };

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);

    try {
      const parsed = JSON.parse(data);
      if (!parsed.id || !parsed.publicKey) {
        throw new Error("Invalid QR code");
      }

      if (parsed.id === identity?.id) {
        Alert.alert(t.error, t.cannotAddSelf);
        setScanned(false);
        return;
      }

      const contacts = await getContacts();
      if (contacts.some((c) => c.id === parsed.id)) {
        Alert.alert(t.alreadyAdded, t.alreadyAddedMsg);
        navigation.goBack();
        return;
      }

      await addContact({
        id: parsed.id,
        publicKey: parsed.publicKey,
        fingerprint: parsed.id.replace("-", "").padEnd(40, "0"),
        displayName: "",
        addedAt: Date.now(),
      });

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      Alert.alert(t.success, t.contactAdded, [
        {
          text: t.ok,
          onPress: () => {
            navigation.dispatch(
              CommonActions.navigate({
                name: "ChatsTab",
                params: {
                  screen: "ChatThread",
                  params: { contactId: parsed.id },
                },
              })
            );
          },
        },
      ]);
    } catch (error) {
      Alert.alert(t.invalidQR, t.invalidQRMsg, [
        { text: t.ok, onPress: () => setScanned(false) },
      ]);
    }
  };

  if (Platform.OS === "web") {
    return (
      <ThemedView style={[styles.container, styles.permissionContainer]}>
        <Feather name="smartphone" size={64} color={Colors.dark.primary} />
        <ThemedText style={styles.permissionTitle}>{t.useExpoGo}</ThemedText>
        <ThemedText style={styles.permissionText}>
          {t.qrScanningBest}
        </ThemedText>
        <Pressable
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [
            styles.closeButton,
            pressed && styles.closeButtonPressed,
          ]}
        >
          <ThemedText style={styles.closeButtonText}>{t.goBack}</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  if (!permission) {
    return (
      <ThemedView style={[styles.container, styles.permissionContainer]}>
        <ThemedText>{t.loadingCamera}</ThemedText>
      </ThemedView>
    );
  }

  if (!permission.granted) {
    if (permission.status === "denied" && !permission.canAskAgain) {
      return (
        <ThemedView style={[styles.container, styles.permissionContainer]}>
          <Feather name="camera-off" size={64} color={Colors.dark.textSecondary} />
          <ThemedText style={styles.permissionTitle}>{t.cameraAccessRequired}</ThemedText>
          <ThemedText style={styles.permissionText}>
            {t.enableCameraInSettings}
          </ThemedText>
          <Pressable
            onPress={async () => {
              try {
                await Linking.openSettings();
              } catch (error) {
                console.error("Could not open settings");
              }
            }}
            style={({ pressed }) => [
              styles.settingsButton,
              pressed && styles.settingsButtonPressed,
            ]}
          >
            <ThemedText style={styles.settingsButtonText}>{t.openSettings}</ThemedText>
          </Pressable>
          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [
              styles.closeButton,
              pressed && styles.closeButtonPressed,
            ]}
          >
            <ThemedText style={styles.closeButtonText}>{t.goBack}</ThemedText>
          </Pressable>
        </ThemedView>
      );
    }

    return (
      <ThemedView style={[styles.container, styles.permissionContainer]}>
        <Feather name="camera" size={64} color={Colors.dark.primary} />
        <ThemedText style={styles.permissionTitle}>{t.cameraPermission}</ThemedText>
        <ThemedText style={styles.permissionText}>
          {t.needCameraAccess}
        </ThemedText>
        <Pressable
          onPress={requestPermission}
          style={({ pressed }) => [
            styles.permissionButton,
            pressed && styles.permissionButtonPressed,
          ]}
        >
          <ThemedText style={styles.permissionButtonText}>{t.enableCamera}</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [
            styles.closeButton,
            pressed && styles.closeButtonPressed,
          ]}
        >
          <ThemedText style={styles.closeButtonText}>{t.cancel}</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />

      <View style={[styles.overlay, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.backButtonPressed,
            ]}
          >
            <Feather name="x" size={24} color={Colors.dark.text} />
          </Pressable>
          <ThemedText style={styles.title}>{t.scanQR}</ThemedText>
          <View style={styles.placeholder} />
        </View>

        <View style={styles.scanArea}>
          <View style={styles.corner} />
          <View style={[styles.corner, styles.cornerTopRight]} />
          <View style={[styles.corner, styles.cornerBottomLeft]} />
          <View style={[styles.corner, styles.cornerBottomRight]} />
        </View>

        <ThemedText style={styles.hint}>
          {t.positionQR}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
  permissionContainer: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing["3xl"],
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: "600",
    color: Colors.dark.text,
    marginTop: Spacing.xl,
    marginBottom: Spacing.md,
  },
  permissionText: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  permissionButton: {
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: Spacing["3xl"],
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.lg,
  },
  permissionButtonPressed: {
    opacity: 0.8,
  },
  permissionButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.buttonText,
  },
  settingsButton: {
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: Spacing["3xl"],
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.lg,
  },
  settingsButtonPressed: {
    opacity: 0.8,
  },
  settingsButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.buttonText,
  },
  closeButton: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  closeButtonPressed: {
    opacity: 0.6,
  },
  closeButtonText: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: Spacing["5xl"],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  backButtonPressed: {
    opacity: 0.7,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: Colors.dark.text,
  },
  placeholder: {
    width: 44,
  },
  scanArea: {
    width: 250,
    height: 250,
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: 40,
    height: 40,
    borderColor: Colors.dark.primary,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    top: 0,
    left: 0,
  },
  cornerTopRight: {
    top: 0,
    left: undefined,
    right: 0,
    borderLeftWidth: 0,
    borderRightWidth: 4,
  },
  cornerBottomLeft: {
    top: undefined,
    bottom: 0,
    borderTopWidth: 0,
    borderBottomWidth: 4,
  },
  cornerBottomRight: {
    top: undefined,
    left: undefined,
    bottom: 0,
    right: 0,
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  hint: {
    fontSize: 16,
    color: Colors.dark.text,
    textAlign: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
});
