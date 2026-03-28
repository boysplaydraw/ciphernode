import React, { useState, useEffect, useCallback } from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing } from "@/constants/theme";
import { ThemedText } from "./ThemedText";
import { getTorSettings, type TorSettings } from "@/lib/storage";
import { onTorStatusChange, onStatusChange } from "@/lib/socket";

type ConnectionState = "p2p" | "relay" | "offline" | "tor" | "tor_connecting";

interface ConnectionStatusProps {
  state?: ConnectionState;
  showLabel?: boolean;
}

export default function ConnectionStatus({ state = "relay", showLabel = false }: ConnectionStatusProps) {
  const [displayState, setDisplayState] = useState<ConnectionState>(state);

  const updateDisplayState = useCallback((settings: TorSettings) => {
    if (settings.enabled) {
      if (settings.connectionStatus === "connected") {
        setDisplayState("tor");
      } else if (settings.connectionStatus === "connecting") {
        setDisplayState("tor_connecting");
      } else {
        setDisplayState(state);
      }
    } else {
      setDisplayState(state);
    }
  }, [state]);

  useEffect(() => {
    getTorSettings().then(updateDisplayState);
    
    const unsubTor = onTorStatusChange(updateDisplayState);
    const unsubStatus = onStatusChange((status) => {
      if (status === "tor_connected") {
        setDisplayState("tor");
      } else if (status === "tor_connecting") {
        setDisplayState("tor_connecting");
      } else if (status === "disconnected") {
        getTorSettings().then((settings) => {
          if (!settings.enabled) {
            setDisplayState("offline");
          }
        });
      }
    });
    
    return () => {
      unsubTor();
      unsubStatus();
    };
  }, [state, updateDisplayState]);

  const getColor = () => {
    switch (displayState) {
      case "p2p":
        return Colors.dark.success;
      case "relay":
        return Colors.dark.warning;
      case "tor":
        return Colors.dark.secondary;
      case "tor_connecting":
        return Colors.dark.warning;
      case "offline":
        return Colors.dark.error;
    }
  };

  const getLabel = () => {
    switch (displayState) {
      case "p2p":
        return "P2P";
      case "relay":
        return "Relay";
      case "tor":
        return "Tor";
      case "tor_connecting":
        return "Tor...";
      case "offline":
        return "Offline";
    }
  };

  const isTor = displayState === "tor" || displayState === "tor_connecting";

  return (
    <View style={styles.container}>
      {isTor ? (
        <View style={styles.torIndicator}>
          <Feather name="shield" size={12} color={getColor()} />
          {showLabel ? (
            <ThemedText style={[styles.label, { color: getColor() }]}>{getLabel()}</ThemedText>
          ) : null}
        </View>
      ) : (
        <View style={styles.dotContainer}>
          <View style={[styles.dot, { backgroundColor: getColor() }]} />
          {showLabel ? (
            <ThemedText style={[styles.label, { color: getColor() }]}>{getLabel()}</ThemedText>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  dotContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  torIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  label: {
    fontSize: 10,
    fontWeight: "600",
  },
});
