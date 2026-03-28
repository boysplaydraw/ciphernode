import React from "react";
import { View, StyleSheet, Pressable, Modal } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";

export interface ActionSheetOption {
  text: string;
  onPress: () => void;
  style?: "default" | "destructive" | "cancel";
}

interface ActionSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  options: ActionSheetOption[];
}

export default function ActionSheet({
  visible,
  onClose,
  title,
  message,
  options,
}: ActionSheetProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={styles.container}>
          <View style={styles.sheet}>
            {title ? (
              <View style={styles.header}>
                <ThemedText style={styles.title}>{title}</ThemedText>
                {message ? (
                  <ThemedText style={styles.message}>{message}</ThemedText>
                ) : null}
              </View>
            ) : null}
            {options.map((option, index) => (
              <Pressable
                key={index}
                style={({ pressed }) => [
                  styles.option,
                  option.style === "cancel" && styles.cancelOption,
                  pressed && styles.optionPressed,
                  index === options.length - 1 && styles.lastOption,
                ]}
                onPress={() => {
                  option.onPress();
                  onClose();
                }}
              >
                <ThemedText
                  style={[
                    styles.optionText,
                    option.style === "destructive" && styles.destructiveText,
                    option.style === "cancel" && styles.cancelText,
                  ]}
                >
                  {option.text}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "flex-end",
  },
  container: {
    padding: Spacing.lg,
  },
  sheet: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
  },
  header: {
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
    alignItems: "center",
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.text,
    textAlign: "center",
  },
  message: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    marginTop: Spacing.xs,
    textAlign: "center",
  },
  option: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
    alignItems: "center",
  },
  lastOption: {
    borderBottomWidth: 0,
  },
  cancelOption: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.md,
  },
  optionPressed: {
    backgroundColor: Colors.dark.backgroundRoot,
  },
  optionText: {
    fontSize: 16,
    color: Colors.dark.primary,
  },
  destructiveText: {
    color: Colors.dark.error,
  },
  cancelText: {
    fontWeight: "600",
    color: Colors.dark.text,
  },
});
