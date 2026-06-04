import { d, type D, type Decimalish } from "../domain/money.js";
import type { MarketExposure, PositionSide } from "./exposure-calculator.js";
import {
  marketDepthUsd,
  validateHedgePlanRisk,
  type HedgeRiskResult,
} from "../risk/hedge-risk.js";

export interface HedgeConfig {
  enabled: boolean;
  dryRun: boolean;
  hedgeRatio: number;
  maxHedgeOrderUsd: number;
  minHedgeOrderUsd: number;
  maxNetExposureUsd: number;
  maxPredictUsagePct: number;
  maxSpread: number;
  minDepthUsd: number;
  maxDepthUsagePct: number;
  maxMarketDataAgeMs: number;
  requireSameEventKey: boolean;
  allowCorrelatedHedge: boolean;
  liveTradingEnabled: boolean;
  postOnly: boolean;
}

type MoneyConfigValue = Decimalish;

export interface RawHedgeConfig {
  enabled?: boolean;
  dry_run?: boolean;
  dryRun?: boolean;
  hedge_ratio?: MoneyConfigValue;
  hedgeRatio?: MoneyConfigValue;
  max_hedge_order_usd?: MoneyConfigValue;
  maxHedgeOrderUsd?: MoneyConfigValue;
  min_hedge_order_usd?: MoneyConfigValue;
  minHedgeOrderUsd?: MoneyConfigValue;
  max_net_exposure_usd?: MoneyConfigValue;
  maxNetExposureUsd?: MoneyConfigValue;
  max_predict_usage_pct?: MoneyConfigValue;
  maxPredictUsagePct?: MoneyConfigValue;
  max_spread?: number;
  maxSpread?: number;
  min_depth_usd?: MoneyConfigValue;
  minDepthUsd?: MoneyConfigValue;
  max_depth_usage_pct?: MoneyConfigValue;
  maxDepthUsagePct?: MoneyConfigValue;
  max_market_data_age_ms?: number;
  maxMarketDataAgeMs?: number;
  require_same_event_key?: boolean;
  requireSameEventKey?: boolean;
  allow_correlated_hedge?: boolean;
  allowCorrelatedHedge?: boolean;
  live_trading_enabled?: boolean;
  liveTradingEnabled?: boolean;
  post_only?: boolean;
  postOnly?: boolean;
}

export interface HedgeCandidateMarket {
  venue?: string;
  marketId: string;
  eventKey: string;
  bid?: number;
  ask?: number;
  yesAsk?: number;
  noAsk?: number;
  yesBid?: number;
  noBid?: number;
  spread?: number;
  depthUsd?: MoneyConfigValue;
  availableDepthUsd?: MoneyConfigValue;
  marketDataTimestampMs?: number;
  updatedAtMs?: number;
  timestampMs?: number;
}

export type HedgeDirection = "BUY" | "SELL" | "NONE";

export interface HedgeOrderPlan {
  venue?: string;
  marketId: string;
  side: PositionSide;
  limitPrice: number;
  sizeUsd: D;
  postOnly: boolean;
}

export interface HedgePlan {
  strategy: "EXPOSURE_HEDGE";
  predictMarketId: string;
  hedgeMarketId?: string;
  eventKey: string;
  hedgeEventKey?: string;
  netExposureUsd: number;
  hedgeDirection: HedgeDirection;
  hedgeSizeUsd: number;
  hedgeOrder?: HedgeOrderPlan;
  exposureBeforeUsd: D;
  exposureAfterUsd: D;
  estimatedHedgeCostUsd: D;
  executable: false;
  dryRun: true;
  postOnly: boolean;
  candidate?: HedgeCandidateMarket;
  risk: HedgeRiskResult;
  rejectReason?: string;
}

export const DEFAULT_HEDGE_CONFIG: HedgeConfig = {
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
};

function numberFrom(
  raw: RawHedgeConfig,
  snakeKey: keyof RawHedgeConfig,
  camelKey: keyof RawHedgeConfig,
  fallback: number,
): number {
  const snakeValue = raw[snakeKey];
  const camelValue = raw[camelKey];
  if (camelValue !== undefined && typeof camelValue !== "boolean") {
    return d(camelValue).toNumber();
  }
  if (snakeValue !== undefined && typeof snakeValue !== "boolean") {
    return d(snakeValue).toNumber();
  }
  return fallback;
}

function booleanFrom(
  raw: RawHedgeConfig,
  snakeKey: keyof RawHedgeConfig,
  camelKey: keyof RawHedgeConfig,
  fallback: boolean,
): boolean {
  const snakeValue = raw[snakeKey];
  const camelValue = raw[camelKey];
  if (typeof camelValue === "boolean") return camelValue;
  if (typeof snakeValue === "boolean") return snakeValue;
  return fallback;
}

