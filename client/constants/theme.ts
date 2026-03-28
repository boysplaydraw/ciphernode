import { Platform } from "react-native";

export const Colors = {
  light: {
    text: "#E5E9F0",
    textSecondary: "#8892A6",
    textDisabled: "#434C5E",
    buttonText: "#0A0E14",
    tabIconDefault: "#8892A6",
    tabIconSelected: "#00F5FF",
    link: "#00F5FF",
    backgroundRoot: "#0A0E14",
    backgroundDefault: "#151B26",
    backgroundSecondary: "#1E2433",
    backgroundTertiary: "#2E3440",
    primary: "#00F5FF",
    secondary: "#B877FF",
    success: "#00FF88",
    warning: "#FFB800",
    error: "#FF4757",
    border: "#2E3440",
    messageSent: "#00F5FF",
    messageReceived: "#1E2433",
  },
  dark: {
    text: "#E5E9F0",
    textSecondary: "#8892A6",
    textDisabled: "#434C5E",
    buttonText: "#0A0E14",
    tabIconDefault: "#8892A6",
    tabIconSelected: "#00F5FF",
    link: "#00F5FF",
    backgroundRoot: "#0A0E14",
    backgroundDefault: "#151B26",
    backgroundSecondary: "#1E2433",
    backgroundTertiary: "#2E3440",
    primary: "#00F5FF",
    secondary: "#B877FF",
    success: "#00FF88",
    warning: "#FFB800",
    error: "#FF4757",
    border: "#2E3440",
    messageSent: "#00F5FF",
    messageReceived: "#1E2433",
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 48,
  inputHeight: 48,
  buttonHeight: 52,
};

export const BorderRadius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 30,
  "2xl": 40,
  "3xl": 50,
  full: 9999,
};

export const Typography = {
  h1: {
    fontSize: 32,
    fontWeight: "700" as const,
  },
  h2: {
    fontSize: 28,
    fontWeight: "700" as const,
  },
  h3: {
    fontSize: 24,
    fontWeight: "600" as const,
  },
  h4: {
    fontSize: 20,
    fontWeight: "600" as const,
  },
  body: {
    fontSize: 16,
    fontWeight: "400" as const,
  },
  small: {
    fontSize: 14,
    fontWeight: "400" as const,
  },
  caption: {
    fontSize: 12,
    fontWeight: "500" as const,
  },
  mono: {
    fontSize: 14,
    fontWeight: "400" as const,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
