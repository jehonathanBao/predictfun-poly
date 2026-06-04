import { describe, expect, it } from "vitest";
import { EXECUTION_FLOW_STEPS, preflightBeforeSubmit, reconcileOrderReports } from "../../src/execution/flow.js";
import { OrderBook } from "../../src/core/types.js";
import { d } from "../../src/core/decimal.js";
import { predictHeartbeatResponse } from "../../src/adapters/predict/ws.js";
import { polymarketMarketSubscribeMessage } from "../../src/adapters/polymarket/ws-market.js";

function book(timestampMs?: number) {
  return new OrderBook({
    bids: [{ price: d("0.40"), size: d("10") }],
    asks: [{ price: d("0.50"), size: d("10") }],
    decimalPrecision: 3,
    timestampMs
  });
}

describe("execution flow", () => {
  it("documents the end-to-end execution steps in order", () => {
    expect(EXECUTION_FLOW_STEPS[0]).toBe("LOAD_CONFIG_ACCOUNTS_KEYS");
    expect(EXECUTION_FLOW_STEPS).toContain("SUBSCRIBE_ORDERBOOK_WS");
    expect(EXECUTION_FLOW_STEPS).toContain("AUDIT_SETTLEMENT_REDEEM_RELEASE");
  });

  it("blocks stale books in preflight", () => {
    const result = preflightBeforeSubmit({
      predictBalanceOk: true,
      polymarketBalanceOk: true,
      predictAllowanceOk: true,
      polymarketAllowanceOk: true,
      predictJwtOk: true,
      predictBook: book(1000),
      polymarketBook: book(1000),
      staleBookMs: 750,
      nowMs: 2000
    });

    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("Predict book is stale");
    expect(result.reasons).toContain("Polymarket book is stale");
  });

  it("blocks unhealthy execution liveness in preflight", () => {
    const result = preflightBeforeSubmit({
      predictBalanceOk: true,
      polymarketBalanceOk: true,
      predictAllowanceOk: true,
      polymarketAllowanceOk: true,
      predictJwtOk: true,
      predictBook: book(1000),
      polymarketBook: book(1000),
      staleBookMs: 750,
      nowMs: 1200,
      livenessChecks: [
        {
          healthy: false,
          shouldPause: true,
          channel: "POLYMARKET_CLOB_HEARTBEAT",
          reason: "POLYMARKET_CLOB_HEARTBEAT heartbeat is stale"
        }
      ]
    });

    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("POLYMARKET_CLOB_HEARTBEAT heartbeat is stale");
  });

  it("reconciles equal fills as HEDGED", () => {
    const result = reconcileOrderReports({
      predictResult: {
        venue: "PREDICT",
        clientOrderId: "p",
        status: "matched",
        filledShares: d("10"),
        averagePrice: d("0.40")
      },
      polymarketResult: {
        venue: "POLYMARKET",
        clientOrderId: "pm",
        status: "matched",
        filledShares: d("10"),
        averagePrice: d("0.50")
      }
    });

    expect(result.state).toBe("HEDGED");
    expect(result.nextStep).toBe("MARK_HEDGED");
  });

  it("provides official websocket helper payload shapes", () => {
    expect(predictHeartbeatResponse({ type: "M", topic: "heartbeat", data: 123 })).toEqual({
      method: "heartbeat",
      data: 123
    });
    expect(polymarketMarketSubscribeMessage(["yes", "no"])).toEqual({
      assets_ids: ["yes", "no"],
      type: "market",
      custom_feature_enabled: true
    });
  });
});
