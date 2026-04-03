const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

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
        "node_modules/react-native-quick-crypto/lib/index.js",
      ),
      type: "sourceFile",
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
