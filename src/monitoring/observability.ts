import { alert, type AlertSink } from "../alerts/alertSink.js";
import { redactSecrets } from "../config/secrets.js";
import { type MetricsSink } from "./metrics.js";

export type MonitorEventType =
  | "TRADE_REJECTED"
  | "ORDER_SUBMITTED"
  | "BOT_PAUSED"
  | "UNHEDGED_RESIDUAL"
  | "RESCUE_FAILED"
  | "ALL_PREDICT_ACCOUNTS_UNAVAILABLE"
  | "POLYMARKET_INSUFFICIENT_BALANCE"
  | "GEOBLOCK_COMPLIANCE_FAIL"
  | "WS_STALE"
  | "RECONCILIATION_MISMATCH"
  | "AUTH_ERROR";

export type ReasonCode =
  | "NO_PROFIT_AFTER_BUFFERS"
  | "STALE_BOOK"
  | "MARKET_NOT_EXACT"
  | "PREDICT_ACCOUNT_UNAVAILABLE"
  | "ALL_PREDICT_ACCOUNTS_UNAVAILABLE"
  | "POLYMARKET_INSUFFICIENT_BALANCE"
  | "GEOBLOCK_COMPLIANCE_FAIL"
  | "UNHEDGED_RESIDUAL"
  | "RESCUE_FAILED"
  | "WS_STALE"
  | "RECONCILIATION_MISMATCH"
  | "AUTH_ERROR"
  | "LIVE_KEYS_MISSING"
  | "STRATEGY_REJECTED"
  | "REJECT_NOT_BTC"
  | "REJECT_NOT_BTC_UP_DOWN"
  | "REJECT_NOT_SHORT_WINDOW"
  | "REJECT_NOT_EXACT_1H_WINDOW"
  | "REJECT_WINDOW_TOO_LONG"
  | "REJECT_TOO_EARLY"
  | "REJECT_TOO_CLOSE_TO_CLOSE"
  | "REJECT_BAD_RESOLUTION_SOURCE"
  | "REJECT_START_TIME_MISMATCH"
  | "REJECT_END_TIME_MISMATCH"
  | "REJECT_RULE_MISMATCH"
  | "REJECT_PRICE_FEED_MISMATCH"
  | "REJECT_NOT_TRADABLE"
  | "REJECT_MISSING_START_OR_END"
  | "REJECT_UNKNOWN_MARKET_FAMILY"
  | "REJECT_CADENCE_MISMATCH"
  | "REJECT_STALE_BOOK"
  | "REJECT_MARKET_CLOSING"
  | "REJECT_SECONDS_DELAY_TOO_HIGH"
  | "REJECT_NO_PROFIT_AFTER_RECHECK"
  | "REJECT_NAKED_MARKET_ORDER"
  | "UNKNOWN";

export type MonitorSeverity = "info" | "warning" | "error";

export interface MonitorEvent {
  eventType: MonitorEventType;
  severity: MonitorSeverity;
  reasonCode: ReasonCode;
  message: string;
  hedgeId?: string;
  orderId?: string;
  marketPairId?: string;
  predictAccountId?: string;
  polymarketAccountId?: string;
  pauseReason?: string;
  residualShares?: string;
  raw?: Record<string, unknown>;
}

export interface StructuredLogger {
  info(object: Record<string, unknown>, message?: string): void;
  warn(object: Record<string, unknown>, message?: string): void;
  error(object: Record<string, unknown>, message?: string): void;
}

export interface MonitorDeps {
  logger?: StructuredLogger;
  metrics?: MetricsSink;
  alerts?: AlertSink;
}

const ALERT_EVENT_TYPES = new Set<MonitorEventType>([
  "UNHEDGED_RESIDUAL",
  "RESCUE_FAILED",
  "ALL_PREDICT_ACCOUNTS_UNAVAILABLE",
  "POLYMARKET_INSUFFICIENT_BALANCE",
  "GEOBLOCK_COMPLIANCE_FAIL",
  "WS_STALE",
  "RECONCILIATION_MISMATCH",
  "AUTH_ERROR",
  "BOT_PAUSED"
]);

export async function emitMonitorEvent(deps: MonitorDeps, event: MonitorEvent): Promise<void> {
  const payload = redactSecrets({
    event_type: event.eventType,
    severity: event.severity,
    reason_code: event.reasonCode,
    hedge_id: event.hedgeId,
    order_id: event.orderId,
    market_pair_id: event.marketPairId,
    predict_account_id: event.predictAccountId,
    polymarket_account_id: event.polymarketAccountId,
    pause_reason: event.pauseReason,
    residual_shares: event.residualShares,
    raw: event.raw
  });

  logStructured(deps.logger, event, payload);
  deps.metrics?.increment("bot_events_total", {
    event_type: event.eventType,
    reason_code: event.reasonCode,
    severity: event.severity
  });
  if (event.eventType === "ORDER_SUBMITTED") {
    deps.metrics?.increment("orders_submitted_total", {
      venue: String(event.raw?.venue ?? "UNKNOWN")
    });
  }
  if (event.eventType === "BOT_PAUSED") {
    deps.metrics?.gauge("bot_paused", 1, {
      reason_code: event.reasonCode
    });
  }

  if (ALERT_EVENT_TYPES.has(event.eventType)) {
    await deps.alerts?.send({
      ...alert(event.severity === "info" ? "info" : event.severity, event.message),
      eventType: event.eventType,
      reasonCode: event.reasonCode,
      hedgeId: event.hedgeId,
      orderId: event.orderId,
      pauseReason: event.pauseReason,
      raw: payload
    });
  }
}

export function tradeRejected(reasonCode: ReasonCode, message: string, raw?: Record<string, unknown>): MonitorEvent {
  return {
    eventType: "TRADE_REJECTED",
    severity: "info",
    reasonCode,
    message,
    raw
  };
}

export function orderSubmitted(input: {
  hedgeId: string;
  orderId: string;
  venue: string;
  message?: string;
}): MonitorEvent {
  return {
    eventType: "ORDER_SUBMITTED",
    severity: "info",
    reasonCode: "UNKNOWN",
    message: input.message ?? "order submitted",
    hedgeId: input.hedgeId,
    orderId: input.orderId,
    raw: { venue: input.venue }
  };
}

export function botPaused(reasonCode: ReasonCode, pauseReason: string, raw?: Record<string, unknown>): MonitorEvent {
  return {
    eventType: "BOT_PAUSED",
    severity: "error",
    reasonCode,
    message: `bot paused: ${pauseReason}`,
    pauseReason,
    raw
  };
}

function logStructured(logger: StructuredLogger | undefined, event: MonitorEvent, payload: Record<string, unknown>): void {
  if (!logger) return;
  const message = event.message;
  if (event.severity === "error") {
    logger.error(payload, message);
  } else if (event.severity === "warning") {
    logger.warn(payload, message);
  } else {
    logger.info(payload, message);
  }
}
