import React from "react";
import { View, StyleSheet } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useLanguage } from "@/constants/language";

export function ComingSoonBadge() {
  const { language } = useLanguage();
  return (
    <View style={styles.badge}>
      <ThemedText style={styles.text}>
        {language === "tr" ? "Yakında" : "Soon"}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: "#FFB800",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 6,
    alignSelf: "center",
  },
  text: {
    fontSize: 10,
    fontWeight: "700",
    color: "#0A0E14",
    lineHeight: 14,
  },
});
