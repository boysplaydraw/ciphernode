import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { useLanguage } from "@/constants/language";

interface CriticalErrorScreenProps {
  error?: string;
  onRetry: () => void;
}

export default function CriticalErrorScreen({
  error,
  onRetry,
}: CriticalErrorScreenProps) {
  const { language } = useLanguage();
  const isTr = language === "tr";

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Feather name="alert-triangle" size={64} color={Colors.dark.error} />
        </View>

        <ThemedText style={styles.title}>
          {isTr ? "Kritik Hata" : "Critical Error"}
        </ThemedText>

        <ThemedText style={styles.description}>
          {isTr
            ? "Şifreli kimliğiniz oluşturulamadı. Uygulama güvenli mesajlaşma için kriptografik anahtarlara ihtiyaç duyar."
            : "Your encrypted identity could not be created. The app requires cryptographic keys for secure messaging."}
        </ThemedText>

        {error ? (
          <View style={styles.errorBox}>
            <ThemedText style={styles.errorText} numberOfLines={3}>
              {error}
            </ThemedText>
          </View>
        ) : null}

        <ThemedText style={styles.hint}>
          {isTr
            ? "Lütfen cihazınızda yeterli depolama alanı olduğundan emin olun ve tekrar deneyin."
            : "Please make sure your device has sufficient storage and try again."}
        </ThemedText>

        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retryButton,
            pressed && styles.retryButtonPressed,
          ]}
        >
          <Feather
            name="refresh-cw"
            size={18}
            color={Colors.dark.buttonText}
            style={styles.retryIcon}
          />
          <ThemedText style={styles.retryText}>
            {isTr ? "Yeniden Dene" : "Retry"}
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
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  content: {
    width: "100%",
    alignItems: "center",
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(255, 71, 87, 0.12)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: Colors.dark.error,
    marginBottom: Spacing.lg,
    textAlign: "center",
  },
  description: {
    fontSize: 16,
    color: Colors.dark.text,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: Spacing.lg,
  },
  errorBox: {
    width: "100%",
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.xs,
    borderLeftWidth: 3,
    borderLeftColor: Colors.dark.error,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  errorText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    fontFamily: "monospace",
  },
  hint: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: Spacing["3xl"],
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing["2xl"],
    borderRadius: BorderRadius.xs,
    minWidth: 180,
    justifyContent: "center",
  },
  retryButtonPressed: {
    opacity: 0.8,
  },
  retryIcon: {
    marginRight: Spacing.sm,
    color: Colors.dark.buttonText,
  },
  retryText: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.dark.buttonText,
  },
});
