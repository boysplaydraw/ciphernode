// Polyfill'ler en önce yüklenmeli — import hoisting'ini önlemek için require() kullanılıyor
// openpgp ve diğer crypto modülleri yüklenmeden ÖNCE bu kurulmalı
const { Platform } = require("react-native");

globalThis.Buffer = globalThis.Buffer || require("buffer").Buffer;
globalThis.process = globalThis.process || require("process");

try {
  const { recordCrash, recordStartupDiagnostics } = require("./lib/diagnostics");
  recordStartupDiagnostics("index.js loaded");

  const errorUtils = globalThis.ErrorUtils;
  if (errorUtils?.setGlobalHandler) {
    const previousHandler = errorUtils.getGlobalHandler?.();
    errorUtils.setGlobalHandler((error, isFatal) => {
      recordCrash(error, isFatal ? "fatal_startup" : "global_startup");
      if (previousHandler) previousHandler(error, isFatal);
    });
  }
} catch (e) {
  console.error("Crash reporter failed to load:", e);
}

try {
  if (Platform.OS !== "web") {
    require("react-native-get-random-values");
    const { install } = require("react-native-quick-crypto");
    install();
  }
} catch (e) {
  if (globalThis.ErrorUtils) {
    globalThis.ErrorUtils.reportFatalError(e);
  } else {
    console.error("Crypto polyfill failed:", e);
  }
}

// Polyfill hazır — artık App ve openpgp güvenle yüklenebilir
const { registerRootComponent } = require("expo");
const App = require("./App").default;

registerRootComponent(App);
