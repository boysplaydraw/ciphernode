import React, { useState, useCallback } from "react";
import {
  View,
  FlatList,
  StyleSheet,
  Pressable,
  RefreshControl,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { getContacts } from "@/lib/storage";
import type { Contact } from "@/lib/crypto";
import type { ChatsStackParamList } from "@/navigation/ChatsStackNavigator";
import { useLanguage } from "@/constants/language";

type NavigationProp = NativeStackNavigationProp<ChatsStackParamList, "NewChat">;

interface ContactItemProps {
  contact: Contact;
  onPress: () => void;
}

function ContactItem({ contact, onPress }: ContactItemProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.contactItem,
        pressed && styles.contactItemPressed,
      ]}
    >
      <View style={styles.avatar}>
        <Feather name="user" size={20} color={Colors.dark.secondary} />
      </View>
      <View style={styles.contactInfo}>
        <ThemedText style={styles.contactName}>
          {contact.displayName || contact.id}
        </ThemedText>
        {contact.displayName ? (
          <ThemedText style={styles.contactId}>{contact.id}</ThemedText>
        ) : null}
      </View>
      <Feather name="message-circle" size={20} color={Colors.dark.primary} />
    </Pressable>
  );
}

export default function NewChatScreen() {
  const navigation = useNavigation<NavigationProp>();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { language } = useLanguage();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const t = {
    noContacts: language === "tr" ? "Henuz kisi yok" : "No contacts yet",
    addContactFirst: language === "tr"
      ? "Sohbet baslatmak icin once bir kisi ekleyin"
      : "Add a contact first to start chatting",
    addContact: language === "tr" ? "Kisi Ekle" : "Add Contact",
  };

  const loadContacts = useCallback(async () => {
    const contactsData = await getContacts();
    setContacts(contactsData);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadContacts();
    }, [loadContacts])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadContacts();
    setRefreshing(false);
  }, [loadContacts]);

  const handleContactPress = (contact: Contact) => {
    navigation.navigate("ChatThread", { contactId: contact.id });
  };

  const handleAddContact = () => {
    navigation.getParent()?.navigate("AddContactTab" as never);
  };

  if (contacts.length === 0) {
    return (
      <ThemedView style={styles.container}>
        <View
          style={[
            styles.emptyState,
            { paddingTop: headerHeight + Spacing.xl },
          ]}
        >
          <View style={styles.emptyIcon}>
            <Feather name="users" size={64} color={Colors.dark.textSecondary} />
          </View>
          <ThemedText style={styles.emptyTitle}>{t.noContacts}</ThemedText>
          <ThemedText style={styles.emptySubtitle}>
            {t.addContactFirst}
          </ThemedText>
          <Pressable
            onPress={handleAddContact}
            style={({ pressed }) => [
              styles.addButton,
              pressed && styles.addButtonPressed,
            ]}
          >
            <Feather name="user-plus" size={18} color={Colors.dark.buttonText} />
            <ThemedText style={styles.addButtonText}>{t.addContact}</ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={contacts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ContactItem
            contact={item}
            onPress={() => handleContactPress(item)}
          />
        )}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.dark.primary}
          />
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
  listContent: {
    flexGrow: 1,
  },
  contactItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.dark.backgroundDefault,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  contactItemPressed: {
    backgroundColor: Colors.dark.backgroundSecondary,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.dark.backgroundSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.text,
  },
  contactId: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing["3xl"],
  },
  emptyIcon: {
    marginBottom: Spacing.xl,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: Colors.dark.text,
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    marginBottom: Spacing["2xl"],
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.xs,
    gap: Spacing.sm,
  },
  addButtonPressed: {
    opacity: 0.8,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.buttonText,
  },
});
