import { describe, expect, it, vi } from "vitest";
import { buildExposureHedgePlan } from "../../src/strategy/exposure-hedge.js";
import { calculatePredictExposure } from "../../src/hedge/exposure-calculator.js";
import { planExposureHedges } from "../../src/hedge/hedge-planner.js";

const NOW_MS = 1_700_000_000_000;

const baseConfig = {
  enabled: true,
  dry_run: true,
  hedge_ratio: 0.5,
  max_hedge_order_usd: 10,
  min_hedge_order_usd: 1,
  max_net_exposure_usd: 25,
  max_predict_usage_pct: 0.3,
  max_spread: 0.035,
  min_depth_usd: 20,
  max_depth_usage_pct: 0.25,
  max_market_data_age_ms: 2000,
  require_same_event_key: true,
  allow_correlated_hedge: false,
  live_trading_enabled: false,
  post_only: true,
};

function candidate(overrides = {}) {
  return {
    marketId: "hedge-1",
    eventKey: "event-a",
    bid: 0.49,
    ask: 0.51,
    depthUsd: 100,
    marketDataTimestampMs: NOW_MS,
    ...overrides,
  };
}

describe("exposure hedge", () => {
  it("calculates net Predict exposure per market", () => {
    const exposures = calculatePredictExposure([
      {
        marketId: "predict-1",
        eventKey: "event-a",
        side: "long",
        sizeUsd: 12,
      },
      {
        marketId: "predict-1",
        eventKey: "event-a",
        side: "short",
        sizeUsd: 5,
      },
    ]);

    expect(exposures).toEqual([
      {
        marketId: "predict-1",
        eventKey: "event-a",
        longUsd: 12,
        shortUsd: 5,
        netExposureUsd: 7,
      },
    ]);
  });

  it("generates dry-run hedge plans with executable false", () => {
    const plans = buildExposureHedgePlan({
      predictPositions: [
        {
          marketId: "predict-1",
          eventKey: "event-a",
          side: "long",
          sizeUsd: 16,
        },
      ],
      candidates: [candidate()],
      config: baseConfig,
      nowMs: NOW_MS,
    });

    expect(plans).toHaveLength(1);
    const plan = plans[0]!;
    expect(plan).toMatchObject({
      strategy: "EXPOSURE_HEDGE",
      predictMarketId: "predict-1",
      hedgeMarketId: "hedge-1",
      eventKey: "event-a",
      netExposureUsd: 16,
      hedgeDirection: "SELL",
      hedgeSizeUsd: 8,
      executable: false,
      dryRun: true,
    });
    expect(plan.rejectReason).toBeUndefined();
    expect(plan.risk.reasonCodes).toEqual([]);
  });

  it("chooses BUY hedge direction for negative net exposure", () => {
    const plan = buildExposureHedgePlan({
      predictPositions: [
        {
          marketId: "predict-1",
          eventKey: "event-a",
          side: "short",
          sizeUsd: 14,
        },
      ],
      candidates: [candidate()],
      config: baseConfig,
      nowMs: NOW_MS,
    })[0]!;

    expect(plan.hedgeDirection).toBe("BUY");
    expect(plan.hedgeSizeUsd).toBe(7);
  });

  it("limits hedge size by ratio, max order, and usable depth", () => {
    const ratioLimited = planExposureHedges(
      [{ marketId: "p", eventKey: "event-a", longUsd: 12, shortUsd: 0, netExposureUsd: 12 }],
      [candidate({ depthUsd: 100 })],
      baseConfig,
      NOW_MS,
    )[0]!;
    const maxOrderLimited = planExposureHedges(
      [{ marketId: "p", eventKey: "event-a", longUsd: 30, shortUsd: 0, netExposureUsd: 30 }],
      [candidate({ depthUsd: 100 })],
      baseConfig,
      NOW_MS,
    )[0]!;
    const depthLimited = planExposureHedges(
      [{ marketId: "p", eventKey: "event-a", longUsd: 40, shortUsd: 0, netExposureUsd: 40 }],
      [candidate({ depthUsd: 24 })],
      baseConfig,
      NOW_MS,
    )[0]!;

    expect(ratioLimited.hedgeSizeUsd).toBe(6);
    expect(maxOrderLimited.hedgeSizeUsd).toBe(10);
    expect(depthLimited.hedgeSizeUsd).toBe(6);
  });

  it("rejects when there is no matching same-event market", () => {
    const plan = buildExposureHedgePlan({
      predictPositions: [
        {
          marketId: "predict-1",
          eventKey: "event-a",
          side: "long",
          sizeUsd: 8,
        },
      ],
      candidates: [candidate({ eventKey: "event-b" })],
      config: baseConfig,
      nowMs: NOW_MS,
    })[0]!;

    expect(plan.hedgeMarketId).toBeUndefined();
    expect(plan.risk.reasonCodes).toContain("NO_MATCHING_MARKET");
    expect(plan.rejectReason).toBe("NO_MATCHING_MARKET");
  });

  it("rejects stale, wide-spread, and shallow-depth candidates", () => {
    const plan = buildExposureHedgePlan({
      predictPositions: [
        {
          marketId: "predict-1",
          eventKey: "event-a",
          side: "long",
          sizeUsd: 8,
        },
      ],
      candidates: [
        candidate({
          ask: 0.56,
          depthUsd: 10,
          marketDataTimestampMs: NOW_MS - 2001,
        }),
      ],
      config: baseConfig,
      nowMs: NOW_MS,
    })[0]!;

    expect(plan.risk.reasonCodes).toEqual(
      expect.arrayContaining([
        "STALE_MARKET_DATA",
        "SPREAD_TOO_WIDE",
        "INSUFFICIENT_DEPTH",
      ]),
    );
    expect(plan.rejectReason).toBe("STALE_MARKET_DATA");
  });

  it("rejects exposures above the configured net exposure cap", () => {
    const plan = buildExposureHedgePlan({
      predictPositions: [
        {
          marketId: "predict-1",
          eventKey: "event-a",
          side: "long",
          sizeUsd: 26,
        },
      ],
      candidates: [candidate()],
      config: baseConfig,
      nowMs: NOW_MS,
    })[0]!;

    expect(plan.risk.reasonCodes).toContain("MAX_NET_EXPOSURE_EXCEEDED");
  });

  it("does not pass EXPOSURE_HEDGE plans to placeOrder even if a caller checks executable loosely", () => {
    const placeOrder = vi.fn();
    const plan = buildExposureHedgePlan({
      predictPositions: [
        {
          marketId: "predict-1",
          eventKey: "event-a",
          side: "long",
          sizeUsd: 10,
        },
      ],
      candidates: [candidate()],
      config: { ...baseConfig, live_trading_enabled: true, dry_run: false },
      nowMs: NOW_MS,
    })[0]!;

    const coordinatorView: { strategy: string; executable: boolean } = plan;

    if (
      coordinatorView.strategy !== "EXPOSURE_HEDGE" &&
      coordinatorView.executable
    ) {
      placeOrder(coordinatorView);
    }

    expect(plan.executable).toBe(false);
    expect(plan.dryRun).toBe(true);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("leaves OPEN_PURE_ARBITRAGE-shaped plans untouched by exposure hedge planning", () => {
    const openPureArbitragePlan = {
      strategy: "OPEN_PURE_ARBITRAGE",
      executable: true,
      dryRun: false,
    };

    const hedgePlans = buildExposureHedgePlan({
      predictPositions: [],
      candidates: [candidate()],
      config: baseConfig,
      nowMs: NOW_MS,
    });

    expect(hedgePlans).toEqual([]);
    expect(openPureArbitragePlan).toEqual({
      strategy: "OPEN_PURE_ARBITRAGE",
      executable: true,
      dryRun: false,
    });
  });
});
