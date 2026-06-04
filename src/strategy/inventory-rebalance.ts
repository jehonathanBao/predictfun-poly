import { ZERO } from "../domain/money.js";
import { type StrategyDecision } from "./types.js";

export function inventoryRebalanceNotImplemented(): StrategyDecision {
  return {
    accepted: false,
    mode: "rebalance_only",
    reasons: ["STRATEGY_MODE_NOT_IMPLEMENTED"],
    plan: {
      mode: "rebalance_only",
      action: "PAUSE_NEW_OPENINGS",
      legs: [],
      expectedNetExposureUsd: ZERO,
      expectedProfitAfterHedgeFee: ZERO
    }
  };
}
