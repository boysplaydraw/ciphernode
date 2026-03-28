import React, { useState, useEffect, useCallback } from "react";
import { StyleSheet, View, ActivityIndicator } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient, loadCustomServerUrl, getApiUrl } from "@/lib/query-client";

import RootStackNavigator from "@/navigation/RootStackNavigator";
import OnboardingScreen from "@/screens/OnboardingScreen";
import CriticalErrorScreen from "@/screens/CriticalErrorScreen";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { hasCompletedOnboarding, getLanguage, getContacts, updateContact } from "@/lib/storage";
import { getOrCreateIdentity } from "@/lib/crypto";
import { LanguageContext, type Language } from "@/constants/language";
import { LowPowerProvider } from "@/constants/lowPower";
import { Colors } from "@/constants/theme";
import { onUserOnline, setGhostMode } from "@/lib/socket";
import { getPrivacySettings } from "@/lib/storage";

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [language, setLanguageState] = useState<Language>("tr");
  const [criticalError, setCriticalError] = useState<string | null>(null);

  useEffect(() => {
    initApp();

    // Bir kişi çevrimiçi olduğunda ve bizde public key yoksa güncelle
    const unsubUserOnline = onUserOnline(async ({ userId, publicKey }) => {
      if (!publicKey) return;
      const contacts = await getContacts();
      const contact = contacts.find(c => c.id === userId);
      if (contact && !contact.publicKey) {
        await updateContact(userId, { publicKey });
        console.log(`[App] Public key synced for contact: ${userId}`);
      }
    });

    return () => {
      unsubUserOnline();
    };
  }, []);

  const initApp = async () => {
    try {
      setIsLoading(true);
      setCriticalError(null);

      const savedLanguage = await getLanguage();
      setLanguageState(savedLanguage);

      // Kriptografik kimliğin oluşturulabildiğini başlangıçta doğrula
      await getOrCreateIdentity();

      const completed = await hasCompletedOnboarding();
      await loadCustomServerUrl();
      setShowOnboarding(!completed);

      // Arka planda: public key'i olmayan kişiler için sunucudan key çek
      syncMissingPublicKeys();

      // Ghost mode başlangıç senkronizasyonu
      getPrivacySettings().then((priv) => {
        if (priv.ghostMode) setGhostMode(true);
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[App] Identity init failed:", msg);
      setCriticalError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  /** Kayıtlı kişilerde public key eksikse sunucudan toplu çek */
  const syncMissingPublicKeys = async () => {
    try {
      const contacts = await getContacts();
      const missing = contacts.filter(c => !c.publicKey);
      if (missing.length === 0) return;

      const apiUrl = getApiUrl();
      await Promise.allSettled(
        missing.map(async (contact) => {
          try {
            const res = await fetch(`${apiUrl}api/users/${encodeURIComponent(contact.id)}/publickey`);
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
        })
      );
    } catch {
      // Sessizce başarısız — kritik değil
    }
  };

  const handleSetLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
  }, []);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <GestureHandlerRootView style={styles.root}>
            <KeyboardProvider>
              <LanguageContext.Provider value={{ language, setLanguage: handleSetLanguage }}>
                <LowPowerProvider>
                  {criticalError ? (
                    <CriticalErrorScreen error={criticalError} onRetry={initApp} />
                  ) : showOnboarding ? (
                    <OnboardingScreen onComplete={handleOnboardingComplete} />
                  ) : (
                    <NavigationContainer>
                      <RootStackNavigator />
                    </NavigationContainer>
                  )}
                  <StatusBar style="light" />
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
});
