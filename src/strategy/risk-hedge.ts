import { type SizingResult } from "../arb/engine.js";
import { d, ZERO, type D, type Decimalish } from "../domain/money.js";
import { type NetExposureSnapshot, type StrategyConfig, type StrategyRejectReason } from "./types.js";

export interface StrategyRiskInput {
  config: StrategyConfig;
  sizing?: SizingResult;
  selectedPredictFreeBalance?: Decimalish;
  netExposure?: NetExposureSnapshot;
}

export interface StrategyRiskResult {
  accepted: boolean;
  reasons: readonly StrategyRejectReason[];
  expectedNetExposureUsd: D;
  expectedProfitAfterHedgeFee: D;
}

export class StrategyRiskEngine {
  evaluatePureArbitrage(input: StrategyRiskInput): StrategyRiskResult {
    const reasons: StrategyRejectReason[] = [];
    const quote = input.sizing?.quote;
    if (!input.sizing?.executable || !quote) {
      reasons.push("NO_EXECUTABLE_ARBITRAGE");
    }

    const expectedProfitAfterHedgeFee = quote?.netProfitUsd ?? ZERO;
    if (expectedProfitAfterHedgeFee.lte(input.config.minProfitAfterHedgeFee)) {
      reasons.push("NO_PROFIT_AFTER_HEDGE_FEE");
    }

    if (quote && input.selectedPredictFreeBalance !== undefined) {
      const maxPredictUsage = d(input.selectedPredictFreeBalance).mul(input.config.maxPredictUsagePct);
      if (quote.predictLeg.totalCost.gt(maxPredictUsage)) {
        reasons.push("PREDICT_USAGE_EXCEEDS_STRATEGY_CAP");
      }
    }

    const expectedNetExposureUsd = estimateNetExposure(input.netExposure);
    if (expectedNetExposureUsd.gt(input.config.maxNetExposureUsd)) {
      reasons.push("NET_EXPOSURE_LIMIT_EXCEEDED");
    }

    return {
      accepted: reasons.length === 0,
      reasons: [...new Set(reasons)],
      expectedNetExposureUsd,
      expectedProfitAfterHedgeFee
    };
  }
}

function estimateNetExposure(snapshot: NetExposureSnapshot | undefined): D {
  if (!snapshot) return ZERO;
  return snapshot.yesExposureUsd.minus(snapshot.noExposureUsd).abs();
}
