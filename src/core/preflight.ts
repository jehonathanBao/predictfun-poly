import { type OrderBook } from "./types.js";

export interface PreflightInput {
  predictBalanceOk: boolean;
  polymarketBalanceOk: boolean;
  predictAllowanceOk: boolean;
  polymarketAllowanceOk: boolean;
  predictJwtOk: boolean;
  predictBook: OrderBook;
  polymarketBook: OrderBook;
  staleBookMs: number;
  nowMs: number;
  livenessChecks?: readonly {
    healthy: boolean;
    shouldPause?: boolean;
    channel?: string;
    reason?: string;
  }[];
}

export interface PreflightResult {
  ok: boolean;
  reasons: readonly string[];
}

export function runPreflight(input: PreflightInput): PreflightResult {
  const reasons: string[] = [];
  if (!input.predictBalanceOk) reasons.push("Predict balance is insufficient");
  if (!input.polymarketBalanceOk) reasons.push("Polymarket balance is insufficient");
  if (!input.predictAllowanceOk) reasons.push("Predict allowance/pre-approval is insufficient");
  if (!input.polymarketAllowanceOk) reasons.push("Polymarket allowance/collateral is insufficient");
  if (!input.predictJwtOk) reasons.push("Predict JWT is invalid or expired");
  if (isStale(input.predictBook.timestampMs, input.nowMs, input.staleBookMs)) reasons.push("Predict book is stale");
  if (isStale(input.polymarketBook.timestampMs, input.nowMs, input.staleBookMs)) reasons.push("Polymarket book is stale");
  for (const check of input.livenessChecks ?? []) {
    if (!check.healthy || check.shouldPause) {
      reasons.push(check.reason ?? `${check.channel ?? "liveness"} heartbeat is unhealthy`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

function isStale(timestampMs: number | undefined, nowMs: number, staleBookMs: number): boolean {
  return timestampMs === undefined || nowMs - timestampMs > staleBookMs;
}
