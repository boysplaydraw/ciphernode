import React, { useState, useCallback } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
} from "react-native";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Colors, Spacing, BorderRadius, Fonts } from "@/constants/theme";
import { getGroup, deleteGroup, archiveGroup, removeGroupMember, type Group } from "@/lib/storage";
import { useIdentity } from "@/hooks/useIdentity";
import type { ChatsStackParamList } from "@/navigation/ChatsStackNavigator";

type NavigationProp = NativeStackNavigationProp<ChatsStackParamList, "GroupInfo">;
type ScreenRouteProp = RouteProp<ChatsStackParamList, "GroupInfo">;

export default function GroupInfoScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<ScreenRouteProp>();
  const { groupId } = route.params;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { identity } = useIdentity();

  const [group, setGroup] = useState<Group | null>(null);

  const loadGroup = useCallback(async () => {
    const g = await getGroup(groupId);
    setGroup(g);
  }, [groupId]);

  useFocusEffect(
    useCallback(() => {
      loadGroup();
    }, [loadGroup])
  );

  const isAdmin = group?.members.find((m) => m.id === identity?.id)?.role === "admin";

  const handleArchive = async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    await archiveGroup(groupId);
    navigation.popToTop();
  };

  const handleLeaveGroup = () => {
    Alert.alert(
      "Leave Group",
      "Are you sure you want to leave this group?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: async () => {
            if (identity) {
              await removeGroupMember(groupId, identity.id);
            }
            navigation.popToTop();
          },
        },
      ]
    );
  };

  const handleDeleteGroup = () => {
    Alert.alert(
      "Delete Group",
      "This will permanently delete the group and all messages. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteGroup(groupId);
            navigation.popToTop();
          },
        },
      ]
    );
  };

  if (!group) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText style={styles.loadingText}>Loading...</ThemedText>
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
        <View style={styles.headerSection}>
          <View style={styles.avatar}>
            <Feather name="users" size={48} color={Colors.dark.secondary} />
          </View>
          <ThemedText style={styles.groupName}>{group.name}</ThemedText>
          {group.description ? (
            <ThemedText style={styles.description}>{group.description}</ThemedText>
          ) : null}
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>
            Members ({group.members.length})
          </ThemedText>
          <View style={styles.membersList}>
            {group.members.map((member) => (
              <View key={member.id} style={styles.memberRow}>
                <View style={styles.memberAvatar}>
                  <Feather name="user" size={18} color={Colors.dark.secondary} />
                </View>
                <View style={styles.memberInfo}>
                  <ThemedText style={styles.memberName}>
                    {member.displayName || member.id}
                    {member.id === identity?.id ? " (You)" : ""}
                  </ThemedText>
                  <ThemedText style={styles.memberId}>{member.id}</ThemedText>
                </View>
                {member.role === "admin" ? (
                  <View style={styles.adminBadge}>
                    <ThemedText style={styles.adminText}>Admin</ThemedText>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Encryption</ThemedText>
          <View style={styles.encryptionCard}>
            <View style={styles.encryptionBadge}>
              <Feather name="lock" size={16} color={Colors.dark.success} />
              <ThemedText style={styles.encryptionText}>
                End-to-End Encrypted
              </ThemedText>
            </View>
            <ThemedText style={styles.encryptionDetails}>
              All group messages are encrypted with AES-256 + RSA
            </ThemedText>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Created</ThemedText>
          <ThemedText style={styles.createdDate}>
            {new Date(group.createdAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </ThemedText>
        </View>

        <View style={styles.actionsSection}>
          <Pressable
            onPress={handleArchive}
            style={({ pressed }) => [
              styles.actionButton,
              pressed && styles.actionButtonPressed,
            ]}
          >
            <Feather name="archive" size={18} color={Colors.dark.warning} />
            <ThemedText style={styles.actionButtonText}>Archive Group</ThemedText>
          </Pressable>

          <Pressable
            onPress={handleLeaveGroup}
            style={({ pressed }) => [
              styles.actionButton,
              styles.actionButtonDanger,
              pressed && styles.actionButtonPressed,
            ]}
          >
            <Feather name="log-out" size={18} color={Colors.dark.error} />
            <ThemedText style={styles.actionButtonTextDanger}>Leave Group</ThemedText>
          </Pressable>

          {isAdmin ? (
            <Pressable
              onPress={handleDeleteGroup}
              style={({ pressed }) => [
                styles.actionButton,
                styles.actionButtonDanger,
                pressed && styles.actionButtonPressed,
              ]}
            >
              <Feather name="trash-2" size={18} color={Colors.dark.error} />
              <ThemedText style={styles.actionButtonTextDanger}>Delete Group</ThemedText>
            </Pressable>
          ) : null}
        </View>
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
  loadingText: {
    textAlign: "center",
    marginTop: 100,
    color: Colors.dark.textSecondary,
  },
  headerSection: {
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
  groupName: {
    fontSize: 24,
    fontWeight: "600",
    color: Colors.dark.text,
  },
  description: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    marginTop: Spacing.sm,
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
  membersList: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.dark.backgroundSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 15,
    fontWeight: "500",
    color: Colors.dark.text,
  },
  memberId: {
    fontSize: 11,
    fontFamily: Fonts?.mono,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  adminBadge: {
    backgroundColor: Colors.dark.secondary + "20",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  adminText: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.dark.secondary,
  },
  encryptionCard: {
    backgroundColor: Colors.dark.backgroundDefault,
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
  createdDate: {
    fontSize: 16,
    color: Colors.dark.text,
    marginLeft: Spacing.sm,
  },
  actionsSection: {
    marginTop: Spacing.xl,
    gap: Spacing.sm,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.dark.backgroundDefault,
    padding: Spacing.lg,
    borderRadius: BorderRadius.sm,
    gap: Spacing.sm,
  },
  actionButtonDanger: {
    borderWidth: 1,
    borderColor: Colors.dark.error + "40",
  },
  actionButtonPressed: {
    opacity: 0.7,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: "500",
    color: Colors.dark.warning,
  },
  actionButtonTextDanger: {
    fontSize: 16,
    fontWeight: "500",
    color: Colors.dark.error,
  },
});
