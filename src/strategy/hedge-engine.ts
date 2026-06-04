import { complementOutcome } from "../domain/models.js";
import { ZERO } from "../domain/money.js";
import { type StrategyConfig, type StrategyDecision, type StrategyPlan, type StrategyRejectReason } from "./types.js";
import { type StrategyRiskResult } from "./risk-hedge.js";

export interface PureArbitragePlanInput {
  config: StrategyConfig;
  risk: StrategyRiskResult;
  sizing?: StrategyPlan["sizing"];
  predictAccountId?: string;
}

export class HedgeEngine {
  buildPureArbitragePlan(input: PureArbitragePlanInput): StrategyDecision {
    if (input.config.strategyMode !== "pure_arbitrage") {
      return reject(input.config.strategyMode, ["STRATEGY_MODE_NOT_IMPLEMENTED"]);
    }
    if (!input.risk.accepted || !input.sizing?.quote) {
      return reject("pure_arbitrage", input.risk.reasons.length > 0 ? input.risk.reasons : ["NO_EXECUTABLE_ARBITRAGE"]);
    }

    const quote = input.sizing.quote;
    const polymarketOutcome = complementOutcome(quote.predictLeg.outcome);
    const plan: StrategyPlan = {
      mode: "pure_arbitrage",
      action: "OPEN_PURE_ARBITRAGE",
      sizing: input.sizing,
      predictAccountId: input.predictAccountId,
      legs: [
        {
          venue: "PREDICT",
          outcome: quote.predictLeg.outcome,
          action: "BUY",
          shares: quote.shares,
          maxCostUsd: quote.predictLeg.totalCost
        },
        {
          venue: "POLYMARKET",
          outcome: polymarketOutcome,
          action: "BUY",
          shares: quote.shares,
          maxCostUsd: quote.polymarketLeg.totalCost
        }
      ],
      expectedNetExposureUsd: input.risk.expectedNetExposureUsd,
      expectedProfitAfterHedgeFee: input.risk.expectedProfitAfterHedgeFee
    };

    return {
      accepted: true,
      mode: "pure_arbitrage",
      plan,
      reasons: []
    };
  }
}

function reject(mode: StrategyDecision["mode"], reasons: readonly StrategyRejectReason[]): StrategyDecision {
  return {
    accepted: false,
    mode,
    reasons,
    plan: {
      mode,
      action: "PAUSE_NEW_OPENINGS",
      legs: [],
      expectedNetExposureUsd: ZERO,
      expectedProfitAfterHedgeFee: ZERO
    }
  };
}
