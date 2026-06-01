export type TransportStatus = "connected" | "disconnected" | "registered";

export type TransportEventHandler<T = unknown> = (data: T) => void;

export interface TransportAdapter {
  connect(userId: string, publicKey: string, groups?: string[]): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  emit<T>(event: string, data: T, requestId?: string): void;
  on<T>(event: string, handler: TransportEventHandler<T>): () => void;
}

export interface RelayEnvelope<T = unknown> {
  event: string;
  data?: T;
  requestId?: string;
  nonce?: string;
  timestamp?: number;
}
