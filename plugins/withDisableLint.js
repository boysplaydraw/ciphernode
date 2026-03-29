const { withAppBuildGradle } = require("@expo/config-plugins");

/**
 * Android release build'lerde lint'in fatal hata vermesini önler.
 * lintVitalRelease task'ının build'i durdurmasını engeller.
 */
module.exports = function withDisableLint(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === "groovy") {
      config.modResults.contents = config.modResults.contents.replace(
        /android\s*\{/,
        `android {
    lintOptions {
        checkReleaseBuilds false
        abortOnError false
    }`
      );
    }
    return config;
  });
};
