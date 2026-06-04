import { describe, expect, it } from "vitest";
import { d, ZERO } from "../../src/domain/money.js";
import {
  buildSimpleMarketMakerPlan,
  buildSimpleMarketMakerSignal,
  defaultSimpleMarketMakerConfig,
  type SimpleMarketMakerConfig,
  type SimpleMarketMakerMarketState,
  type SimpleMarketMakerPlan
} from "../../src/strategy/simple-market-maker.js";
import { StrategyEngine } from "../../src/strategy/strategy-engine.js";
import { type StrategyConfig } from "../../src/strategy/types.js";

const NOW_MS = 1_700_000_000_000;

describe("simple market maker", () => {
  it("generates dry-run YES and NO post-only quote plans by default", () => {
    const plan = buildSimpleMarketMakerSignal({
      market: market(),
      inventory: { yesUsd: ZERO, noUsd: ZERO },
      config: config(),
      nowMs: NOW_MS
    });

    expect(plan.executable).toBe(false);
    expect(plan.rejectReason).toBe("dry_run_only");
    expect(plan.orders.map((order) => `${order.side}:${order.outcome}:${order.syntheticRole}`)).toEqual([
      "BUY:YES:YES_BID",
      "BUY:NO:YES_ASK_VIA_BUY_NO"
    ]);
    expect(plan.orders.every((order) => order.postOnly)).toBe(true);
    expect(plan.lockedEdgeIfBothFilled).toBeGreaterThan(0);
    expect(plan.bidNo).toBeCloseTo(1 - plan.askYes, 10);
    expect(plan.risk.reasonCodes).toContain("DRY_RUN_ONLY");
  });

  it("can mark plans executable only when liveTradingEnabled is true", () => {
    const plan = buildSimpleMarketMakerSignal({
      market: market(),
      inventory: { yesUsd: ZERO, noUsd: ZERO },
      config: config({ liveTradingEnabled: true }),
      nowMs: NOW_MS
    });

    expect(plan.executable).toBe(true);
    expect(plan.rejectReason).toBeUndefined();
    expect(plan.orders).toHaveLength(2);
  });

  it("rejects stale market data", () => {
    const decision = buildSimpleMarketMakerPlan({
      market: market({ timestampMs: NOW_MS - 10_000 }),
      inventory: { yesUsd: ZERO, noUsd: ZERO },
      config: config({ maxMarketDataAgeMs: 2000 }),
      nowMs: NOW_MS
    });
    const signal = decision.plan?.metadata?.simpleMarketMaker as SimpleMarketMakerPlan | undefined;

    expect(decision.accepted).toBe(false);
    expect(decision.reasons).toContain("SIMPLE_MARKET_MAKER_REJECTED");
    expect(signal?.rejectReason).toBe("stale_market_data");
    expect(signal?.risk.reasonCodes).toContain("REJECT_STALE_MARKET_DATA");
    expect(signal?.orders).toHaveLength(0);
  });

  it("only quotes NO when YES inventory is at the configured cap", () => {
    const plan = buildSimpleMarketMakerSignal({
      market: market(),
      inventory: { yesUsd: d("25"), noUsd: ZERO },
      config: config({ maxInventoryUsd: d("25") }),
      nowMs: NOW_MS
    });

    expect(plan.orders.map((order) => order.outcome)).toEqual(["NO"]);
    expect(plan.risk.reasonCodes).toContain("YES_INVENTORY_AT_CAP");
  });

  it("rejects observed spreads that are too wide", () => {
    const decision = buildSimpleMarketMakerPlan({
      market: market({ bestBidYes: 0.3, bestAskYes: 0.5 }),
      inventory: { yesUsd: ZERO, noUsd: ZERO },
      config: config({ maxQuoteSpread: 0.08 }),
      nowMs: NOW_MS
    });
    const signal = decision.plan?.metadata?.simpleMarketMaker as SimpleMarketMakerPlan | undefined;

    expect(decision.accepted).toBe(false);
    expect(signal?.rejectReason).toBe("observed_spread_too_wide");
    expect(signal?.risk.reasonCodes).toContain("REJECT_OBSERVED_SPREAD_TOO_WIDE");
  });

  it("registers simple_market_maker through StrategyEngine as a signal-only action", () => {
    const decision = new StrategyEngine().evaluate({
      config: strategyConfig(),
      simpleMarketMaker: {
        market: market(),
        inventory: { yesUsd: ZERO, noUsd: ZERO },
        config: config(),
        nowMs: NOW_MS
      }
    });
    const signal = decision.plan?.metadata?.simpleMarketMaker as SimpleMarketMakerPlan | undefined;

    expect(decision.accepted).toBe(true);
    expect(decision.plan?.action).toBe("SIMPLE_MARKET_MAKER_QUOTES");
    expect(signal?.executable).toBe(false);
    expect(signal?.orders).toHaveLength(2);
  });
});

function market(overrides: Partial<SimpleMarketMakerMarketState> = {}): SimpleMarketMakerMarketState {
  return {
    marketId: "btc-1h",
    venue: "polymarket",
    bestBidYes: 0.49,
    bestAskYes: 0.51,
    depthUsd: d("50"),
    timestampMs: NOW_MS,
    spotPrice: 101,
    strikePrice: 100,
    timeToExpirySec: 1800,
    ...overrides
  };
}

function config(overrides: Partial<SimpleMarketMakerConfig> = {}): SimpleMarketMakerConfig {
  return {
    ...defaultSimpleMarketMakerConfig(),
    nPaths: 2500,
    rng: seededRng(7),
    ...overrides
  };
}

function strategyConfig(): StrategyConfig {
  return {
    strategyMode: "simple_market_maker",
    hedgeEnabled: false,
    maxNetExposureUsd: ZERO,
    maxPredictUsagePct: d("0.30"),
    minProfitAfterHedgeFee: ZERO
  };
}

function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
