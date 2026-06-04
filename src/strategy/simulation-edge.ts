import { minD, ZERO, type D } from "../domain/money.js";
import { type MarketState, type StrategyDecision } from "./types.js";

export interface SimulationEdgeConfig {
  sigma: number;
  minEdge: number;
  maxOrderUsd: D;
  paths?: number;
  rng?: () => number;
}

export interface SimulationEdgePlan {
  executable: boolean;
  marketId: string;
  side?: "YES" | "NO";
  limitPrice?: number;
  sizeUsd?: D;
  fairProbability: number;
  conservativeEdge: number;
  rejectReason?: string;
  ci95: [number, number];
}

export function monteCarloProbability(
  s0: number,
  strike: number,
  sigma: number,
  timeYears: number,
  paths = 100_000,
  rng: () => number = Math.random
): { pHat: number; ci95: [number, number] } {
  assertPositiveFinite("s0", s0);
  assertPositiveFinite("strike", strike);
  assertPositiveFinite("sigma", sigma);
  assertPositiveFinite("timeYears", timeYears);
  if (!Number.isInteger(paths) || paths <= 0) throw new Error("paths must be a positive integer");

  let wins = 0;
  const drift = -0.5 * sigma ** 2 * timeYears;
  const vol = sigma * Math.sqrt(timeYears);
  for (let index = 0; index < paths; index += 1) {
    const z = randNormal(rng);
    const terminal = s0 * Math.exp(drift + vol * z);
    if (terminal >= strike) wins += 1;
  }

  const pHat = wins / paths;
  const se = Math.sqrt((pHat * (1 - pHat)) / paths);
  return {
    pHat,
    ci95: [clamp01(pHat - 1.96 * se), clamp01(pHat + 1.96 * se)]
  };
}

export function simulationEdgeStrategy(market: MarketState, config: SimulationEdgeConfig): SimulationEdgePlan {
  validateMarketState(market);
  assertPositiveFinite("sigma", config.sigma);
  assertNonNegativeFinite("minEdge", config.minEdge);
  assertPositiveDecimal("maxOrderUsd", config.maxOrderUsd);

  const strike = market.strikePrice ?? market.midPrice;
  const timeYears = market.timeToExpirySec / (365 * 24 * 60 * 60);
  const { pHat, ci95 } = monteCarloProbability(
    market.midPrice,
    strike,
    config.sigma,
    timeYears,
    config.paths ?? 100_000,
    config.rng ?? Math.random
  );
  const [lower95, upper95] = ci95;
  const edgeYes = lower95 - market.bestAsk;
  const edgeNo = 1 - upper95 - market.bestBid;
  const conservativeEdge = Math.max(edgeYes, edgeNo);
  const plan: SimulationEdgePlan = {
    executable: false,
    marketId: market.marketId,
    fairProbability: pHat,
    conservativeEdge,
    ci95
  };

  if (edgeYes >= config.minEdge) {
    return {
      ...plan,
      side: "YES",
      limitPrice: market.bestAsk,
      sizeUsd: minD(config.maxOrderUsd, market.depthUsd)
    };
  }
  if (edgeNo >= config.minEdge) {
    return {
      ...plan,
      side: "NO",
      limitPrice: market.bestBid,
      sizeUsd: minD(config.maxOrderUsd, market.depthUsd)
    };
  }

  return {
    ...plan,
    rejectReason: "No conservative edge"
  };
}

export class SimulationEdgeStrategy {
  evaluate(input: { market?: MarketState; config?: SimulationEdgeConfig }): StrategyDecision {
    if (!input.market || !input.config) {
      return rejected("SIMULATION_EDGE_INVALID_INPUT", "missing simulation market/config");
    }
    try {
      const signal = simulationEdgeStrategy(input.market, input.config);
      if (!signal.side) {
        return {
          ...rejected("SIMULATION_EDGE_NO_SIGNAL", signal.rejectReason ?? "No conservative edge"),
          plan: {
            mode: "simulation_edge",
            action: "SIMULATION_EDGE_SIGNAL",
            legs: [],
            expectedNetExposureUsd: ZERO,
            expectedProfitAfterHedgeFee: ZERO,
            metadata: { simulationEdge: signal }
          }
        };
      }

      return {
        accepted: true,
        mode: "simulation_edge",
        reasons: [],
        plan: {
          mode: "simulation_edge",
          action: "SIMULATION_EDGE_SIGNAL",
          legs: [],
          expectedNetExposureUsd: ZERO,
          expectedProfitAfterHedgeFee: ZERO,
          metadata: { simulationEdge: signal }
        }
      };
    } catch (error) {
      return rejected("SIMULATION_EDGE_INVALID_INPUT", error instanceof Error ? error.message : "invalid simulation input");
    }
  }
}

function randNormal(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function validateMarketState(market: MarketState): void {
  if (!market.marketId) throw new Error("marketId is required");
  assertPositiveFinite("midPrice", market.midPrice);
  if (market.strikePrice !== undefined) assertPositiveFinite("strikePrice", market.strikePrice);
  assertProbability("bestAsk", market.bestAsk);
  assertProbability("bestBid", market.bestBid);
  assertPositiveFinite("timeToExpirySec", market.timeToExpirySec);
  assertPositiveDecimal("depthUsd", market.depthUsd);
}

function assertProbability(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be in [0, 1]`);
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive and finite`);
}

function assertNonNegativeFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative and finite`);
}

function assertPositiveDecimal(name: string, value: D): void {
  if (!value.isFinite() || value.lte(0)) throw new Error(`${name} must be positive and finite`);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function rejected(reason: "SIMULATION_EDGE_NO_SIGNAL" | "SIMULATION_EDGE_INVALID_INPUT", message: string): StrategyDecision {
  return {
    accepted: false,
    mode: "simulation_edge",
    reasons: [reason],
    plan: {
      mode: "simulation_edge",
      action: "PAUSE_NEW_OPENINGS",
      legs: [],
      expectedNetExposureUsd: ZERO,
      expectedProfitAfterHedgeFee: ZERO,
      metadata: { rejectReason: message }
    }
  };
}
