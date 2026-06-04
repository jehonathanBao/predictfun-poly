import { describe, expect, it } from "vitest";
import { ArbEngine, defaultRiskConfig } from "../../src/core/arb-engine.js";
import { OrderBook } from "../../src/core/types.js";
import { d } from "../../src/core/decimal.js";
import { StrategyEngine } from "../../src/strategy/strategy-engine.js";
import { simulationEdgeStrategy, type SimulationEdgePlan } from "../../src/strategy/simulation-edge.js";
import { type StrategyConfig } from "../../src/strategy/types.js";

function config(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    strategyMode: "pure_arbitrage",
    hedgeEnabled: false,
    maxNetExposureUsd: d("0.00"),
    maxPredictUsagePct: d("0.30"),
    minProfitAfterHedgeFee: d("0.00"),
    ...overrides
  };
}

function book(askPrice: string): OrderBook {
  return new OrderBook({
    bids: [{ price: d("0.01"), size: d("20") }],
    asks: [{ price: d(askPrice), size: d("20") }],
    decimalPrecision: 3
  });
}

function sizing() {
  const engine = new ArbEngine({
    ...defaultRiskConfig,
    predictSlippageBps: d(0),
    polymarketSlippageBps: d(0),
    latencyBufferBps: d(0)
  });
  return engine.sizeComboA({
    predictYesBook: book("0.20"),
    polymarketNoBook: book("0.50"),
    feeRates: { predictFeeRateBps: 0, polymarketFeeRateBps: 0 },
    limits: {
      selectedPredictFreeBalance: d("100"),
      polymarketAvailableCollateral: d("100")
    }
  });
}

describe("StrategyEngine", () => {
  it("builds a pure arbitrage plan with two complementary buy legs", () => {
    const decision = new StrategyEngine().evaluate({
      config: config(),
      pureArbitrage: {
        sizing: sizing(),
        predictAccountId: "p1",
        selectedPredictFreeBalance: d("100")
      }
    });

    expect(decision.accepted).toBe(true);
    expect(decision.plan?.action).toBe("OPEN_PURE_ARBITRAGE");
    expect(decision.plan?.legs).toHaveLength(2);
    expect(decision.plan?.legs.map((leg) => `${leg.venue}:${leg.outcome}`)).toEqual(["PREDICT:YES", "POLYMARKET:NO"]);
  });

  it("rejects opportunities that fail min_profit_after_hedge_fee", () => {
    const decision = new StrategyEngine().evaluate({
      config: config({ minProfitAfterHedgeFee: d("100.00") }),
      pureArbitrage: {
        sizing: sizing(),
        predictAccountId: "p1",
        selectedPredictFreeBalance: d("100")
      }
    });

    expect(decision.accepted).toBe(false);
    expect(decision.reasons).toContain("NO_PROFIT_AFTER_HEDGE_FEE");
  });

  it("does not execute future hedge modes before implementation", () => {
    const decision = new StrategyEngine().evaluate({
      config: config({ strategyMode: "exposure_hedge", hedgeEnabled: true })
    });

    expect(decision.accepted).toBe(false);
    expect(decision.reasons).toContain("STRATEGY_MODE_NOT_IMPLEMENTED");
  });

  it("registers simulation_edge as a dry-run signal strategy", () => {
    const decision = new StrategyEngine().evaluate({
      config: config({ strategyMode: "simulation_edge" }),
      simulationEdge: {
        market: {
          marketId: "sim-1",
          midPrice: 120,
          strikePrice: 100,
          bestAsk: 0.55,
          bestBid: 0.45,
          timeToExpirySec: 3600,
          depthUsd: d("50")
        },
        config: {
          sigma: 0.2,
          minEdge: 0.01,
          maxOrderUsd: d("10"),
          paths: 2000,
          rng: seededRng(1)
        }
      }
    });
    const signal = decision.plan?.metadata?.simulationEdge as SimulationEdgePlan | undefined;

    expect(decision.accepted).toBe(true);
    expect(decision.plan?.action).toBe("SIMULATION_EDGE_SIGNAL");
    expect(signal?.executable).toBe(false);
    expect(signal?.side).toBe("YES");
    expect(signal?.sizeUsd?.toString()).toBe("10");
  });
});

describe("simulationEdgeStrategy", () => {
  it("returns no signal when conservative edge is too small", () => {
    const signal = simulationEdgeStrategy(
      {
        marketId: "flat",
        midPrice: 100,
        strikePrice: 100,
        bestAsk: 0.99,
        bestBid: 0.99,
        timeToExpirySec: 3600,
        depthUsd: d("20")
      },
      {
        sigma: 0.2,
        minEdge: 0.01,
        maxOrderUsd: d("10"),
        paths: 2000,
        rng: seededRng(2)
      }
    );

    expect(signal.executable).toBe(false);
    expect(signal.side).toBeUndefined();
    expect(signal.rejectReason).toBe("No conservative edge");
  });
});

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
