import React, { useState, useRef } from "react";
import { View, StyleSheet, Pressable, Platform, Alert } from "react-native";
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
  const [imageScanning, setImageScanning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const t = {
    loadingCamera:
      language === "tr" ? "Kamera yukleniyor..." : "Loading camera...",
    cameraAccessRequired:
      language === "tr" ? "Kamera Erişimi Gerekli" : "Camera Access Required",
    enableCameraInSettings:
      language === "tr"
        ? "QR kodlari taramak icin Ayarlar'dan kamera erisimini etkinlestirin"
        : "Please enable camera access in Settings to scan QR codes",
    openSettings: language === "tr" ? "Ayarlari Ac" : "Open Settings",
    goBack: language === "tr" ? "Geri Don" : "Go Back",
    cameraPermission: language === "tr" ? "Kamera Izni" : "Camera Permission",
    needCameraAccess:
      language === "tr"
        ? "QR kodlari taramak icin kamera erisimi gerekiyor"
        : "We need camera access to scan QR codes",
    enableCamera: language === "tr" ? "Kamerayi Etkinlestir" : "Enable Camera",
    cancel: language === "tr" ? "Iptal" : "Cancel",
    useExpoGo: language === "tr" ? "Expo Go Kullanin" : "Use Expo Go",
    qrScanningBest:
      language === "tr"
        ? "QR tarama mobilde en iyi calisir. QR kodlari taramak icin bu uygulamayi Expo Go'da acin."
        : "QR scanning is best on mobile. Open this app in Expo Go to scan QR codes.",
    error: language === "tr" ? "Hata" : "Error",
    cannotAddSelf:
      language === "tr"
        ? "Kendinizi kisi olarak ekleyemezsiniz"
        : "You cannot add yourself as a contact",
    alreadyAdded: language === "tr" ? "Zaten Ekli" : "Already Added",
    alreadyAddedMsg:
      language === "tr"
        ? "Bu kisi zaten listenizde"
        : "This contact is already in your list",
    success: language === "tr" ? "Basarili" : "Success",
    contactAdded:
      language === "tr"
        ? "Kisi basariyla eklendi"
        : "Contact added successfully",
    ok: language === "tr" ? "Tamam" : "OK",
    invalidQR: language === "tr" ? "Gecersiz QR Kodu" : "Invalid QR Code",
    invalidQRMsg:
      language === "tr"
        ? "Bu QR kodu gecerli bir CipherNode kisisi degil"
        : "This QR code is not a valid CipherNode contact",
    scanQR: language === "tr" ? "QR Kod Tara" : "Scan QR Code",
    positionQR:
      language === "tr"
        ? "QR kodu cerceve icine yerlestirin"
        : "Position QR code within the frame",
    scanFromImage: language === "tr" ? "Resimden Tara" : "Scan from Image",
    scanFromImageHint:
      language === "tr"
        ? "Galeriden veya dosyadan QR kod içeren bir resim seçin"
        : "Select an image containing a QR code from your gallery or files",
    noQRFound:
      language === "tr"
        ? "QR Bulunamadı"
        : "No QR Code Found",
    noQRFoundMsg:
      language === "tr"
        ? "Seçilen resimde geçerli bir QR kod bulunamadı. Daha net bir resim deneyin."
        : "No valid QR code found in the selected image. Try a clearer image.",
    scanning: language === "tr" ? "Taranıyor..." : "Scanning...",
  };

  /** Web/Electron: Dosyadan QR kod tara */
  const handleImageQR = async (file: File) => {
    setImageScanning(true);
    try {
      const jsQR = (await import("jsqr")).default;
      const img = new Image();
      const url = URL.createObjectURL(file);

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      const result = jsQR(imageData.data, imageData.width, imageData.height);
      if (result?.data) {
        await handleBarCodeScanned({ data: result.data });
      } else {
        Alert.alert(t.noQRFound, t.noQRFoundMsg);
      }
    } catch {
      Alert.alert(t.error, t.noQRFoundMsg);
    } finally {
      setImageScanning(false);
    }
  };

  /** Web: Dosya seçiciyi aç */
  const openImagePicker = () => {
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) handleImageQR(file);
      };
      input.click();
    }
  };

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);

    try {
      const parsed = JSON.parse(data);
      if (!parsed.id) {
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
        publicKey: parsed.pk ?? parsed.publicKey ?? "",
        fingerprint: parsed.id.replace("-", "").padEnd(40, "0"),
        displayName: "",
        addedAt: Date.now(),
        ...(parsed.npk ? { nostrPubkey: parsed.npk } : {}),
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
              }),
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
        <Feather name="image" size={64} color={Colors.dark.primary} />
        <ThemedText style={styles.permissionTitle}>{t.scanFromImage}</ThemedText>
        <ThemedText style={styles.permissionText}>
          {t.scanFromImageHint}
        </ThemedText>
        <Pressable
          onPress={openImagePicker}
          disabled={imageScanning}
          style={({ pressed }) => [
            styles.permissionButton,
            pressed && styles.permissionButtonPressed,
            imageScanning && { opacity: 0.6 },
          ]}
        >
          <ThemedText style={styles.permissionButtonText}>
            {imageScanning ? t.scanning : t.scanFromImage}
          </ThemedText>
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
          <Feather
            name="camera-off"
            size={64}
            color={Colors.dark.textSecondary}
          />
          <ThemedText style={styles.permissionTitle}>
            {t.cameraAccessRequired}
          </ThemedText>
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
            <ThemedText style={styles.settingsButtonText}>
              {t.openSettings}
            </ThemedText>
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
        <ThemedText style={styles.permissionTitle}>
          {t.cameraPermission}
        </ThemedText>
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
          <ThemedText style={styles.permissionButtonText}>
            {t.enableCamera}
          </ThemedText>
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

        <ThemedText style={styles.hint}>{t.positionQR}</ThemedText>

        {/* Android: Galeriden QR içeren resim seç */}
        <Pressable
          onPress={async () => {
            try {
              // expo-camera CameraView ile kamera tarama zaten mevcut.
              // Galeri tarama için expo-camera'nın scanFromURLAsync metodunu kullan.
              const { Camera } = await import("expo-camera");
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore — expo-image-picker types optional
              const ImagePicker = await import("expo-image-picker");
              const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
              if (status !== "granted") return;

              const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images"],
                quality: 1,
              });
              if (result.canceled || !result.assets[0]) return;

              setImageScanning(true);
              try {
                // expo-camera'nın yerleşik QR tarama yeteneği
                const scanned = await (Camera as any).scanFromURLAsync(
                  result.assets[0].uri,
                  ["qr"],
                );
                if (scanned && scanned.length > 0) {
                  await handleBarCodeScanned({ data: scanned[0].data });
                } else {
                  Alert.alert(t.noQRFound, t.noQRFoundMsg);
                }
              } catch {
                Alert.alert(t.noQRFound, t.noQRFoundMsg);
              } finally {
                setImageScanning(false);
              }
            } catch {}
          }}
          disabled={imageScanning}
          style={({ pressed }) => [
            styles.galleryButton,
            pressed && { opacity: 0.7 },
            imageScanning && { opacity: 0.5 },
          ]}
        >
          <Feather name="image" size={20} color={Colors.dark.text} />
          <ThemedText style={styles.galleryButtonText}>
            {imageScanning ? t.scanning : t.scanFromImage}
          </ThemedText>
        </Pressable>
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
  galleryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  galleryButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.dark.text,
  },
});
