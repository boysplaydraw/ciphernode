import type {
  RelayEnvelope,
  TransportAdapter,
  TransportEventHandler,
} from "./types";

export class WebSocketTransport implements TransportAdapter {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<TransportEventHandler>>();

  constructor(private readonly url: string) {}

  async connect(userId: string, publicKey: string, groups: string[] = []) {
    this.disconnect();
    this.ws = new WebSocket(toWsUrl(this.url));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("websocket connect timeout")),
        10000,
      );
      this.ws!.onopen = () => {
        clearTimeout(timer);
        this.emit("register", { userId, publicKey, groups });
        resolve();
      };
      this.ws!.onerror = () => reject(new Error("websocket connect failed"));
      this.ws!.onmessage = (message) => this.dispatch(message.data);
      this.ws!.onclose = () =>
        this.dispatch(JSON.stringify({ event: "disconnected" }));
    });
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
  }

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  emit<T>(event: string, data: T, requestId?: string) {
    const envelope: RelayEnvelope<T> = {
      event,
      data,
      requestId,
      nonce: cryptoRandom(),
      timestamp: Date.now(),
    };
    this.ws?.send(JSON.stringify(envelope));
  }

  on<T>(event: string, handler: TransportEventHandler<T>) {
    const bucket = this.handlers.get(event) ?? new Set();
    bucket.add(handler as TransportEventHandler);
    this.handlers.set(event, bucket);
    return () => bucket.delete(handler as TransportEventHandler);
  }

  private dispatch(raw: unknown) {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const envelope = parsed as RelayEnvelope;
    this.handlers
      .get(envelope.event)
      ?.forEach((handler) => handler(envelope.data));
  }
}

function toWsUrl(base: string) {
  const url = new URL("/ws", base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function cryptoRandom() {
  const g = globalThis.crypto;
  if (g?.randomUUID) return g.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
