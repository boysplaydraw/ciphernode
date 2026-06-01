import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import SettingsScreen from "@/screens/SettingsScreen";
import NetworkSettingsScreen from "@/screens/NetworkSettingsScreen";
import SecuritySettingsScreen from "@/screens/SecuritySettingsScreen";
import AboutScreen from "@/screens/AboutScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { useLanguage } from "@/constants/language";

export type SettingsStackParamList = {
  Settings: undefined;
  NetworkSettings: undefined;
  SecuritySettings: undefined;
  About: undefined;
};

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export default function SettingsStackNavigator() {
  const screenOptions = useScreenOptions();
  const { language } = useLanguage();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          headerTitle: language === "tr" ? "Ayarlar" : "Settings",
        }}
      />
      <Stack.Screen
        name="NetworkSettings"
        component={NetworkSettingsScreen}
        options={{
          headerTitle: language === "tr" ? "Ağ" : "Network",
        }}
      />
      <Stack.Screen
        name="SecuritySettings"
        component={SecuritySettingsScreen}
        options={{
          headerTitle: language === "tr" ? "Güvenlik" : "Security",
        }}
      />
      <Stack.Screen
        name="About"
        component={AboutScreen}
        options={{
          headerTitle: language === "tr" ? "Hakkında" : "About",
        }}
      />
    </Stack.Navigator>
  );
}
