const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enablePackageExports = false;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "openpgp") {
    return {
      filePath: path.resolve(
        __dirname,
        "node_modules/openpgp/dist/lightweight/openpgp.mjs",
      ),
      type: "sourceFile",
    };
  }
  // react-native-quick-crypto sadece native platformlarda (ios/android) kullanılır
  // Web'de tarayıcının yerleşik WebCrypto API'si kullanılır
  if (moduleName === "crypto" && platform !== "web") {
    return {
      filePath: path.resolve(
        __dirname,
        "node_modules/react-native-quick-crypto/lib/commonjs/index.js",
      ),
      type: "sourceFile",
    };
  }
  // react-native-quick-crypto/shim web'de gerekmez — no-op dosyasına yönlendir
  if (moduleName === "react-native-quick-crypto/shim" && platform === "web") {
    return {
      filePath: path.resolve(__dirname, "web-crypto-shim-noop.js"),
      type: "sourceFile",
    };
  }
  // nostr-tools subpath importları (nip44, nip19 vb.) — package exports devre dışı olduğunda
  // Metro bunları çözemez; lib/esm/*.js dosyalarına manuel olarak yönlendir
  if (moduleName.startsWith("nostr-tools/")) {
    const subpath = moduleName.slice("nostr-tools/".length);
    const filePath = path.resolve(
      __dirname,
      "node_modules/nostr-tools/lib/esm",
      subpath + ".js",
    );
    if (fs.existsSync(filePath)) {
      return { filePath, type: "sourceFile" };
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
