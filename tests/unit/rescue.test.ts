import { describe, expect, it } from "vitest";
import { PredictAccountRotator, predictAccount } from "../../src/core/account-rotator.js";
import { rescueResidual, type RescuePolicy } from "../../src/execution/rescue.js";
import { d } from "../../src/core/decimal.js";
import { type OrderRequest, type OrderResult, type Outcome, type Venue } from "../../src/core/types.js";

const policy: RescuePolicy = {
  rescueMaxLossUsd: d("1.00"),
  maxUnhedgedSeconds: 3,
  pauseOnUnhedgedResidual: true,
  safeMethod: "PAUSE_ONLY"
};

function order(venue: Venue, outcome: Outcome, accountId = `${venue}-account`): OrderRequest {
  return {
    venue,
    marketId: `${venue}-market`,
    outcome,
    side: "BUY",
    orderType: "FOK",
    shares: d("10"),
    limitPrice: d("0.45"),
    accountId,
    clientOrderId: `${venue}-${outcome}`
  };
}

function result(venue: Venue, filled: string): OrderResult {
  return {
    venue,
    clientOrderId: `${venue}-order`,
    status: filled === "0" ? "failed" : "matched",
    filledShares: d(filled),
    averagePrice: d("0.45")
  };
}

describe("rescueResidual", () => {
  it("rescues only residual shares on Polymarket when Predict filled more", () => {
    const decision = rescueResidual({
      hedgeId: "h1",
      predictOrder: order("PREDICT", "YES", "p1"),
      polymarketOrder: order("POLYMARKET", "NO", "poly"),
      predictResult: result("PREDICT", "10"),
      polymarketResult: result("POLYMARKET", "8"),
      policy,
      nowMs: 1000,
      firstUnhedgedAtMs: 500,
      polymarketRescueLimitPrice: d("0.46")
    });

    expect(decision.action).toBe("BUY_POLYMARKET_COMPLEMENT");
    expect(decision.residualShares.toFixed()).toBe("2");
    expect(decision.rescueOrder?.shares.toFixed()).toBe("2");
    expect(decision.pause).toBe(false);
  });

  it("does not expand loss beyond rescue_max_loss_usd", () => {
    const decision = rescueResidual({
      hedgeId: "h1",
      predictOrder: order("PREDICT", "YES", "p1"),
      polymarketOrder: order("POLYMARKET", "NO", "poly"),
      predictResult: result("PREDICT", "10"),
      polymarketResult: result("POLYMARKET", "0"),
      policy,
      nowMs: 1000,
      firstUnhedgedAtMs: 500,
      polymarketRescueLimitPrice: d("0.60")
    });

    expect(decision.action).toBe("PAUSE_NEW_OPENINGS");
    expect(decision.pause).toBe(true);
    expect(decision.reasons).toContain("rescue_max_loss_usd would be exceeded");
  });

  it("uses next READY Predict account for Predict-side residual rescue", () => {
    const rotator = new PredictAccountRotator([
      predictAccount({ accountId: "p1", address: "0x1", availableBalance: "100", status: "HELD_OPEN" }),
      predictAccount({ accountId: "p2", address: "0x2", availableBalance: "100" })
    ]);
    const decision = rescueResidual({
      hedgeId: "h1",
      predictOrder: order("PREDICT", "YES", "p1"),
      polymarketOrder: order("POLYMARKET", "NO", "poly"),
      predictResult: result("PREDICT", "0"),
      polymarketResult: result("POLYMARKET", "5"),
      policy,
      predictRotator: rotator,
      nowMs: 1000,
      firstUnhedgedAtMs: 500
    });

    expect(decision.action).toBe("BUY_PREDICT_COMPLEMENT_NEXT_ACCOUNT");
    expect(decision.predictAccountId).toBe("p2");
    expect(decision.rescueOrder?.accountId).toBe("p2");
  });

  it("pauses if unhedged residual exceeds max_unhedged_seconds", () => {
    const decision = rescueResidual({
      hedgeId: "h1",
      predictOrder: order("PREDICT", "YES", "p1"),
      polymarketOrder: order("POLYMARKET", "NO", "poly"),
      predictResult: result("PREDICT", "1"),
      polymarketResult: result("POLYMARKET", "0"),
      policy,
      nowMs: 5000,
      firstUnhedgedAtMs: 0
    });

    expect(decision.action).toBe("PAUSE_NEW_OPENINGS");
    expect(decision.pause).toBe(true);
  });
});
