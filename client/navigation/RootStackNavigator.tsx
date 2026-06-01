import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import MainTabNavigator from "@/navigation/MainTabNavigator";
import QRScannerScreen from "@/screens/QRScannerScreen";
import AddContactScreen from "@/screens/AddContactScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { Colors } from "@/constants/theme";
import { useLanguage } from "@/constants/language";

export type RootStackParamList = {
  Main: undefined;
  QRScanner: undefined;
  AddContact: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  const screenOptions = useScreenOptions();
  const { language } = useLanguage();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Main"
        component={MainTabNavigator}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="QRScanner"
        component={QRScannerScreen}
        options={{
          presentation: "fullScreenModal",
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="AddContact"
        component={AddContactScreen}
        options={{
          headerTitle: language === "tr" ? "Kişi Ekle" : "Add Contact",
          headerStyle: {
            backgroundColor: Colors.dark.backgroundRoot,
          },
          headerTintColor: Colors.dark.text,
          headerTitleStyle: {
            fontWeight: "600" as const,
          },
          presentation: "modal",
        }}
      />
    </Stack.Navigator>
  );
}
