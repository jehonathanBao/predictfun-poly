import { describe, expect, it } from "vitest";
import { checkLiveness, LivenessMonitor } from "../../src/execution/liveness.js";
import {
  buildResidualRescueOrder,
  confirmOrderFill,
  reconcileExecutionSafety,
  validateConservativeOrderPlan,
  type ExecutionSafetyPolicy
} from "../../src/execution/safety.js";
import { d } from "../../src/core/decimal.js";
import { type OrderRequest, type OrderResult, type OrderType, type Outcome, type Venue } from "../../src/core/types.js";

const policy: ExecutionSafetyPolicy = {
  maxUnhedgedMs: 3000,
  cancelUnfilledOrders: true,
  postTradeReconcileRequired: true,
  pauseOnUnhedgedResidual: true
};

function order(venue: Venue, outcome: Outcome, orderType: OrderType = "FOK", limitPrice = "0.45"): OrderRequest {
  return {
    venue,
    marketId: `${venue}-m`,
    outcome,
    side: "BUY",
    orderType,
    shares: d("10"),
    limitPrice: d(limitPrice),
    accountId: `${venue}-account`,
    clientOrderId: `${venue}-${outcome}`
  };
}

function result(venue: Venue, filledShares: string, status: OrderResult["status"] = "matched"): OrderResult {
  return {
    venue,
    clientOrderId: `${venue}-order`,
    status,
    filledShares: d(filledShares),
    averagePrice: d("0.45")
  };
}

