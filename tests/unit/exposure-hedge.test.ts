import { describe, expect, it } from "vitest";
import { calculateNetPredictExposure, predictExposure } from "../../src/hedge/exposure-calculator.js";
import { d } from "../../src/domain/money.js";
import { defaultHedgeConfig } from "../../src/risk/hedge-risk.js";
import { StrategyEngine } from "../../src/strategy/strategy-engine.js";
import { type StrategyConfig } from "../../src/strategy/types.js";
import { type HedgePlan } from "../../src/hedge/hedge-planner.js";

const NOW_MS = 1_700_000_000_000;

describe("exposure hedge strategy", () => {
  it("calculates Predict net exposure with YES positive and NO negative", () => {
    const net = calculateNetPredictExposure([
      predictExposure({ marketId: "p-yes", eventKey: "btc-1h", side: "YES", sizeUsd: "100", avgPrice: 0.5, currentPrice: 0.55 }),
      predictExposure({ marketId: "p-no", eventKey: "btc-1h", side: "NO", sizeUsd: "30", avgPrice: 0.5, currentPrice: 0.45 })
    ]);

    expect(net.toString()).toBe("70");
  });

  it("returns a dry-run NO hedge plan when Predict YES exposure is too high", () => {
    const decision = new StrategyEngine().evaluate({
      config: strategyConfig(),
      exposureHedge: {
        exposures: [
          predictExposure({ marketId: "predict-yes", eventKey: "btc-hour", side: "YES", sizeUsd: "100", avgPrice: 0.4, currentPrice: 0.6 })
        ],
        candidates: [
          {
            venue: "polymarket",
            marketId: "poly-btc-hour",
            eventKey: "btc-hour",
            yesAsk: 0.62,
            noAsk: 0.42,
            depthUsd: d("100"),
            spread: 0.02,
            timestampMs: NOW_MS
          }
        ],
        config: defaultHedgeConfig(),
        nowMs: NOW_MS
      }
    });
    const hedge = decision.plan?.metadata?.exposureHedge as HedgePlan | undefined;

    expect(decision.accepted).toBe(true);
    expect(decision.plan?.action).toBe("EXPOSURE_HEDGE");
    expect(hedge?.dryRun).toBe(true);
    expect(hedge?.executable).toBe(false);
    expect(hedge?.hedgeOrder?.side).toBe("NO");
    expect(hedge?.hedgeOrder?.venue).toBe("polymarket");
    expect(hedge?.risk.reasonCodes).toContain("DRY_RUN_ONLY");
  });

  it("rejects when exposure is within the configured limit", () => {
    const decision = new StrategyEngine().evaluate({
      config: strategyConfig(),
      exposureHedge: {
        exposures: [
          predictExposure({ marketId: "predict-yes", eventKey: "btc-hour", side: "YES", sizeUsd: "20", avgPrice: 0.4, currentPrice: 0.6 })
        ],
        candidates: [],
        config: defaultHedgeConfig({ maxNetExposureUsd: d("25") }),
        nowMs: NOW_MS
      }
    });
    const hedge = decision.plan?.metadata?.exposureHedge as HedgePlan | undefined;

    expect(decision.accepted).toBe(false);
    expect(decision.reasons).toContain("EXPOSURE_HEDGE_REJECTED");
    expect(hedge?.rejectReason).toBe("exposure_within_limit");
  });
});

function strategyConfig(): StrategyConfig {
  return {
    strategyMode: "exposure_hedge",
    hedgeEnabled: true,
    maxNetExposureUsd: d("25"),
    maxPredictUsagePct: d("0.30"),
    minProfitAfterHedgeFee: d("0")
  };
}
