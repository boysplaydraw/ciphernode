import { io, type Socket } from "socket.io-client";
import type { TransportAdapter, TransportEventHandler } from "./types";

export class SocketIOTransport implements TransportAdapter {
  private socket: Socket | null = null;

  constructor(private readonly url: string) {}

  async connect(userId: string, publicKey: string, groups: string[] = []) {
    this.socket?.disconnect();
    this.socket = io(this.url, {
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("socket.io connect timeout")),
        10000,
      );
      this.socket?.once("connect", () => {
        clearTimeout(timer);
        this.socket?.emit("register", { userId, publicKey, groups });
        resolve();
      });
      this.socket?.once("connect_error", reject);
    });
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }

  isConnected() {
    return this.socket?.connected ?? false;
  }

  emit<T>(event: string, data: T) {
    this.socket?.emit(event, data);
  }

  on<T>(event: string, handler: TransportEventHandler<T>) {
    this.socket?.on(event, handler);
    return () => this.socket?.off(event, handler);
  }
}
