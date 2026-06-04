export type LivenessChannel =
  | "POLYMARKET_CLOB_HEARTBEAT"
  | "POLYMARKET_WS_MARKET"
  | "POLYMARKET_WS_USER"
  | "PREDICT_WS";

export interface LivenessPolicy {
  expectedIntervalMs: number;
  graceMs: number;
  required: boolean;
}

export interface LivenessCheckInput extends LivenessPolicy {
  channel: LivenessChannel;
  nowMs: number;
  lastSeenMs?: number;
}

export interface LivenessCheckResult {
  channel: LivenessChannel;
  healthy: boolean;
  shouldPause: boolean;
  ageMs?: number;
  reason?: string;
}

export class LivenessMonitor {
  private readonly lastSeen = new Map<LivenessChannel, number>();

  mark(channel: LivenessChannel, nowMs: number): void {
    this.lastSeen.set(channel, nowMs);
  }

  check(channel: LivenessChannel, policy: LivenessPolicy, nowMs: number): LivenessCheckResult {
    return checkLiveness({
      channel,
      nowMs,
      lastSeenMs: this.lastSeen.get(channel),
      ...policy
    });
  }

  checkAll(policies: Partial<Record<LivenessChannel, LivenessPolicy>>, nowMs: number): readonly LivenessCheckResult[] {
    return Object.entries(policies).map(([channel, policy]) =>
      this.check(channel as LivenessChannel, policy as LivenessPolicy, nowMs)
    );
  }
}

export function checkLiveness(input: LivenessCheckInput): LivenessCheckResult {
  if (!input.required) {
    return { channel: input.channel, healthy: true, shouldPause: false };
  }
  if (input.lastSeenMs === undefined) {
    return {
      channel: input.channel,
      healthy: false,
      shouldPause: true,
      reason: `${input.channel} heartbeat has not been observed`
    };
  }

  const ageMs = Math.max(0, input.nowMs - input.lastSeenMs);
  const maxAgeMs = input.expectedIntervalMs + input.graceMs;
  if (ageMs > maxAgeMs) {
    return {
      channel: input.channel,
      healthy: false,
      shouldPause: true,
      ageMs,
      reason: `${input.channel} heartbeat is stale`
    };
  }

  return { channel: input.channel, healthy: true, shouldPause: false, ageMs };
}
