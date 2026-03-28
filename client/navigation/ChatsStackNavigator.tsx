import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import ChatsListScreen from "@/screens/ChatsListScreen";
import ChatThreadScreen from "@/screens/ChatThreadScreen";
import ContactInfoScreen from "@/screens/ContactInfoScreen";
import CreateGroupScreen from "@/screens/CreateGroupScreen";
import ArchivedChatsScreen from "@/screens/ArchivedChatsScreen";
import GroupThreadScreen from "@/screens/GroupThreadScreen";
import GroupInfoScreen from "@/screens/GroupInfoScreen";
import NewChatScreen from "@/screens/NewChatScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { useLanguage } from "@/constants/language";

export type ChatsStackParamList = {
  ChatsList: undefined;
  ChatThread: { contactId: string };
  ContactInfo: { contactId: string };
  CreateGroup: undefined;
  ArchivedChats: undefined;
  GroupThread: { groupId: string };
  GroupInfo: { groupId: string };
  NewChat: undefined;
};

const Stack = createNativeStackNavigator<ChatsStackParamList>();

export default function ChatsStackNavigator() {
  const screenOptions = useScreenOptions();
  const { language } = useLanguage();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="ChatsList"
        component={ChatsListScreen}
        options={{
          headerTitle: "CipherNode",
        }}
      />
      <Stack.Screen
        name="ChatThread"
        component={ChatThreadScreen}
        options={{
          headerTitle: language === "tr" ? "Sohbet" : "Chat",
        }}
      />
      <Stack.Screen
        name="ContactInfo"
        component={ContactInfoScreen}
        options={{
          headerTitle: language === "tr" ? "Kişi Bilgisi" : "Contact Info",
        }}
      />
      <Stack.Screen
        name="CreateGroup"
        component={CreateGroupScreen}
        options={{
          headerTitle: language === "tr" ? "Grup Oluştur" : "Create Group",
        }}
      />
      <Stack.Screen
        name="ArchivedChats"
        component={ArchivedChatsScreen}
        options={{
          headerTitle: language === "tr" ? "Arşiv" : "Archived",
        }}
      />
      <Stack.Screen
        name="GroupThread"
        component={GroupThreadScreen}
        options={{
          headerTitle: language === "tr" ? "Grup Sohbeti" : "Group Chat",
        }}
      />
      <Stack.Screen
        name="GroupInfo"
        component={GroupInfoScreen}
        options={{
          headerTitle: language === "tr" ? "Grup Bilgisi" : "Group Info",
        }}
      />
      <Stack.Screen
        name="NewChat"
        component={NewChatScreen}
        options={{
          headerTitle: language === "tr" ? "Yeni Sohbet" : "New Chat",
        }}
      />
    </Stack.Navigator>
  );
}
