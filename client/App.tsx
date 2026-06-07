import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  ActivityIndicator,
  AppState,
  AppStateStatus,
  Modal,
  Pressable,
  Alert,
  Platform,
} from "react-native";
import * as Updates from "expo-updates";
import { NavigationContainer } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { QueryClientProvider } from "@tanstack/react-query";
import {
  queryClient,
  loadCustomServerUrl,
  getApiUrl,
} from "@/lib/query-client";

import RootStackNavigator from "@/navigation/RootStackNavigator";
import OnboardingScreen from "@/screens/OnboardingScreen";
import CriticalErrorScreen from "@/screens/CriticalErrorScreen";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  hasCompletedOnboarding,
  getLanguage,
  getContacts,
  addContact,
  updateContact,
  saveMessage,
  pushContactsToServer,
  pullContactsFromServer,
} from "@/lib/storage";
import {
  getOrCreateIdentity,
  parsePublicKeyFingerprint,
} from "@/lib/crypto";
import { LanguageContext, type Language } from "@/constants/language";
import * as LocalAuthentication from "expo-local-authentication";
import * as ScreenCapture from "expo-screen-capture";
import { LowPowerProvider } from "@/constants/lowPower";
import { Colors } from "@/constants/theme";
import {
  initSocket,
  onUserOnline,
  onContactAdd,
  onMessage,
  setGhostMode,
  setStegMode,
  setP2POnlyMode,
} from "@/lib/socket";
import { getPrivacySettings } from "@/lib/storage";
import {
  isElectron,
} from "@/lib/electron-bridge";
import { initTauriBackend } from "@/lib/tauri-bridge";
import { hashPin, isValidPin } from "@/lib/app-lock";
import { recordCrash, recordStartupDiagnostics } from "@/lib/diagnostics";

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [language, setLanguageState] = useState<Language>("en");
  const [criticalError, setCriticalError] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pinHash, setPinHash] = useState("");
  const [pinSalt, setPinSalt] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const biometricUnlockRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    recordStartupDiagnostics("app component mounted");
    const errorUtils = (globalThis as any).ErrorUtils;
    const previousHandler = errorUtils?.getGlobalHandler?.();
    if (errorUtils?.setGlobalHandler) {
      errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
        recordCrash(error, isFatal ? "fatal" : "global");
        previousHandler?.(error, isFatal);
      });
    }
    initApp();

    // Bir kişi çevrimiçi olduğunda ve bizde public key yoksa güncelle
    const unsubUserOnline = onUserOnline(async ({ userId, publicKey }) => {
      if (!publicKey) return;
      const contacts = await getContacts();
      const contact = contacts.find((c) => c.id === userId);
      if (contact && !contact.publicKey) {
        await updateContact(userId, { publicKey });
        console.log(`[App] Public key synced for contact: ${userId}`);
      }
    });

    // Karşı taraf bizi kişi olarak eklediğinde otomatik karşılıklı ekleme.
    // Böylece eklenen kişi de bizi listesinde anında görür.
    const unsubContactAdd = onContactAdd(async ({ from, publicKey, nostrPubkey, displayName }) => {
      try {
        if (!from) return;
        const identity = await getOrCreateIdentity();
        if (from === identity.id) return;

        const contacts = await getContacts();
        const existing = contacts.find((c) => c.id === from);
        if (existing) {
          // Zaten ekli — sadece eksik public key'i tamamla
          if (!existing.publicKey && publicKey) {
            await updateContact(from, { publicKey });
          }
          return;
        }

        let resolvedKey = publicKey || "";
        if (!resolvedKey) {
          try {
            const apiUrl = getApiUrl();
            const res = await fetch(
              `${apiUrl}api/users/${encodeURIComponent(from)}/publickey`,
            );
            if (res.ok) {
              const data = await res.json();
              if (data.publicKey) resolvedKey = data.publicKey;
            }
          } catch {}
        }

        let fingerprint = from;
        if (resolvedKey) {
          try {
            fingerprint = await parsePublicKeyFingerprint(resolvedKey);
          } catch {}
        }

        await addContact({
          id: from,
          publicKey: resolvedKey,
          fingerprint,
          displayName: displayName || "",
          addedAt: Date.now(),
          ...(nostrPubkey ? { nostrPubkey } : {}),
        });
        console.log(`[App] Auto-added contact from incoming request: ${from}`);
      } catch {}
    });

    // Global mesaj handler — hangi ekranda olunursa olsun gelen mesajları kaydet
    const unsubMessage = onMessage(async (msg) => {
      try {
        const identity = await getOrCreateIdentity();
        await saveMessage(msg.from, {
          id: msg.id || `${msg.from}-${msg.timestamp}`,
          content: msg.encrypted,
          encrypted: msg.encrypted,
          senderId: msg.from,
          recipientId: identity.id,
          timestamp: msg.timestamp || Date.now(),
          status: "received",
        });
      } catch {}
    });

    // AppState — arka plandan öne gelince biyometrik kilit uygula
    // Storage'dan okuyarak stale state sorununu önle (ayarlar değişmiş olabilir)
    const handleAppStateChange = async (nextState: AppStateStatus) => {
      if (appState.current === "background" && nextState === "active") {
        const priv = await getPrivacySettings();
        const shouldUseBiometric =
          priv.biometricLock && Platform.OS !== "web" && !isElectron();
        const shouldUsePin =
          priv.appPinEnabled && !!priv.appPinHash && !!priv.appPinSalt;
        if (shouldUseBiometric || shouldUsePin) {
          setBiometricEnabled(shouldUseBiometric);
          setPinEnabled(shouldUsePin);
          setPinHash(priv.appPinHash);
          setPinSalt(priv.appPinSalt);
          setIsLocked(true);
        } else {
          setBiometricEnabled(false);
          setPinEnabled(false);
        }
      }
      appState.current = nextState;
    };
    const appStateSub = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );

    return () => {
      unsubUserOnline();
      unsubContactAdd();
      unsubMessage();
      appStateSub.remove();
      if (errorUtils?.setGlobalHandler && previousHandler) {
        errorUtils.setGlobalHandler(previousHandler);
      }
    };
  }, []);

  // Expo OTA güncelleme kontrolü (sadece production build'de çalışır)
  useEffect(() => {
    if (Platform.OS === "web") return;
    checkForOTAUpdate();
  }, []);

  const checkForOTAUpdate = async () => {
    try {
      if (!Updates.isEmbeddedLaunch && __DEV__) return;
      const update = await Updates.checkForUpdateAsync();
      if (!update.isAvailable) return;
      await Updates.fetchUpdateAsync();
      Alert.alert(
        "Güncelleme Hazır",
        "Yeni bir güncelleme indirildi. Uygulamayı yeniden başlatmak ister misiniz?",
        [
          { text: "Sonra", style: "cancel" },
          {
            text: "Yeniden Başlat",
            onPress: () => Updates.reloadAsync(),
          },
        ],
      );
    } catch {
      // Çevrimdışı veya dev modda — sessizce atla
    }
  };

  const initApp = async () => {
    try {
      recordStartupDiagnostics("initApp start");
      setIsLoading(true);
      setCriticalError(null);

      const savedLanguage = await getLanguage();
      setLanguageState(savedLanguage);

      // Kriptografik kimliği yükle / oluştur
      const identity = await getOrCreateIdentity();

      const completed = await hasCompletedOnboarding();
      await loadCustomServerUrl();
      // Tauri masaüstünde: paketlenmiş Go sidecar relay'ini keşfet ve bağlan
      // (kullanıcı kendi sunucusunu girmediyse). Socket bağlantısından önce olmalı.
      await initTauriBackend();
      recordStartupDiagnostics("settings loaded");
      setShowOnboarding(!completed);

      // Privacy mod başlangıç senkronizasyonu
      const priv = await getPrivacySettings();
      if (priv.ghostMode) setGhostMode(true);
      if (priv.steganographyMode) setStegMode(true);
      if (priv.p2pOnlyMode) setP2POnlyMode(true);

      // Ekran koruması — screenshot/kayıt engelle
      if (priv.screenProtection) {
        try {
          await ScreenCapture.preventScreenCaptureAsync();
        } catch {}
      }

      // App lock — biometric is native-mobile only; PIN works on all platforms.
      const shouldUseBiometric =
        priv.biometricLock && Platform.OS !== "web" && !isElectron();
      const shouldUsePin =
        priv.appPinEnabled && !!priv.appPinHash && !!priv.appPinSalt;
      if (shouldUseBiometric || shouldUsePin) {
        setBiometricEnabled(shouldUseBiometric);
        setPinEnabled(shouldUsePin);
        setPinHash(priv.appPinHash);
        setPinSalt(priv.appPinSalt);
        setIsLocked(true);
      }

      // Onboarding tamamlandıysa hemen sunucuya bağlan
      if (completed) {
        recordStartupDiagnostics("connecting relay");
        connectToServer(identity.id, identity.publicKey);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[App] Identity init failed:", msg);
      recordCrash(error, "initApp");
      setCriticalError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  /** Sunucuya bağlan ve arka plan görevlerini başlat */
  const connectToServer = (userId: string, publicKey: string) => {
    initSocket(userId, publicKey)
      .then(() => {
        // Bağlantı kuruldu, public key eksik kişileri ve kişi listesini senkronize et
        syncMissingPublicKeys();
        syncContacts(userId);
      })
      .catch((err) => {
        console.warn(
          "[App] Socket connection failed (will retry on reconnect):",
          err?.message,
        );
      });
  };

  /** Kişileri sunucuyla senkronize et — aynı kimlik farklı cihazda kullanılıyorsa birleşir */
  const syncContacts = async (userId: string) => {
    try {
      const apiUrl = getApiUrl();
      // Önce sunucudan çek (diğer cihazdan eklenmiş kişiler gelsin)
      await pullContactsFromServer(userId, apiUrl);
      // Sonra yerel kişileri sunucuya gönder
      await pushContactsToServer(userId, apiUrl);
    } catch {
      // Çevrimdışıysa sessizce atla
    }
  };

  /** Kayıtlı kişilerde public key eksikse sunucudan toplu çek */
  const syncMissingPublicKeys = async () => {
    try {
      const contacts = await getContacts();
      const missing = contacts.filter((c) => !c.publicKey);
      if (missing.length === 0) return;

      const apiUrl = getApiUrl();
      await Promise.allSettled(
        missing.map(async (contact) => {
          try {
            const res = await fetch(
              `${apiUrl}api/users/${encodeURIComponent(contact.id)}/publickey`,
            );
            if (res.ok) {
              const data = await res.json();
              if (data.publicKey) {
                await updateContact(contact.id, { publicKey: data.publicKey });
                console.log(`[App] Synced public key for: ${contact.id}`);
              }
            }
          } catch {
            // Çevrimdışı veya kayıtsız — user:online eventi gelince güncellenir
          }
        }),
      );
    } catch {
      // Sessizce başarısız — kritik değil
    }
  };

  const handleBiometricUnlock = useCallback(async () => {
    try {
      if (Platform.OS !== "web" && !isElectron()) {
        const promptMessage =
          language === "tr"
            ? "CipherNode'u açmak için doğrulayın"
            : "Authenticate to open CipherNode";

        // SecurityLevel: 0=none, 1=PIN/password, 2=biometric(weak), 3=biometric(strong)
        const level = await LocalAuthentication.getEnrolledLevelAsync();
        if (level === 0) {
          // Cihazda herhangi bir kilit yok — doğrudan aç
          setIsLocked(false);
          return;
        }

        const result = await LocalAuthentication.authenticateAsync({
          promptMessage,
          fallbackLabel: language === "tr" ? "PIN / Şifre" : "PIN / Password",
          cancelLabel: language === "tr" ? "İptal" : "Cancel",
          // false = biyometrik başarısız olursa cihaz PIN/şifresine düş
          disableDeviceFallback: false,
        });
        if (result.success) setIsLocked(false);
      }
    } catch {}
  }, [language]);

  const handlePinUnlock = useCallback(async () => {
    if (!isValidPin(pinInput) || !pinHash || !pinSalt) {
      setPinError(language === "tr" ? "Geçersiz PIN" : "Invalid PIN");
      return;
    }

    const candidate = await hashPin(pinInput, pinSalt);
    if (candidate === pinHash) {
      setPinInput("");
      setPinError("");
      setIsLocked(false);
      return;
    }

    setPinError(language === "tr" ? "PIN hatalı" : "Incorrect PIN");
  }, [language, pinHash, pinInput, pinSalt]);

  // Ref'i güncel tut — isLocked effect'i döngüye girmeden handler'ı çağırabilsin
  biometricUnlockRef.current = handleBiometricUnlock;

  // Kilit ekranı görünür hale gelince biyometrik diyaloğu otomatik tetikle.
  // isLoading=true iken Modal render edilmediğinden, yükleme bitip ekran
  // görünür olana kadar bekliyoruz. Arka plandan dönüşlerde isLoading
  // zaten false olduğundan anında tetiklenir.
  useEffect(() => {
    if (
      isLoading ||
      !isLocked ||
      showOnboarding ||
      criticalError ||
      !biometricEnabled
    )
      return;
    const timer = setTimeout(() => biometricUnlockRef.current?.(), 500);
    return () => clearTimeout(timer);
  }, [biometricEnabled, isLoading, isLocked, showOnboarding, criticalError]);

  const handleSetLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
    // Onboarding bitti, şimdi sunucuya bağlan
    getOrCreateIdentity()
      .then((identity) => connectToServer(identity.id, identity.publicKey))
      .catch(() => {});
  }, []);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
      </View>
    );
  }

  return (
    <ErrorBoundary onError={(error, stack) => recordCrash(error, stack)}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <GestureHandlerRootView style={styles.root}>
            <KeyboardProvider>
              <LanguageContext.Provider
                value={{ language, setLanguage: handleSetLanguage }}
              >
                <LowPowerProvider>
                  {criticalError ? (
                    <CriticalErrorScreen
                      error={criticalError}
                      onRetry={initApp}
                    />
                  ) : showOnboarding ? (
                    <OnboardingScreen onComplete={handleOnboardingComplete} />
                  ) : (
                    <NavigationContainer>
                      <RootStackNavigator />
                    </NavigationContainer>
                  )}
                  <StatusBar style="light" />

                  {/* Biyometrik Kilit Ekranı */}
                  <Modal
                    visible={isLocked && !showOnboarding && !criticalError}
                    animationType="fade"
                    transparent={false}
                    statusBarTranslucent
                  >
                    <View style={styles.lockScreen}>
                      <Text style={styles.lockAppName}>CipherNode</Text>
                      <Text style={styles.lockPrompt}>
                        {language === "tr"
                          ? pinEnabled
                            ? "Devam etmek için PIN girin"
                            : "Devam etmek için kimliğinizi doğrulayın"
                          : pinEnabled
                            ? "Enter PIN to continue"
                            : "Authenticate to continue"}
                      </Text>
                      {pinEnabled ? (
                        <>
                          <TextInput
                            value={pinInput}
                            onChangeText={(value) => {
                              setPinInput(value.replace(/\D/g, "").slice(0, 8));
                              setPinError("");
                            }}
                            keyboardType="number-pad"
                            secureTextEntry
                            placeholder="PIN"
                            placeholderTextColor={Colors.dark.textDisabled}
                            style={styles.pinInput}
                            onSubmitEditing={handlePinUnlock}
                          />
                          {pinError ? (
                            <Text style={styles.pinError}>{pinError}</Text>
                          ) : null}
                          <Pressable
                            onPress={handlePinUnlock}
                            style={({ pressed }) => [
                              styles.unlockButton,
                              pressed && styles.unlockButtonPressed,
                            ]}
                          >
                            <Text style={styles.unlockButtonText}>
                              {language === "tr" ? "Kilidi Aç" : "Unlock"}
                            </Text>
                          </Pressable>
                        </>
                      ) : (
                        <Pressable
                          onPress={handleBiometricUnlock}
                          style={({ pressed }) => [
                            styles.unlockButton,
                            pressed && styles.unlockButtonPressed,
                          ]}
                        >
                          <Text style={styles.unlockButtonText}>
                            {language === "tr" ? "Kilidi Aç" : "Unlock"}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </Modal>
                </LowPowerProvider>
              </LanguageContext.Provider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </SafeAreaProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.dark.backgroundRoot,
  },
  lockScreen: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  lockAppName: {
    fontSize: 32,
    fontWeight: "700",
    color: Colors.dark.primary,
    marginBottom: 12,
    letterSpacing: 1,
  },
  lockPrompt: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    marginBottom: 48,
  },
  unlockButton: {
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
  },
  unlockButtonPressed: {
    opacity: 0.75,
  },
  unlockButtonText: {
    color: "#000",
    fontSize: 16,
    fontWeight: "600",
  },
  pinInput: {
    width: 220,
    backgroundColor: Colors.dark.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    borderRadius: 10,
    color: Colors.dark.text,
    fontSize: 22,
    letterSpacing: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    textAlign: "center",
    marginBottom: 12,
  },
  pinError: {
    color: Colors.dark.error,
    fontSize: 13,
    marginBottom: 16,
  },
});
