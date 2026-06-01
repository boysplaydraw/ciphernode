import { SocketIOTransport } from "./socketio";
import type { TransportAdapter } from "./types";
import { WebSocketTransport } from "./websocket";

export type TransportKind = "socketio" | "websocket";

export function createTransport(
  kind: TransportKind,
  url: string,
): TransportAdapter {
  if (kind === "websocket") {
    return new WebSocketTransport(url);
  }
  return new SocketIOTransport(url);
}

export function getTransportKindFromEnv(): TransportKind {
  return process.env.EXPO_PUBLIC_RELAY_TRANSPORT === "websocket"
    ? "websocket"
    : "socketio";
}

export * from "./types";
