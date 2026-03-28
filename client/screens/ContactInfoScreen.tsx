import React, { useState, useCallback } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  Alert,
} from "react-native";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Fonts } from "@/constants/theme";
import { getContact, deleteChat, removeContact } from "@/lib/storage";
import type { Contact } from "@/lib/crypto";
import type { ChatsStackParamList } from "@/navigation/ChatsStackNavigator";
import { Platform } from "react-native";

type NavigationProp = NativeStackNavigationProp<ChatsStackParamList, "ContactInfo">;
type ScreenRouteProp = RouteProp<ChatsStackParamList, "ContactInfo">;

export default function ContactInfoScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<ScreenRouteProp>();
  const { contactId } = route.params;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const [contact, setContact] = useState<Contact | null>(null);
  const [showFullFingerprint, setShowFullFingerprint] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getContact(contactId).then(setContact);
    }, [contactId])
  );

  const copyToClipboard = async (text: string) => {
    await Clipboard.setStringAsync(text);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleDeleteConversation = () => {
    Alert.alert(
      "Delete Conversation",
      "This will permanently delete all messages with this contact. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteChat(contactId);
            await removeContact(contactId);
            navigation.popToTop();
          },
        },
      ]
    );
  };

  const formatFingerprint = (fp: string) => {
    return fp.replace(/(.{4})/g, "$1 ").trim();
  };

  if (!contact) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText>Loading...</ThemedText>
      </ThemedView>
    );
  }

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
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Feather name="user" size={48} color={Colors.dark.secondary} />
          </View>
          <ThemedText style={styles.displayName}>
            {contact.displayName || contact.id}
          </ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Contact ID</ThemedText>
          <Pressable
            onPress={() => copyToClipboard(contact.id)}
            style={({ pressed }) => [
              styles.infoRow,
              pressed && styles.infoRowPressed,
            ]}
          >
            <ThemedText style={styles.monoText}>{contact.id}</ThemedText>
            <Feather name="copy" size={18} color={Colors.dark.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Public Key Fingerprint</ThemedText>
          <Pressable
            onPress={() => setShowFullFingerprint(!showFullFingerprint)}
            style={({ pressed }) => [
              styles.infoRow,
              pressed && styles.infoRowPressed,
            ]}
          >
            <ThemedText style={styles.monoTextSmall} numberOfLines={showFullFingerprint ? 10 : 1}>
              {formatFingerprint(contact.fingerprint)}
            </ThemedText>
            <Feather
              name={showFullFingerprint ? "chevron-up" : "chevron-down"}
              size={18}
              color={Colors.dark.textSecondary}
            />
          </Pressable>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Encryption</ThemedText>
          <View style={styles.encryptionStatus}>
            <View style={styles.encryptionBadge}>
              <Feather name="lock" size={16} color={Colors.dark.success} />
              <ThemedText style={styles.encryptionText}>
                End-to-End Encrypted
              </ThemedText>
            </View>
            <ThemedText style={styles.encryptionDetails}>
              Messages are secured with AES-256 + RSA encryption using OpenPGP
            </ThemedText>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Added</ThemedText>
          <ThemedText style={styles.addedDate}>
            {new Date(contact.addedAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </ThemedText>
        </View>

        <Pressable
          onPress={handleDeleteConversation}
          style={({ pressed }) => [
            styles.deleteButton,
            pressed && styles.deleteButtonPressed,
          ]}
        >
          <Feather name="trash-2" size={18} color={Colors.dark.error} />
          <ThemedText style={styles.deleteButtonText}>
            Delete Conversation
          </ThemedText>
        </Pressable>
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
  avatarSection: {
    alignItems: "center",
    marginBottom: Spacing["3xl"],
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.dark.backgroundSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  displayName: {
    fontSize: 24,
    fontWeight: "600",
    color: Colors.dark.text,
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
    marginBottom: Spacing.sm,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.dark.backgroundSecondary,
    padding: Spacing.lg,
    borderRadius: BorderRadius.sm,
  },
  infoRowPressed: {
    backgroundColor: Colors.dark.backgroundTertiary,
  },
  monoText: {
    fontFamily: Fonts?.mono,
    fontSize: 16,
    color: Colors.dark.text,
    flex: 1,
  },
  monoTextSmall: {
    fontFamily: Fonts?.mono,
    fontSize: 12,
    color: Colors.dark.text,
    flex: 1,
    marginRight: Spacing.sm,
  },
  encryptionStatus: {
    backgroundColor: Colors.dark.backgroundSecondary,
    padding: Spacing.lg,
    borderRadius: BorderRadius.sm,
  },
  encryptionBadge: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  encryptionText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.success,
    marginLeft: Spacing.sm,
  },
  encryptionDetails: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
  },
  addedDate: {
    fontSize: 16,
    color: Colors.dark.text,
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: Colors.dark.error,
    padding: Spacing.lg,
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.xl,
  },
  deleteButtonPressed: {
    backgroundColor: Colors.dark.error + "20",
  },
  deleteButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.error,
    marginLeft: Spacing.sm,
  },
});
