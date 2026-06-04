import { describe, expect, it } from "vitest";
import { buildExposureHedgePlan } from "../../src/hedge/hedge-planner.js";
import { predictExposure } from "../../src/hedge/exposure-calculator.js";
import { d } from "../../src/domain/money.js";
import { defaultHedgeConfig } from "../../src/risk/hedge-risk.js";
import { type HedgeCandidateMarket } from "../../src/hedge/hedge-market-matcher.js";

const NOW_MS = 1_700_000_000_000;

describe("hedge planner", () => {
  it("sizes hedge orders by exposure ratio, max order, and depth usage", () => {
    const plan = buildExposureHedgePlan({
      exposures: [predictExposure({ marketId: "predict-yes", eventKey: "event-1", side: "YES", sizeUsd: "100", avgPrice: 0.4, currentPrice: 0.6 })],
      candidates: [candidate({ depthUsd: d("100") })],
      config: defaultHedgeConfig({
        hedgeRatio: 0.5,
        maxHedgeOrderUsd: d("10"),
        maxDepthUsagePct: 0.25
      }),
      nowMs: NOW_MS
    });

    expect(plan.hedgeOrder?.sizeUsd.toString()).toBe("10");
    expect(plan.exposureBeforeUsd.toString()).toBe("100");
    expect(plan.exposureAfterUsd.toString()).toBe("90");
    expect(plan.estimatedHedgeCostUsd.toString()).toBe("4.2");
  });

  it("buys YES when Predict NO exposure is too high", () => {
    const plan = buildExposureHedgePlan({
      exposures: [predictExposure({ marketId: "predict-no", eventKey: "event-1", side: "NO", sizeUsd: "80", avgPrice: 0.4, currentPrice: 0.6 })],
      candidates: [candidate({ yesAsk: 0.61 })],
      config: defaultHedgeConfig(),
      nowMs: NOW_MS
    });

    expect(plan.hedgeOrder?.side).toBe("YES");
    expect(plan.hedgeOrder?.limitPrice).toBe(0.61);
  });

  it("rejects when no same-event candidate exists in v0.2", () => {
    const plan = buildExposureHedgePlan({
      exposures: [predictExposure({ marketId: "predict-yes", eventKey: "event-1", side: "YES", sizeUsd: "100", avgPrice: 0.4, currentPrice: 0.6 })],
      candidates: [candidate({ eventKey: "other-event" })],
      config: defaultHedgeConfig({ requireSameEventKey: true, allowCorrelatedHedge: false }),
      nowMs: NOW_MS
    });

    expect(plan.hedgeOrder).toBeUndefined();
    expect(plan.rejectReason).toBe("no_matching_hedge_market");
  });

  it("rejects stale, wide, shallow, and too-small hedge plans with reason codes", () => {
    const plan = buildExposureHedgePlan({
      exposures: [predictExposure({ marketId: "predict-yes", eventKey: "event-1", side: "YES", sizeUsd: "30", avgPrice: 0.4, currentPrice: 0.6 })],
      candidates: [
        candidate({
          timestampMs: NOW_MS - 10_000,
          spread: 0.1,
          depthUsd: d("5")
        })
      ],
      config: defaultHedgeConfig({
        minDepthUsd: d("20"),
        minHedgeOrderUsd: d("10"),
        maxDepthUsagePct: 0.25,
        maxMarketDataAgeMs: 2000,
        maxSpread: 0.035
      }),
      nowMs: NOW_MS
    });

    expect(plan.rejectReason).toBe("stale_market_data");
    expect(plan.risk.reasonCodes).toEqual(
      expect.arrayContaining(["STALE_MARKET_DATA", "SPREAD_TOO_WIDE", "INSUFFICIENT_DEPTH", "HEDGE_SIZE_BELOW_MIN"])
    );
  });

  it("rejects live hedge flags in v0.2 instead of allowing execution", () => {
    const plan = buildExposureHedgePlan({
      exposures: [predictExposure({ marketId: "predict-yes", eventKey: "event-1", side: "YES", sizeUsd: "100", avgPrice: 0.4, currentPrice: 0.6 })],
      candidates: [candidate()],
      config: defaultHedgeConfig({ liveTradingEnabled: true }),
      nowMs: NOW_MS
    });

    expect(plan.executable).toBe(false);
    expect(plan.rejectReason).toBe("live_hedge_not_supported");
    expect(plan.risk.reasonCodes).toContain("LIVE_HEDGE_NOT_SUPPORTED");
  });
});

function candidate(overrides: Partial<HedgeCandidateMarket> = {}): HedgeCandidateMarket {
  return {
    venue: "polymarket",
    marketId: "poly-event-1",
    eventKey: "event-1",
    yesAsk: 0.6,
    noAsk: 0.42,
    depthUsd: d("100"),
    spread: 0.02,
    timestampMs: NOW_MS,
    ...overrides
  };
}