describe("execution safety", () => {
  it("rejects naked market orders", () => {
    const check = validateConservativeOrderPlan({
      predictOrder: order("PREDICT", "YES", "MARKET"),
      polymarketOrder: order("POLYMARKET", "NO"),
      predictWorstAcceptablePrice: d("0.45"),
      polymarketWorstAcceptablePrice: d("0.45")
    });

    expect(check.ok).toBe(false);
    expect(check.reasons).toContain("PREDICT naked MARKET orders are disabled");
  });

  it("rejects limits above the quote worst acceptable price", () => {
    const check = validateConservativeOrderPlan({
      predictOrder: order("PREDICT", "YES", "FOK", "0.46"),
      polymarketOrder: order("POLYMARKET", "NO"),
      predictWorstAcceptablePrice: d("0.45"),
      polymarketWorstAcceptablePrice: d("0.45")
    });

    expect(check.ok).toBe(false);
    expect(check.reasons).toContain("PREDICT limit price exceeds the quote worst acceptable price");
  });

  it("marks equal REST and WS fills as hedged", () => {
    const predict = confirmOrderFill({
      placement: result("PREDICT", "10"),
      rest: result("PREDICT", "10"),
      ws: result("PREDICT", "10"),
      requestedShares: d("10")
    });
    const polymarket = confirmOrderFill({
      placement: result("POLYMARKET", "10"),
      rest: result("POLYMARKET", "10"),
      ws: result("POLYMARKET", "10"),
      requestedShares: d("10")
    });

    const outcome = reconcileExecutionSafety({ predict, polymarket, requestedShares: d("10"), policy, nowMs: 10_000 });

    expect(outcome.state).toBe("HEDGED");
    expect(outcome.actions).toContain("MARK_HEDGED");
  });

  it("waits for reconcile when fills are equal but WS confirmation is missing", () => {
    const predict = confirmOrderFill({
      placement: result("PREDICT", "10"),
      rest: result("PREDICT", "10"),
      requestedShares: d("10")
    });
    const polymarket = confirmOrderFill({
      placement: result("POLYMARKET", "10"),
      rest: result("POLYMARKET", "10"),
      requestedShares: d("10")
    });

    const outcome = reconcileExecutionSafety({ predict, polymarket, requestedShares: d("10"), policy, nowMs: 10_000 });

    expect(outcome.state).toBe("RECONCILING");
    expect(outcome.actions).toContain("WAIT_FOR_CONFIRMATIONS");
  });

  it("does not rescue residuals before required REST and WS confirmations arrive", () => {
    const predict = confirmOrderFill({
      placement: result("PREDICT", "10"),
      rest: result("PREDICT", "10"),
      requestedShares: d("10")
    });
    const polymarket = confirmOrderFill({
      placement: result("POLYMARKET", "8"),
      rest: result("POLYMARKET", "8"),
      requestedShares: d("10")
    });

    const outcome = reconcileExecutionSafety({ predict, polymarket, requestedShares: d("10"), policy, nowMs: 10_000 });

    expect(outcome.state).toBe("RECONCILING");
    expect(outcome.actions).toContain("WAIT_FOR_CONFIRMATIONS");
    expect(outcome.actions).not.toContain("RESCUE_POLYMARKET_LEG");
  });

  it("plans a rescue order for the less filled side", () => {
    const predictOrder = order("PREDICT", "YES");
    const polymarketOrder = order("POLYMARKET", "NO");
    const predict = confirmOrderFill({
      placement: result("PREDICT", "10"),
      rest: result("PREDICT", "10"),
      ws: result("PREDICT", "10"),
      requestedShares: d("10")
    });
    const polymarket = confirmOrderFill({
      placement: result("POLYMARKET", "8"),
      rest: result("POLYMARKET", "8"),
      ws: result("POLYMARKET", "8"),
      requestedShares: d("10")
    });

    const outcome = reconcileExecutionSafety({ predict, polymarket, requestedShares: d("10"), policy, nowMs: 10_000 });
    const rescue = buildResidualRescueOrder({ outcome, predictOrder, polymarketOrder });

    expect(outcome.state).toBe("RESCUE");
    expect(outcome.rescueVenue).toBe("POLYMARKET");
    expect(rescue?.shares.toFixed()).toBe("2");
  });

  it("pauses when residual rescue fails", () => {
    const predict = confirmOrderFill({
      placement: result("PREDICT", "10"),
      rest: result("PREDICT", "10"),
      ws: result("PREDICT", "10"),
      requestedShares: d("10")
    });
    const polymarket = confirmOrderFill({
      placement: result("POLYMARKET", "8"),
      rest: result("POLYMARKET", "8"),
      ws: result("POLYMARKET", "8"),
      requestedShares: d("10")
    });

    const outcome = reconcileExecutionSafety({
      predict,
      polymarket,
      requestedShares: d("10"),
      policy,
      nowMs: 10_000,
      rescueAttempt: "failed"
    });

    expect(outcome.state).toBe("PAUSED");
    expect(outcome.actions).toContain("PAUSE_NEW_OPENINGS");
    expect(outcome.actions).toContain("ALERT");
  });

  it("releases the Predict lock when both legs fail", () => {
    const predict = confirmOrderFill({
      placement: result("PREDICT", "0", "failed"),
      rest: result("PREDICT", "0", "failed"),
      ws: result("PREDICT", "0", "failed"),
      requestedShares: d("10")
    });
    const polymarket = confirmOrderFill({
      placement: result("POLYMARKET", "0", "failed"),
      rest: result("POLYMARKET", "0", "failed"),
      ws: result("POLYMARKET", "0", "failed"),
      requestedShares: d("10")
    });

    const outcome = reconcileExecutionSafety({ predict, polymarket, requestedShares: d("10"), policy, nowMs: 10_000 });

    expect(outcome.state).toBe("FAILED");
    expect(outcome.actions).toContain("RELEASE_PREDICT_ACCOUNT_LOCK");
  });
});

describe("liveness safety", () => {
  it("marks stale heartbeat as a pause condition", () => {
    const result = checkLiveness({
      channel: "POLYMARKET_CLOB_HEARTBEAT",
      lastSeenMs: 0,
      nowMs: 16_000,
      expectedIntervalMs: 5_000,
      graceMs: 10_000,
      required: true
    });

    expect(result.healthy).toBe(false);
    expect(result.shouldPause).toBe(true);
  });

  it("tracks fresh heartbeat observations", () => {
    const monitor = new LivenessMonitor();
    monitor.mark("POLYMARKET_WS_USER", 10_000);

    const result = monitor.check("POLYMARKET_WS_USER", { expectedIntervalMs: 10_000, graceMs: 5_000, required: true }, 20_000);

    expect(result.healthy).toBe(true);
    expect(result.shouldPause).toBe(false);
  });
});
