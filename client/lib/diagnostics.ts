import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { getApiUrl } from "./query-client";

const DIAGNOSTICS_KEY = "@ciphernode/startup_diagnostics";
const MAX_ENTRIES = 50;

type DiagnosticLevel = "info" | "warn" | "error";

export interface DiagnosticEntry {
  level: DiagnosticLevel;
  event: string;
  message?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

async function append(entry: DiagnosticEntry): Promise<void> {
  try {
    const existing = await AsyncStorage.getItem(DIAGNOSTICS_KEY);
    const entries: DiagnosticEntry[] = existing ? JSON.parse(existing) : [];
    entries.push(entry);
    await AsyncStorage.setItem(
      DIAGNOSTICS_KEY,
      JSON.stringify(entries.slice(-MAX_ENTRIES)),
    );
  } catch {}
}

export function recordDiagnostic(
  level: DiagnosticLevel,
  event: string,
  message?: string,
  details?: Record<string, unknown>,
): void {
  const entry: DiagnosticEntry = {
    level,
    event,
    message,
    details,
    timestamp: new Date().toISOString(),
  };
  const log = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  log("[Diagnostics]", JSON.stringify(entry));
  append(entry).catch(() => {});
}

export function recordStartupDiagnostics(stage: string): void {
  recordDiagnostic("info", "startup", stage, {
    apiUrl: getApiUrl(),
    appVersion: Constants.expoConfig?.version,
    buildVersion: Constants.expoConfig?.android?.versionCode,
    executionEnvironment: Constants.executionEnvironment,
    platform: Platform.OS,
    releaseChannel: (Constants as any).manifest?.releaseChannel ?? null,
  });
}

export function recordCrash(error: unknown, context = "unhandled"): void {
  const err = error instanceof Error ? error : new Error(String(error));
  recordDiagnostic("error", "crash", err.message, {
    context,
    name: err.name,
    stack: err.stack,
  });
}

export async function getDiagnostics(): Promise<DiagnosticEntry[]> {
  try {
    const existing = await AsyncStorage.getItem(DIAGNOSTICS_KEY);
    return existing ? JSON.parse(existing) : [];
  } catch {
    return [];
  }
}
