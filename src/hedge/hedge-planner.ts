import { minD, ZERO, type D } from "../domain/money.js";
import {
  calculateExposureByEvent,
  hedgeSideForNetExposure,
  largestAbsoluteEventExposure,
  sourceExposureFor,
  type PredictExposure,
  type SourceExposure,
  type PositionSide
} from "./exposure-calculator.js";
import { askForSide, findBestHedgeCandidate, type HedgeCandidateMarket, type HedgeCandidateVenue } from "./hedge-market-matcher.js";
import { evaluateHedgeRisk, type HedgeConfig, type HedgeRiskResult } from "../risk/hedge-risk.js";

export interface HedgeRequest {
  exposures: readonly PredictExposure[];
  candidates: readonly HedgeCandidateMarket[];
  config: HedgeConfig;
  nowMs: number;
}

export interface HedgeOrderPlan {
  venue: HedgeCandidateVenue;
  marketId: string;
  side: PositionSide;
  action: "BUY";
  limitPrice: number;
  sizeUsd: D;
  postOnly: boolean;
}

export interface HedgePlan {
  type: "EXPOSURE_HEDGE";
  executable: boolean;
  dryRun: boolean;
  sourceExposure: SourceExposure;
  hedgeOrder?: HedgeOrderPlan;
  hedgeRatio: number;
  estimatedHedgeCostUsd: D;
  exposureBeforeUsd: D;
  exposureAfterUsd: D;
  risk: HedgeRiskResult;
  rejectReason?: string;
}

const EMPTY_SOURCE: SourceExposure = {
  venue: "predictfun",
  marketId: "",
  side: "YES",
  sizeUsd: ZERO,
  netExposureUsd: ZERO
};

export function buildExposureHedgePlan(request: HedgeRequest): HedgePlan {
  const grouped = calculateExposureByEvent(request.exposures);
  const eventExposure = largestAbsoluteEventExposure(grouped);
  if (!eventExposure) {
    return rejectedPlan({
      sourceExposure: EMPTY_SOURCE,
      rejectReason: "no_predict_exposure",
      reasonCodes: ["NO_PREDICT_EXPOSURE"],
      config: request.config
    });
  }

  const sourceExposure = sourceExposureFor(eventExposure);
  const absExposure = eventExposure.netExposureUsd.abs();
  if (absExposure.lte(request.config.maxNetExposureUsd)) {
    return rejectedPlan({
      sourceExposure,
      rejectReason: "exposure_within_limit",
      reasonCodes: ["EXPOSURE_WITHIN_LIMIT"],
      config: request.config,
      exposureBeforeUsd: absExposure,
      exposureAfterUsd: absExposure
    });
  }

  const hedgeSide = hedgeSideForNetExposure(eventExposure.netExposureUsd);
  const candidate = findBestHedgeCandidate({
    eventKey: eventExposure.eventKey,
    side: hedgeSide,
    candidates: request.candidates,
    config: {
      requireSameEventKey: request.config.requireSameEventKey,
      allowCorrelatedHedge: request.config.allowCorrelatedHedge,
      allowedVenues: request.config.allowedVenues
    }
  });
  if (!candidate) {
    return rejectedPlan({
      sourceExposure,
      rejectReason: "no_matching_hedge_market",
      reasonCodes: ["NO_MATCHING_HEDGE_MARKET"],
      config: request.config,
      exposureBeforeUsd: absExposure,
      exposureAfterUsd: absExposure
    });
  }

  const hedgeSizeUsd = minD(
    absExposure.mul(request.config.hedgeRatio),
    request.config.maxHedgeOrderUsd,
    candidate.depthUsd.mul(request.config.maxDepthUsagePct)
  );
  const limitPrice = askForSide(candidate, hedgeSide);
  const risk = evaluateHedgeRisk({
    config: request.config,
    candidate,
    sourceEventKey: eventExposure.eventKey,
    hedgeSizeUsd,
    nowMs: request.nowMs
  });
  const exposureAfterUsd = absExposure.minus(hedgeSizeUsd).abs();
  const hedgeOrder: HedgeOrderPlan = {
    venue: candidate.venue,
    marketId: candidate.marketId,
    side: hedgeSide,
    action: "BUY",
    limitPrice,
    sizeUsd: hedgeSizeUsd,
    postOnly: request.config.postOnly
  };

  if (risk.reasonCodes.length > 0) {
    return {
      type: "EXPOSURE_HEDGE",
      executable: false,
      dryRun: true,
      sourceExposure,
      hedgeOrder,
      hedgeRatio: request.config.hedgeRatio,
      estimatedHedgeCostUsd: hedgeSizeUsd.mul(limitPrice),
      exposureBeforeUsd: absExposure,
      exposureAfterUsd,
      risk,
      rejectReason: rejectReasonFromRisk(risk.reasonCodes)
    };
  }

  return {
    type: "EXPOSURE_HEDGE",
    executable: false,
    dryRun: true,
    sourceExposure,
    hedgeOrder,
    hedgeRatio: request.config.hedgeRatio,
    estimatedHedgeCostUsd: hedgeSizeUsd.mul(limitPrice),
    exposureBeforeUsd: absExposure,
    exposureAfterUsd,
    risk: {
      ...risk,
      reasonCodes: ["DRY_RUN_ONLY"]
    }
  };
}

function rejectedPlan(input: {
  sourceExposure: SourceExposure;
  rejectReason: string;
  reasonCodes: string[];
  config: HedgeConfig;
  exposureBeforeUsd?: D;
  exposureAfterUsd?: D;
}): HedgePlan {
  return {
    type: "EXPOSURE_HEDGE",
    executable: false,
    dryRun: true,
    sourceExposure: input.sourceExposure,
    hedgeRatio: input.config.hedgeRatio,
    estimatedHedgeCostUsd: ZERO,
    exposureBeforeUsd: input.exposureBeforeUsd ?? ZERO,
    exposureAfterUsd: input.exposureAfterUsd ?? ZERO,
    risk: {
      staleData: false,
      liquidityOk: false,
      spreadOk: false,
      maxHedgeSizeOk: false,
      orderSizeOk: false,
      eventKeyOk: false,
      venueOk: false,
      enabledOk: input.config.enabled,
      liveTradingOk: !input.config.liveTradingEnabled,
      reasonCodes: input.reasonCodes
    },
    rejectReason: input.rejectReason
  };
}

function rejectReasonFromRisk(reasonCodes: readonly string[]): string {
  const first = reasonCodes[0] ?? "hedge_risk_rejected";
  const mapping: Record<string, string> = {
    HEDGE_DISABLED: "hedge_disabled",
    LIVE_HEDGE_NOT_SUPPORTED: "live_hedge_not_supported",
    STALE_MARKET_DATA: "stale_market_data",
    SPREAD_TOO_WIDE: "spread_too_wide",
    INSUFFICIENT_DEPTH: "insufficient_depth",
    HEDGE_SIZE_BELOW_MIN: "hedge_size_below_min",
    HEDGE_SIZE_ABOVE_MAX: "hedge_size_above_max",
    EVENT_KEY_MISMATCH: "event_key_mismatch",
    VENUE_NOT_ALLOWED: "venue_not_allowed"
  };
  return mapping[first] ?? "hedge_risk_rejected";
}