export function normalizeHedgeConfig(raw: RawHedgeConfig = {}): HedgeConfig {
  return {
    enabled: booleanFrom(raw, "enabled", "enabled", DEFAULT_HEDGE_CONFIG.enabled),
    dryRun: booleanFrom(raw, "dry_run", "dryRun", DEFAULT_HEDGE_CONFIG.dryRun),
    hedgeRatio: numberFrom(raw, "hedge_ratio", "hedgeRatio", DEFAULT_HEDGE_CONFIG.hedgeRatio),
    maxHedgeOrderUsd: numberFrom(
      raw,
      "max_hedge_order_usd",
      "maxHedgeOrderUsd",
      DEFAULT_HEDGE_CONFIG.maxHedgeOrderUsd,
    ),
    minHedgeOrderUsd: numberFrom(
      raw,
      "min_hedge_order_usd",
      "minHedgeOrderUsd",
      DEFAULT_HEDGE_CONFIG.minHedgeOrderUsd,
    ),
    maxNetExposureUsd: numberFrom(
      raw,
      "max_net_exposure_usd",
      "maxNetExposureUsd",
      DEFAULT_HEDGE_CONFIG.maxNetExposureUsd,
    ),
    maxPredictUsagePct: numberFrom(
      raw,
      "max_predict_usage_pct",
      "maxPredictUsagePct",
      DEFAULT_HEDGE_CONFIG.maxPredictUsagePct,
    ),
    maxSpread: numberFrom(raw, "max_spread", "maxSpread", DEFAULT_HEDGE_CONFIG.maxSpread),
    minDepthUsd: numberFrom(raw, "min_depth_usd", "minDepthUsd", DEFAULT_HEDGE_CONFIG.minDepthUsd),
    maxDepthUsagePct: numberFrom(
      raw,
      "max_depth_usage_pct",
      "maxDepthUsagePct",
      DEFAULT_HEDGE_CONFIG.maxDepthUsagePct,
    ),
    maxMarketDataAgeMs: numberFrom(
      raw,
      "max_market_data_age_ms",
      "maxMarketDataAgeMs",
      DEFAULT_HEDGE_CONFIG.maxMarketDataAgeMs,
    ),
    requireSameEventKey: booleanFrom(
      raw,
      "require_same_event_key",
      "requireSameEventKey",
      DEFAULT_HEDGE_CONFIG.requireSameEventKey,
    ),
    allowCorrelatedHedge: booleanFrom(
      raw,
      "allow_correlated_hedge",
      "allowCorrelatedHedge",
      DEFAULT_HEDGE_CONFIG.allowCorrelatedHedge,
    ),
    liveTradingEnabled: booleanFrom(
      raw,
      "live_trading_enabled",
      "liveTradingEnabled",
      DEFAULT_HEDGE_CONFIG.liveTradingEnabled,
    ),
    postOnly: booleanFrom(raw, "post_only", "postOnly", DEFAULT_HEDGE_CONFIG.postOnly),
  };
}

function hedgeDirection(netExposureUsd: number): HedgeDirection {
  if (netExposureUsd > 0) return "SELL";
  if (netExposureUsd < 0) return "BUY";
  return "NONE";
}

function hedgeSide(direction: HedgeDirection): PositionSide {
  return direction === "BUY" ? "YES" : "NO";
}

function hedgeLimitPrice(candidate: HedgeCandidateMarket, side: PositionSide): number {
  if (side === "YES") return candidate.yesAsk ?? candidate.ask ?? 0;
  return candidate.noAsk ?? candidate.ask ?? 0;
}

function findCandidate(
  exposure: MarketExposure,
  candidates: HedgeCandidateMarket[],
  config: HedgeConfig,
): HedgeCandidateMarket | undefined {
  if (config.requireSameEventKey !== false) {
    return candidates.find((candidate) => candidate.eventKey === exposure.eventKey);
  }

  return candidates.find(
    (candidate) =>
      candidate.eventKey === exposure.eventKey || config.allowCorrelatedHedge,
  );
}

