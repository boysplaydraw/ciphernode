import { Platform } from "react-native";

// react-native-quick-crypto ve get-random-values sadece native platformlarda çalışır
if (Platform.OS !== "web") {
  require("react-native-get-random-values");
  const { install } = require("react-native-quick-crypto");
  install();
}

// eslint-disable-next-line import/first
import { registerRootComponent } from "expo";
// eslint-disable-next-line import/first
import App from "@/App";

registerRootComponent(App);
