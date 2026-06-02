module.exports = function (api) {
  api.cache(true);
  
  const plugins = [
    [
      "module-resolver",
      {
        root: ["./"],
        alias: {
          "@": "./client",
          "@shared": "./shared",
        },
        extensions: [".ios.js", ".android.js", ".js", ".ts", ".tsx", ".json"],
      },
    ],
    "react-native-reanimated/plugin",
  ];

  if (process.env.NODE_ENV === "production" || process.env.BABEL_ENV === "production") {
    plugins.push("transform-remove-console");
  }

  return {
    presets: [
      [
        "babel-preset-expo",
        {
          unstable_transformImportMeta: true,
        },
      ],
    ],
    plugins,
  };
};
