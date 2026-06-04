import { buildExposureHedgePlan, type HedgeRequest } from "../hedge/hedge-planner.js";
import { ZERO } from "../domain/money.js";
import { type StrategyDecision } from "./types.js";

export type ExposureHedgeStrategyInput = Partial<HedgeRequest>;

export class ExposureHedgeStrategy {
  evaluate(input: ExposureHedgeStrategyInput): StrategyDecision {
    if (!input.exposures || !input.candidates || !input.config || input.nowMs === undefined) {
      return rejected("EXPOSURE_HEDGE_INVALID_INPUT", "missing exposure hedge request fields");
    }

    const hedgePlan = buildExposureHedgePlan({
      exposures: input.exposures,
      candidates: input.candidates,
      config: input.config,
      nowMs: input.nowMs
    });
    const accepted = hedgePlan.hedgeOrder !== undefined && hedgePlan.rejectReason === undefined;

    return {
      accepted,
      mode: "exposure_hedge",
      reasons: accepted ? [] : ["EXPOSURE_HEDGE_REJECTED"],
      plan: {
        mode: "exposure_hedge",
        action: "EXPOSURE_HEDGE",
        legs: [],
        expectedNetExposureUsd: hedgePlan.exposureAfterUsd,
        expectedProfitAfterHedgeFee: ZERO,
        metadata: { exposureHedge: hedgePlan }
      }
    };
  }
}

function rejected(reason: "EXPOSURE_HEDGE_INVALID_INPUT", message: string): StrategyDecision {
  return {
    accepted: false,
    mode: "exposure_hedge",
    reasons: [reason],
    plan: {
      mode: "exposure_hedge",
      action: "PAUSE_NEW_OPENINGS",
      legs: [],
      expectedNetExposureUsd: ZERO,
      expectedProfitAfterHedgeFee: ZERO,
      metadata: { rejectReason: message }
    }
  };
}
