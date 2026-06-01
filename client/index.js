// Polyfill'ler en önce yüklenmeli — import hoisting'ini önlemek için require() kullanılıyor
// openpgp ve diğer crypto modülleri yüklenmeden ÖNCE bu kurulmalı
const { Platform } = require("react-native");

if (Platform.OS !== "web") {
  require("react-native-get-random-values");
  const { install } = require("react-native-quick-crypto");
  install();
}

// Polyfill hazır — artık App ve openpgp güvenle yüklenebilir
const { registerRootComponent } = require("expo");
const App = require("./App").default;

registerRootComponent(App);
