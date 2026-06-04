import { type SizingResult } from "../arb/engine.js";
import { type Outcome, type Venue } from "../domain/models.js";
import { type D } from "../domain/money.js";

export type StrategyMode =
  | "pure_arbitrage"
  | "hedge_arbitrage"
  | "exposure_hedge"
  | "rebalance_only"
  | "simulation_edge"
  | "simple_market_maker";

export interface StrategyConfig {
  strategyMode: StrategyMode;
  hedgeEnabled: boolean;
  maxNetExposureUsd: D;
  maxPredictUsagePct: D;
  minProfitAfterHedgeFee: D;
}

export type StrategyActionType =
  | "OPEN_PURE_ARBITRAGE"
  | "OPEN_HEDGE_ARBITRAGE"
  | "HEDGE_EXISTING_EXPOSURE"
  | "REBALANCE_INVENTORY"
  | "EXPOSURE_HEDGE"
  | "SIMULATION_EDGE_SIGNAL"
  | "SIMPLE_MARKET_MAKER_QUOTES"
  | "PAUSE_NEW_OPENINGS";

export type StrategyRejectReason =
  | "STRATEGY_MODE_NOT_IMPLEMENTED"
  | "HEDGE_DISABLED"
  | "NO_EXECUTABLE_ARBITRAGE"
  | "NO_PROFIT_AFTER_HEDGE_FEE"
  | "PREDICT_USAGE_EXCEEDS_STRATEGY_CAP"
  | "NET_EXPOSURE_LIMIT_EXCEEDED"
  | "EXPOSURE_HEDGE_REJECTED"
  | "EXPOSURE_HEDGE_INVALID_INPUT"
  | "SIMULATION_EDGE_NO_SIGNAL"
  | "SIMULATION_EDGE_INVALID_INPUT"
  | "SIMPLE_MARKET_MAKER_REJECTED"
  | "SIMPLE_MARKET_MAKER_INVALID_INPUT";

export interface StrategyLegIntent {
  venue: Venue;
  outcome: Outcome;
  action: "BUY" | "SELL";
  maxCostUsd?: D;
  shares?: D;
}

export interface StrategyPlan {
  mode: StrategyMode;
  action: StrategyActionType;
  sizing?: SizingResult;
  predictAccountId?: string;
  legs: readonly StrategyLegIntent[];
  expectedNetExposureUsd: D;
  expectedProfitAfterHedgeFee: D;
  metadata?: Record<string, unknown>;
}

export interface StrategyDecision {
  accepted: boolean;
  mode: StrategyMode;
  plan?: StrategyPlan;
  reasons: readonly StrategyRejectReason[];
}

export interface NetExposureSnapshot {
  yesExposureUsd: D;
  noExposureUsd: D;
}

export interface MarketState {
  marketId: string;
  midPrice: number;
  strikePrice?: number;
  bestAsk: number;
  bestBid: number;
  timeToExpirySec: number;
  depthUsd: D;
}
