import React, { useState, useCallback } from "react";
import {
  View,
  FlatList,
  StyleSheet,
  Pressable,
  RefreshControl,
  Alert,
  Platform,
} from "react-native";
import { useFocusEffect, useNavigation, CommonActions } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { getContacts, removeContact } from "@/lib/storage";
import type { Contact } from "@/lib/crypto";
import { useLanguage } from "@/constants/language";
import ActionSheet, { type ActionSheetOption } from "@/components/ActionSheet";

export default function ContactsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { language } = useLanguage();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [showActionSheet, setShowActionSheet] = useState(false);

  const t = {
    contacts: language === "tr" ? "Kişiler" : "Contacts",
    noContacts: language === "tr" ? "Henüz kişi yok" : "No contacts yet",
    addFirst: language === "tr" ? "İlk kişinizi ekleyin" : "Add your first contact",
    addContact: language === "tr" ? "Kişi Ekle" : "Add Contact",
    message: language === "tr" ? "Mesaj Gönder" : "Send Message",
    delete: language === "tr" ? "Sil" : "Delete",
    cancel: language === "tr" ? "İptal" : "Cancel",
    deleteConfirm: language === "tr" ? "Bu kişiyi silmek istediğinizden emin misiniz?" : "Are you sure you want to delete this contact?",
    deleted: language === "tr" ? "Kişi silindi" : "Contact deleted",
  };

  const loadContacts = useCallback(async () => {
    const storedContacts = await getContacts();
    setContacts(storedContacts.sort((a, b) => {
      const nameA = a.displayName || a.id;
      const nameB = b.displayName || b.id;
      return nameA.localeCompare(nameB);
    }));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadContacts();
    }, [loadContacts])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadContacts();
    setRefreshing(false);
  };

  const handleAddContact = () => {
    navigation.navigate("AddContact" as never);
  };

  const handleContactPress = (contact: Contact) => {
    navigation.dispatch(
      CommonActions.navigate({
        name: "ChatsTab",
        params: {
          screen: "ChatThread",
          params: { contactId: contact.id },
        },
      })
    );
  };

  const handleContactLongPress = (contact: Contact) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setSelectedContact(contact);
    setShowActionSheet(true);
  };

  const handleDeleteContact = async () => {
    if (!selectedContact) return;
    
    Alert.alert(
      t.delete,
      t.deleteConfirm,
      [
        { text: t.cancel, style: "cancel" },
        {
          text: t.delete,
          style: "destructive",
          onPress: async () => {
            await removeContact(selectedContact.id);
            if (Platform.OS !== "web") {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
            loadContacts();
          },
        },
      ]
    );
  };

  const actionSheetOptions: ActionSheetOption[] = [
    {
      text: t.message,
      onPress: () => {
        if (selectedContact) {
          handleContactPress(selectedContact);
        }
      },
    },
    {
      text: t.delete,
      onPress: handleDeleteContact,
      style: "destructive",
    },
    {
      text: t.cancel,
      onPress: () => {},
      style: "cancel",
    },
  ];

  const renderContact = ({ item }: { item: Contact }) => {
    const displayName = item.displayName || item.id;
    const initial = displayName.charAt(0).toUpperCase();

    return (
      <Pressable
        onPress={() => handleContactPress(item)}
        onLongPress={() => handleContactLongPress(item)}
        style={({ pressed }) => [
          styles.contactItem,
          pressed && styles.contactItemPressed,
        ]}
      >
        <View style={styles.avatar}>
          <ThemedText style={styles.avatarText}>{initial}</ThemedText>
        </View>
        <View style={styles.contactInfo}>
          <ThemedText style={styles.contactName} numberOfLines={1}>
            {displayName}
          </ThemedText>
          <ThemedText style={styles.contactId}>{item.id}</ThemedText>
        </View>
        <Feather name="chevron-right" size={20} color={Colors.dark.textSecondary} />
      </Pressable>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconContainer}>
        <Feather name="users" size={48} color={Colors.dark.textSecondary} />
      </View>
      <ThemedText style={styles.emptyTitle}>{t.noContacts}</ThemedText>
      <ThemedText style={styles.emptySubtitle}>{t.addFirst}</ThemedText>
      <Pressable
        onPress={handleAddContact}
        style={({ pressed }) => [
          styles.addButton,
          pressed && styles.addButtonPressed,
        ]}
      >
        <Feather name="user-plus" size={20} color={Colors.dark.buttonText} />
        <ThemedText style={styles.addButtonText}>{t.addContact}</ThemedText>
      </Pressable>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={contacts}
        keyExtractor={(item) => item.id}
        renderItem={renderContact}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: insets.top + Spacing.xl,
            paddingBottom: tabBarHeight + Spacing.xl,
          },
          contacts.length === 0 && styles.emptyListContent,
        ]}
        ListEmptyComponent={renderEmptyState}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={Colors.dark.primary}
          />
        }
      />

      <Pressable
        onPress={handleAddContact}
        style={({ pressed }) => [
          styles.fab,
          { bottom: tabBarHeight + Spacing.lg },
          pressed && styles.fabPressed,
        ]}
      >
        <Feather name="user-plus" size={24} color={Colors.dark.buttonText} />
      </Pressable>

      <ActionSheet
        visible={showActionSheet}
        onClose={() => setShowActionSheet(false)}
        options={actionSheetOptions}
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
    paddingHorizontal: Spacing.md,
  },
  emptyListContent: {
    flex: 1,
  },
  contactItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  contactItemPressed: {
    backgroundColor: Colors.dark.backgroundTertiary,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.dark.primary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.dark.buttonText,
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.text,
    marginBottom: 2,
  },
  contactId: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    fontFamily: "monospace",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  emptyIconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.dark.backgroundSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: Colors.dark.text,
    marginBottom: Spacing.xs,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginBottom: Spacing.xl,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
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
  fab: {
    position: "absolute",
    right: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.dark.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: Colors.dark.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  fabPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.95 }],
  },
});
