import React, { useCallback, useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing } from "@/constants/theme";
import { ThemedText } from "./ThemedText";
import { getTorSettings, type TorSettings } from "@/lib/storage";
import {
  getTransportState,
  isConnected,
  onRelayStatusChange,
  onStatusChange,
  onTorStatusChange,
  onTransportStateChange,
} from "@/lib/socket";

type ConnectionState = "p2p" | "relay" | "offline" | "tor" | "tor_connecting";

interface ConnectionStatusProps {
  state?: ConnectionState;
  showLabel?: boolean;
}

function currentNetworkState(): ConnectionState {
  if (getTransportState() === "p2p_ready") return "p2p";
  return isConnected() ? "relay" : "offline";
}

export default function ConnectionStatus({
  state,
  showLabel = true,
}: ConnectionStatusProps) {
  const [displayState, setDisplayState] = useState<ConnectionState>(
    state ?? currentNetworkState(),
  );

  const updateDisplayState = useCallback((settings: TorSettings) => {
    if (settings.enabled) {
      if (settings.connectionStatus === "connected") {
        setDisplayState("tor");
      } else if (settings.connectionStatus === "connecting") {
        setDisplayState("tor_connecting");
      }
    }
  }, []);

  useEffect(() => {
    if (state) {
      setDisplayState(state);
      return;
    }

    getTorSettings().then(updateDisplayState);

    const unsubTor = onTorStatusChange(updateDisplayState);
    const unsubStatus = onStatusChange((status) => {
      if (status === "tor_connected") {
        setDisplayState("tor");
      } else if (status === "tor_connecting") {
        setDisplayState("tor_connecting");
      } else if (status === "registered") {
        getTorSettings().then((settings) => {
          if (!settings.enabled) setDisplayState(currentNetworkState());
        });
      } else if (status === "disconnected") {
        setDisplayState(currentNetworkState());
      }
    });
    const unsubRelay = onRelayStatusChange(() => {
      setDisplayState(currentNetworkState());
    });
    const unsubTransport = onTransportStateChange(() => {
      setDisplayState(currentNetworkState());
    });

    return () => {
      unsubTor();
      unsubStatus();
      unsubRelay();
      unsubTransport();
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
  const color = getColor();

  return (
    <View style={styles.container}>
      {isTor ? (
        <View style={styles.indicator}>
          <Feather name="shield" size={12} color={color} />
          {showLabel ? (
            <ThemedText style={[styles.label, { color }]}>
              {getLabel()}
            </ThemedText>
          ) : null}
        </View>
      ) : (
        <View style={styles.indicator}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          {showLabel ? (
            <ThemedText style={[styles.label, { color }]}>
              {getLabel()}
            </ThemedText>
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
  indicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: "600",
  },
});