export function planExposureHedges(
  exposures: MarketExposure[],
  candidates: HedgeCandidateMarket[],
  rawConfig: RawHedgeConfig = {},
  nowMs = Date.now(),
): HedgePlan[] {
  const config = normalizeHedgeConfig(rawConfig);

  if (!config.enabled) return [];

  return exposures.map<HedgePlan>((exposure) => {
    const candidate = findCandidate(exposure, candidates, config);
    const depthLimitUsd = candidate
      ? marketDepthUsd(candidate) * config.maxDepthUsagePct
      : 0;
    const targetHedgeUsd = Math.abs(exposure.netExposureUsd) * config.hedgeRatio;
    const hedgeSizeUsd = Math.min(
      targetHedgeUsd,
      config.maxHedgeOrderUsd,
      depthLimitUsd,
    );

    const planForRisk: Pick<
      HedgePlan,
      | "eventKey"
      | "hedgeEventKey"
      | "hedgeSizeUsd"
      | "netExposureUsd"
      | "candidate"
    > = {
      eventKey: exposure.eventKey,
      hedgeSizeUsd,
      netExposureUsd: exposure.netExposureUsd,
    };
    if (candidate) {
      planForRisk.hedgeEventKey = candidate.eventKey;
      planForRisk.candidate = candidate;
    }
    const risk = validateHedgePlanRisk(planForRisk, config, nowMs);
    const direction = hedgeDirection(exposure.netExposureUsd);
    const side = hedgeSide(direction);
    const size = d(hedgeSizeUsd);
    const exposureBeforeUsd = d(Math.abs(exposure.netExposureUsd));
    const exposureAfterUsd = exposureBeforeUsd.minus(size);
    const limitPrice = candidate ? hedgeLimitPrice(candidate, side) : 0;

    const plan: HedgePlan = {
      strategy: "EXPOSURE_HEDGE",
      predictMarketId: exposure.marketId,
      eventKey: exposure.eventKey,
      netExposureUsd: exposure.netExposureUsd,
      hedgeDirection: direction,
      hedgeSizeUsd,
      exposureBeforeUsd,
      exposureAfterUsd,
      estimatedHedgeCostUsd: size.mul(limitPrice),
      executable: false,
      dryRun: true,
      postOnly: config.postOnly,
      risk,
    };
    if (candidate) {
      plan.hedgeMarketId = candidate.marketId;
      plan.hedgeEventKey = candidate.eventKey;
      plan.candidate = candidate;
      if (direction !== "NONE" && hedgeSizeUsd > 0) {
        const hedgeOrder: HedgeOrderPlan = {
          marketId: candidate.marketId,
          side,
          limitPrice,
          sizeUsd: size,
          postOnly: config.postOnly,
        };
        if (candidate.venue) {
          hedgeOrder.venue = candidate.venue;
        }
        plan.hedgeOrder = hedgeOrder;
      }
    }
    if (risk.rejectReason) {
      plan.rejectReason = risk.rejectReason;
    }

    return plan;
  });
}

export function buildExposureHedgePlan(input: {
  exposures: MarketExposure[];
  candidates: HedgeCandidateMarket[];
  config?: RawHedgeConfig;
  nowMs?: number;
}): HedgePlan {
  const plans = planExposureHedges(
    input.exposures,
    input.candidates,
    input.config,
    input.nowMs,
  );

  const plan =
    plans[0] ?? {
      strategy: "EXPOSURE_HEDGE",
      predictMarketId: "",
      eventKey: "",
      netExposureUsd: 0,
      hedgeDirection: "NONE",
      hedgeSizeUsd: 0,
      exposureBeforeUsd: d(0),
      exposureAfterUsd: d(0),
      estimatedHedgeCostUsd: d(0),
      executable: false,
      dryRun: true,
      postOnly: true,
      rejectReason: "no_exposure_hedge_plan",
      risk: {
        approved: false,
        reasonCodes: ["no_exposure_hedge_plan"],
        rejectReason: "no_exposure_hedge_plan",
      },
    };

  const legacyRejectReason = toLegacyRejectReason(plan.rejectReason);
  if (legacyRejectReason) {
    plan.rejectReason = legacyRejectReason;
    plan.risk.rejectReason = legacyRejectReason;
  }

  return plan;
}

function toLegacyRejectReason(reason?: string): string | undefined {
  switch (reason) {
    case "NO_MATCHING_MARKET":
      return "no_matching_hedge_market";
    case "STALE_MARKET_DATA":
      return "stale_market_data";
    case "SPREAD_TOO_WIDE":
      return "spread_too_wide";
    case "INSUFFICIENT_DEPTH":
      return "insufficient_depth";
    case "HEDGE_SIZE_BELOW_MIN":
    case "HEDGE_SIZE_TOO_SMALL":
      return "hedge_size_below_min";
    case "LIVE_HEDGE_NOT_SUPPORTED":
      return "live_hedge_not_supported";
    default:
      return reason;
  }
}
