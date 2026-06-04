export type WsConnectionState = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "STALE" | "RECONNECTING";

export interface WsManagedEvent {
  channel: string;
  key: string;
  sequence?: number;
  timestampMs?: number;
  payload: Record<string, unknown>;
}

export interface WsManagerPolicy {
  heartbeatIntervalMs: number;
  staleAfterMs: number;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
  dedupeWindow: number;
}

export interface WsManagerStatus {
  state: WsConnectionState;
  subscriptions: readonly string[];
  reconnectAttempts: number;
  stale: boolean;
  fallbackRestPolling: boolean;
  lastEventAtMs?: number;
  lastPongAtMs?: number;
  nextReconnectDelayMs: number;
}

export class WebSocketManager {
  private state: WsConnectionState = "DISCONNECTED";
  private readonly subscriptions = new Set<string>();
  private readonly seenKeys: string[] = [];
  private readonly lastSequence = new Map<string, number>();
  private reconnectAttempts = 0;
  private lastEventAtMs?: number;
  private lastPongAtMs?: number;

  constructor(private readonly policy: WsManagerPolicy) {}

  connect(nowMs: number): void {
    this.state = "CONNECTING";
    this.lastPongAtMs = nowMs;
  }

  markConnected(nowMs: number): void {
    this.state = "CONNECTED";
    this.reconnectAttempts = 0;
    this.lastPongAtMs = nowMs;
  }

  markDisconnected(): void {
    this.state = "RECONNECTING";
    this.reconnectAttempts += 1;
  }

  subscribe(topic: string): void {
    this.subscriptions.add(topic);
  }

  unsubscribe(topic: string): void {
    this.subscriptions.delete(topic);
  }

  heartbeatDue(nowMs: number): boolean {
    return this.lastPongAtMs === undefined || nowMs - this.lastPongAtMs >= this.policy.heartbeatIntervalMs;
  }

  markPong(nowMs: number): void {
    this.lastPongAtMs = nowMs;
    if (this.state === "STALE") this.state = "CONNECTED";
  }

  acceptEvent(event: WsManagedEvent): boolean {
    if (this.isDuplicate(event.key)) return false;
    const lastSequence = this.lastSequence.get(event.channel);
    if (event.sequence !== undefined && lastSequence !== undefined && event.sequence <= lastSequence) return false;
    this.remember(event.key);
    if (event.sequence !== undefined) this.lastSequence.set(event.channel, event.sequence);
    this.lastEventAtMs = event.timestampMs ?? Date.now();
    return true;
  }

  isStale(nowMs: number): boolean {
    const eventStale = this.lastEventAtMs === undefined || nowMs - this.lastEventAtMs > this.policy.staleAfterMs;
    const pongStale = this.lastPongAtMs === undefined || nowMs - this.lastPongAtMs > this.policy.staleAfterMs;
    return eventStale || pongStale || this.state === "DISCONNECTED" || this.state === "RECONNECTING";
  }

  shouldFallbackRestPoll(nowMs: number): boolean {
    return this.isStale(nowMs);
  }

  nextReconnectDelayMs(): number {
    if (this.reconnectAttempts <= 0) return 0;
    return Math.min(this.policy.reconnectMaxMs, this.policy.reconnectBaseMs * 2 ** (this.reconnectAttempts - 1));
  }

  status(nowMs: number): WsManagerStatus {
    const stale = this.isStale(nowMs);
    if (stale && this.state === "CONNECTED") this.state = "STALE";
    return {
      state: this.state,
      subscriptions: [...this.subscriptions],
      reconnectAttempts: this.reconnectAttempts,
      stale,
      fallbackRestPolling: this.shouldFallbackRestPoll(nowMs),
      lastEventAtMs: this.lastEventAtMs,
      lastPongAtMs: this.lastPongAtMs,
      nextReconnectDelayMs: this.nextReconnectDelayMs()
    };
  }

  private isDuplicate(key: string): boolean {
    return this.seenKeys.includes(key);
  }

  private remember(key: string): void {
    this.seenKeys.push(key);
    while (this.seenKeys.length > this.policy.dedupeWindow) this.seenKeys.shift();
  }
}

export const defaultWsManagerPolicy: WsManagerPolicy = {
  heartbeatIntervalMs: 10_000,
  staleAfterMs: 15_000,
  reconnectBaseMs: 250,
  reconnectMaxMs: 10_000,
  dedupeWindow: 1000
};
