import { ZERO } from "../domain/money.js";
import { type StrategyDecision } from "./types.js";

export function stopLossHedgeNotImplemented(): StrategyDecision {
  return {
    accepted: false,
    mode: "exposure_hedge",
    reasons: ["STRATEGY_MODE_NOT_IMPLEMENTED"],
    plan: {
      mode: "exposure_hedge",
      action: "PAUSE_NEW_OPENINGS",
      legs: [],
      expectedNetExposureUsd: ZERO,
      expectedProfitAfterHedgeFee: ZERO
    }
  };
}
