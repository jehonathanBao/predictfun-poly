import type {
  HedgeCandidateMarket,
  HedgeConfig,
  HedgePlan,
  RawHedgeConfig,
} from "../hedge/hedge-planner.js";

export type HedgeRiskReasonCode =
  | "NO_MATCHING_MARKET"
  | "EVENT_KEY_MISMATCH"
  | "STALE_MARKET_DATA"
  | "SPREAD_TOO_WIDE"
  | "INSUFFICIENT_DEPTH"
  | "MAX_ORDER_EXCEEDED"
  | "MAX_NET_EXPOSURE_EXCEEDED"
  | "HEDGE_SIZE_TOO_SMALL"
  | "HEDGE_SIZE_BELOW_MIN"
  | "LIVE_HEDGE_NOT_SUPPORTED"
  | "no_exposure_hedge_plan";

export interface HedgeRiskResult {
  approved: boolean;
  reasonCodes: HedgeRiskReasonCode[];
  rejectReason?: string;
}

export function defaultHedgeConfig(
  overrides: Partial<RawHedgeConfig> = {},
): RawHedgeConfig {
  return {
    enabled: true,
    dryRun: true,
    hedgeRatio: 0.5,
    maxHedgeOrderUsd: 10,
    minHedgeOrderUsd: 1,
    maxNetExposureUsd: 25,
    maxPredictUsagePct: 0.3,
    maxSpread: 0.035,
    minDepthUsd: 20,
    maxDepthUsagePct: 0.25,
    maxMarketDataAgeMs: 2000,
    requireSameEventKey: true,
    allowCorrelatedHedge: false,
    liveTradingEnabled: false,
    postOnly: true,
    ...overrides,
  };
}

function firstRejectReason(reasonCodes: HedgeRiskReasonCode[]): string | undefined {
  return reasonCodes.length > 0 ? reasonCodes[0] : undefined;
}

export function marketSpread(candidate: HedgeCandidateMarket): number {
  if (typeof candidate.spread === "number") return candidate.spread;
  if (
    typeof candidate.bid === "number" &&
    typeof candidate.ask === "number" &&
    candidate.ask > candidate.bid
  ) {
    return candidate.ask - candidate.bid;
  }

  return 0;
}

export function marketDepthUsd(candidate: HedgeCandidateMarket): number {
  const depth = candidate.depthUsd ?? candidate.availableDepthUsd ?? 0;
  return Math.max(0, typeof depth === "number" ? depth : Number(depth.toString()));
}

export function marketAgeMs(
  candidate: HedgeCandidateMarket,
  nowMs = Date.now(),
): number {
  const timestamp =
    candidate.marketDataTimestampMs ??
    candidate.updatedAtMs ??
    candidate.timestampMs ??
    nowMs;

  return Math.max(0, nowMs - timestamp);
}

export function validateHedgePlanRisk(
  plan: Pick<
    HedgePlan,
    | "eventKey"
    | "hedgeEventKey"
    | "hedgeSizeUsd"
    | "netExposureUsd"
    | "candidate"
  >,
  config: HedgeConfig,
  nowMs = Date.now(),
): HedgeRiskResult {
  const reasonCodes: HedgeRiskReasonCode[] = [];
  const candidate = plan.candidate;

  if (config.liveTradingEnabled) {
    reasonCodes.push("LIVE_HEDGE_NOT_SUPPORTED");
  }

  if (!candidate) {
    reasonCodes.push("NO_MATCHING_MARKET");
  } else {
    if (config.requireSameEventKey !== false && plan.eventKey !== candidate.eventKey) {
      reasonCodes.push("EVENT_KEY_MISMATCH");
    }

    if (marketAgeMs(candidate, nowMs) > config.maxMarketDataAgeMs) {
      reasonCodes.push("STALE_MARKET_DATA");
    }

    if (marketSpread(candidate) > config.maxSpread) {
      reasonCodes.push("SPREAD_TOO_WIDE");
    }

    if (marketDepthUsd(candidate) < config.minDepthUsd) {
      reasonCodes.push("INSUFFICIENT_DEPTH");
    }
  }

  if (Math.abs(plan.netExposureUsd) > config.maxNetExposureUsd) {
    reasonCodes.push("MAX_NET_EXPOSURE_EXCEEDED");
  }

  if (plan.hedgeSizeUsd > config.maxHedgeOrderUsd) {
    reasonCodes.push("MAX_ORDER_EXCEEDED");
  }

  if (plan.hedgeSizeUsd > 0 && plan.hedgeSizeUsd < config.minHedgeOrderUsd) {
    reasonCodes.push("HEDGE_SIZE_BELOW_MIN");
  }

  const result: HedgeRiskResult = {
    approved: reasonCodes.length === 0,
    reasonCodes,
  };
  const rejectReason = firstRejectReason(reasonCodes);
  if (rejectReason) {
    result.rejectReason = rejectReason;
  }

  return result;
}
