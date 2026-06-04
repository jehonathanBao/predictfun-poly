import { describe, expect, it } from "vitest";
import { InMemoryAlertSink } from "../../src/alerts/alertSink.js";
import { d } from "../../src/core/decimal.js";
import {
  botPaused,
  emitMonitorEvent,
  orderSubmitted,
  tradeRejected,
  type MonitorEvent,
  type StructuredLogger
} from "../../src/monitoring/observability.js";
import { InMemoryMetricsSink } from "../../src/monitoring/metrics.js";
import { type ArbCandidate, type NormalizedMarket, type NormalizedOrderbook, type PredictAccountState } from "../../src/core/types.js";

class MemoryLogger implements StructuredLogger {
  readonly entries: Array<{ level: string; object: Record<string, unknown>; message?: string }> = [];

  info(object: Record<string, unknown>, message?: string): void {
    this.entries.push({ level: "info", object, message });
  }

  warn(object: Record<string, unknown>, message?: string): void {
    this.entries.push({ level: "warning", object, message });
  }

  error(object: Record<string, unknown>, message?: string): void {
    this.entries.push({ level: "error", object, message });
  }
}

describe("monitoring observability", () => {
  it("records every trade rejection with a machine-readable reason code", async () => {
    const logger = new MemoryLogger();
    const metrics = new InMemoryMetricsSink();

    await emitMonitorEvent(
      { logger, metrics },
      tradeRejected("NO_PROFIT_AFTER_BUFFERS", "trade rejected after buffers", { apiKey: "secret-key" })
    );

    expect(logger.entries[0]?.object.reason_code).toBe("NO_PROFIT_AFTER_BUFFERS");
    expect(JSON.stringify(logger.entries[0]?.object)).not.toContain("secret-key");
    expect(
      metrics.counterValue("bot_events_total", {
        event_type: "TRADE_REJECTED",
        reason_code: "NO_PROFIT_AFTER_BUFFERS",
        severity: "info"
      })
    ).toBe(1);
  });

  it("records every submitted order with hedge_id and order_id", async () => {
    const logger = new MemoryLogger();

    await emitMonitorEvent({ logger }, orderSubmitted({ hedgeId: "h1", orderId: "o1", venue: "PREDICT" }));

    expect(logger.entries[0]?.object.hedge_id).toBe("h1");
    expect(logger.entries[0]?.object.order_id).toBe("o1");
  });

  it("alerts on pause with explicit pause reason", async () => {
    const alerts = new InMemoryAlertSink();
    const metrics = new InMemoryMetricsSink();

    await emitMonitorEvent({ alerts, metrics }, botPaused("WS_STALE", "Polymarket user websocket stale"));

    expect(alerts.alerts[0]?.reasonCode).toBe("WS_STALE");
    expect(alerts.alerts[0]?.pauseReason).toBe("Polymarket user websocket stale");
    expect(metrics.gauges.size).toBe(1);
  });

  it("alerts for all required operational event classes", async () => {
    const alerts = new InMemoryAlertSink();
    const eventTypes: MonitorEvent["eventType"][] = [
      "UNHEDGED_RESIDUAL",
      "RESCUE_FAILED",
      "ALL_PREDICT_ACCOUNTS_UNAVAILABLE",
      "POLYMARKET_INSUFFICIENT_BALANCE",
      "GEOBLOCK_COMPLIANCE_FAIL",
      "WS_STALE",
      "RECONCILIATION_MISMATCH",
      "AUTH_ERROR"
    ];

    for (const eventType of eventTypes) {
      await emitMonitorEvent(
        { alerts },
        {
          eventType,
          severity: "error",
          reasonCode: eventType === "ALL_PREDICT_ACCOUNTS_UNAVAILABLE" ? "ALL_PREDICT_ACCOUNTS_UNAVAILABLE" : "UNKNOWN",
          message: eventType
        }
      );
    }

    expect(alerts.alerts).toHaveLength(eventTypes.length);
  });
});

describe("core interface types", () => {
  it("supports normalized market, orderbook, arb candidate, and Predict account shapes", () => {
    const market: NormalizedMarket = {
      venue: "PREDICT",
      externalMarketId: "m1",
      question: "Will BTC be up?",
      asset: "BTC",
      family: "BTC_UP_DOWN",
      eventStartTs: new Date("2026-06-04T00:00:00Z"),
      eventEndTs: new Date("2026-06-04T01:00:00Z"),
      cadence: "HOURLY",
      directionType: "UP_DOWN",
      priceFeedProvider: "BINANCE",
      priceFeedSymbol: "BTC_USDT",
      resolutionSource: "BINANCE_BTC_USDT",
      upDownRule: "CLOSE_GTE_OPEN_IS_UP",
      isTradable: true,
      isClosed: false,
      isResolved: false,
      status: "OPEN",
      raw: {}
    };
    const book: NormalizedOrderbook = {
      venue: "PREDICT",
      marketId: "m1",
      buyYes: [{ price: d("0.45"), shares: d("10") }],
      buyNo: [{ price: d("0.55"), shares: d("10") }],
      ts: 1
    };
    const candidate: ArbCandidate = {
      marketPairId: "pair1",
      direction: "PREDICT_YES_POLY_NO",
      shares: d("10"),
      predictOutcome: "YES",
      polymarketOutcome: "NO",
      predictLimitPrice: d("0.45"),
      polymarketLimitPrice: d("0.50"),
      predictCostUsd: d("4.50"),
      polymarketCostUsd: d("5.00"),
      totalFeesUsd: d("0.01"),
      expectedProfitUsd: d("0.49"),
      expectedProfitPerShare: d("0.049")
    };
    const account: PredictAccountState = {
      id: "p1",
      label: "Predict 1",
      walletAddress: "0x1",
      status: "READY",
      freeBalanceUsdt: d("100")
    };

    expect(market.asset).toBe("BTC");
    expect(book.buyYes[0]?.price.toFixed()).toBe("0.45");
    expect(candidate.expectedProfitUsd.gt(0)).toBe(true);
    expect(account.status).toBe("READY");
  });
});
