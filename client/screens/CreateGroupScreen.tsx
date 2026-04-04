import React, { useState, useEffect } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius, Fonts } from "@/constants/theme";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { createGroup, getContacts, addGroupMember } from "@/lib/storage";
import { createGroupOnServer } from "@/lib/socket";
import { useIdentity } from "@/hooks/useIdentity";
import type { Contact } from "@/lib/crypto";
import { useLanguage } from "@/constants/language";

export default function CreateGroupScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { identity } = useIdentity();
  const { language } = useLanguage();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  const t = {
    groupInfo: language === "tr" ? "Grup Bilgisi" : "Group Info",
    groupName: language === "tr" ? "Grup adı" : "Group name",
    description:
      language === "tr" ? "Açıklama (isteğe bağlı)" : "Description (optional)",
    selectMembers: language === "tr" ? "Üye Seç" : "Select Members",
    noContacts: language === "tr" ? "Henüz kişi yok" : "No contacts yet",
    addContactsFirst:
      language === "tr"
        ? "Önce grup oluşturmak için kişi ekleyin"
        : "Add contacts first to create a group",
    createGroup: language === "tr" ? "Grup Oluştur" : "Create Group",
    creating: language === "tr" ? "Oluşturuluyor..." : "Creating...",
    error: language === "tr" ? "Hata" : "Error",
    enterGroupName:
      language === "tr" ? "Lütfen grup adı girin" : "Please enter a group name",
    identityNotLoaded:
      language === "tr" ? "Kimlik yüklenmedi" : "Identity not loaded",
    success: language === "tr" ? "Başarılı" : "Success",
    groupCreated:
      language === "tr"
        ? "Grup başarıyla oluşturuldu"
        : "Group created successfully",
    ok: language === "tr" ? "Tamam" : "OK",
    failedToCreate:
      language === "tr" ? "Grup oluşturulamadı" : "Failed to create group",
  };

  useEffect(() => {
    getContacts().then(setContacts);
  }, []);

  const toggleContact = (contactId: string) => {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync();
    }
    setSelectedContacts((prev) =>
      prev.includes(contactId)
        ? prev.filter((id) => id !== contactId)
        : [...prev, contactId],
    );
  };

  const handleCreateGroup = async () => {
    if (!name.trim()) {
      Alert.alert(t.error, t.enterGroupName);
      return;
    }

    if (!identity) {
      Alert.alert(t.error, t.identityNotLoaded);
      return;
    }

    setIsCreating(true);
    try {
      const newGroup = await createGroup(
        name.trim(),
        description.trim(),
        identity.id,
        identity.publicKey,
        identity.displayName || identity.id,
      );

      // Seçilen kişileri yerel grup üyesi olarak ekle (E2EE için public key gerekli)
      for (const contactId of selectedContacts) {
        const contact = contacts.find((c) => c.id === contactId);
        if (contact) {
          await addGroupMember(newGroup.id, {
            id: contact.id,
            publicKey: contact.publicKey || "",
            displayName: contact.displayName || contact.id,
            role: "member",
            addedAt: Date.now(),
          });
        }
      }

      // Sunucuya grup bildir (socket üzerinden)
      const memberIds = [identity.id, ...selectedContacts];
      createGroupOnServer(newGroup.id, memberIds);

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      Alert.alert(t.success, t.groupCreated, [
        { text: t.ok, onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      Alert.alert(t.error, t.failedToCreate);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xl,
        },
      ]}
    >
      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>{t.groupInfo}</ThemedText>

        <View style={styles.inputGroup}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t.groupName}
            placeholderTextColor={Colors.dark.textDisabled}
            maxLength={50}
          />
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder={t.description}
            placeholderTextColor={Colors.dark.textDisabled}
            multiline
            numberOfLines={3}
            maxLength={200}
          />
        </View>
      </View>

      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>
          {t.selectMembers} ({selectedContacts.length})
        </ThemedText>

        {contacts.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="users" size={32} color={Colors.dark.textDisabled} />
            <ThemedText style={styles.emptyText}>
              {t.noContacts} {t.addContactsFirst}
            </ThemedText>
          </View>
        ) : (
          <View style={styles.contactList}>
            {contacts.map((contact) => (
              <Pressable
                key={contact.id}
                onPress={() => toggleContact(contact.id)}
                style={({ pressed }) => [
                  styles.contactRow,
                  selectedContacts.includes(contact.id) &&
                    styles.contactRowSelected,
                  pressed && styles.contactRowPressed,
                ]}
              >
                <View style={styles.contactAvatar}>
                  <Feather
                    name="user"
                    size={20}
                    color={Colors.dark.secondary}
                  />
                </View>
                <View style={styles.contactInfo}>
                  <ThemedText style={styles.contactName}>
                    {contact.displayName || contact.id}
                  </ThemedText>
                  <ThemedText style={styles.contactId}>{contact.id}</ThemedText>
                </View>
                {selectedContacts.includes(contact.id) ? (
                  <Feather
                    name="check-circle"
                    size={24}
                    color={Colors.dark.primary}
                  />
                ) : (
                  <Feather
                    name="circle"
                    size={24}
                    color={Colors.dark.textDisabled}
                  />
                )}
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <Pressable
        onPress={handleCreateGroup}
        disabled={!name.trim() || isCreating}
        style={({ pressed }) => [
          styles.createButton,
          (!name.trim() || isCreating) && styles.createButtonDisabled,
          pressed && styles.createButtonPressed,
        ]}
      >
        <Feather name="users" size={20} color={Colors.dark.buttonText} />
        <ThemedText style={styles.createButtonText}>
          {isCreating ? t.creating : t.createGroup}
        </ThemedText>
      </Pressable>
    </KeyboardAwareScrollViewCompat>
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
  section: {
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.dark.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: Spacing.md,
    marginLeft: Spacing.sm,
  },
  inputGroup: {
    gap: Spacing.md,
  },
  input: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: 16,
    color: Colors.dark.text,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  contactList: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  contactRowSelected: {
    backgroundColor: Colors.dark.primary + "10",
  },
  contactRowPressed: {
    backgroundColor: Colors.dark.backgroundSecondary,
  },
  contactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
    fontWeight: "500",
    color: Colors.dark.text,
  },
  contactId: {
    fontSize: 12,
    fontFamily: Fonts?.mono,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  emptyState: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.sm,
    padding: Spacing["3xl"],
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    marginTop: Spacing.md,
  },
  createButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.dark.primary,
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  createButtonDisabled: {
    opacity: 0.5,
  },
  createButtonPressed: {
    opacity: 0.8,
  },
  createButtonText: {
    fontSize: 18,
    fontWeight: "600",
    color: Colors.dark.buttonText,
  },
});
