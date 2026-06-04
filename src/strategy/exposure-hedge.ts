import {
  calculatePredictExposure,
  type PredictPosition,
} from "../hedge/exposure-calculator.js";
import { ZERO } from "../domain/money.js";
import {
  planExposureHedges,
  type HedgeCandidateMarket,
  type HedgePlan,
  type RawHedgeConfig,
} from "../hedge/hedge-planner.js";
import type { StrategyDecision } from "./types.js";

export interface ExposureHedgeInput {
  predictPositions?: PredictPosition[];
  candidates?: HedgeCandidateMarket[];
  config?: RawHedgeConfig;
  nowMs?: number;
}

export type ExposureHedgePlan = HedgePlan[];

export function buildExposureHedgePlan(input: ExposureHedgeInput): HedgePlan[] {
  const exposures = calculatePredictExposure(input.predictPositions ?? []);

  return planExposureHedges(
    exposures,
    input.candidates ?? [],
    input.config,
    input.nowMs,
  );
}

export type ExposureHedgeStrategyInput = ExposureHedgeInput;

export class ExposureHedgeStrategy {
  buildPlan(input: ExposureHedgeStrategyInput): ExposureHedgePlan {
    return buildExposureHedgePlan(input);
  }

  evaluate(input: ExposureHedgeStrategyInput = {}): StrategyDecision {
    const plans = this.buildPlan(input);
    const rejected = plans.some((plan) => Boolean(plan.rejectReason));

    return {
      accepted: !rejected,
      mode: "exposure_hedge",
      reasons: rejected ? ["EXPOSURE_HEDGE_REJECTED"] : [],
      plan: {
        mode: "exposure_hedge",
        action: "EXPOSURE_HEDGE",
        legs: [],
        expectedNetExposureUsd: ZERO,
        expectedProfitAfterHedgeFee: ZERO,
        metadata: { exposureHedge: plans },
      },
    };
  }

  build(input: ExposureHedgeStrategyInput): ExposureHedgePlan {
    return this.buildPlan(input);
  }

  plan(input: ExposureHedgeStrategyInput): ExposureHedgePlan {
    return this.buildPlan(input);
  }
}

export {
  calculatePredictExposure,
  planExposureHedges,
  type HedgeCandidateMarket,
  type HedgePlan,
  type PredictPosition,
  type RawHedgeConfig,
};
