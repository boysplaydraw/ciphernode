// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const eslintPluginPrettierRecommended = require("eslint-plugin-prettier/recommended");

module.exports = defineConfig([
  expoConfig,
  eslintPluginPrettierRecommended,
  {
    rules: {
      // @/ ve @shared/ alias'ları build-time — ESLint statik analizde false positive verir
      "import/no-unresolved": ["error", { ignore: ["^@/", "^@shared/"] }],
    },
  },
  {
    ignores: ["dist/*", "electron/dist/*", "server_dist/*", "node_modules/*"],
  },
]);
