import { d, type D } from "../domain/money.js";
import { type HedgeCandidateMarket, type HedgeCandidateVenue } from "../hedge/hedge-market-matcher.js";

export interface HedgeConfig {
  enabled: boolean;
  dryRun: boolean;
  hedgeRatio: number;
  maxHedgeOrderUsd: D;
  minHedgeOrderUsd: D;
  maxNetExposureUsd: D;
  maxPredictUsagePct: D;
  maxSpread: number;
  minDepthUsd: D;
  maxDepthUsagePct: number;
  maxMarketDataAgeMs: number;
  requireSameEventKey: boolean;
  allowCorrelatedHedge: boolean;
  allowedVenues: readonly HedgeCandidateVenue[];
  liveTradingEnabled: boolean;
  postOnly: boolean;
}

export interface HedgeRiskResult {
  staleData: boolean;
  liquidityOk: boolean;
  spreadOk: boolean;
  maxHedgeSizeOk: boolean;
  orderSizeOk: boolean;
  eventKeyOk: boolean;
  venueOk: boolean;
  enabledOk: boolean;
  liveTradingOk: boolean;
  reasonCodes: string[];
}

export function evaluateHedgeRisk(input: {
  config: HedgeConfig;
  candidate: HedgeCandidateMarket;
  sourceEventKey: string;
  hedgeSizeUsd: D;
  nowMs: number;
}): HedgeRiskResult {
  const reasonCodes: string[] = [];
  const staleData = input.nowMs - input.candidate.timestampMs > input.config.maxMarketDataAgeMs;
  const liquidityOk = input.candidate.depthUsd.gte(input.config.minDepthUsd);
  const spreadOk = input.candidate.spread <= input.config.maxSpread;
  const maxHedgeSizeOk = input.hedgeSizeUsd.lte(input.config.maxHedgeOrderUsd);
  const orderSizeOk = input.hedgeSizeUsd.gte(input.config.minHedgeOrderUsd);
  const eventKeyOk =
    input.candidate.eventKey === input.sourceEventKey || (!input.config.requireSameEventKey && input.config.allowCorrelatedHedge);
  const venueOk = input.config.allowedVenues.includes(input.candidate.venue);
  const enabledOk = input.config.enabled;
  const liveTradingOk = !input.config.liveTradingEnabled;

  if (!enabledOk) reasonCodes.push("HEDGE_DISABLED");
  if (!liveTradingOk) reasonCodes.push("LIVE_HEDGE_NOT_SUPPORTED");
  if (staleData) reasonCodes.push("STALE_MARKET_DATA");
  if (!spreadOk) reasonCodes.push("SPREAD_TOO_WIDE");
  if (!liquidityOk) reasonCodes.push("INSUFFICIENT_DEPTH");
  if (!orderSizeOk) reasonCodes.push("HEDGE_SIZE_BELOW_MIN");
  if (!maxHedgeSizeOk) reasonCodes.push("HEDGE_SIZE_ABOVE_MAX");
  if (!eventKeyOk) reasonCodes.push("EVENT_KEY_MISMATCH");
  if (!venueOk) reasonCodes.push("VENUE_NOT_ALLOWED");

  return {
    staleData,
    liquidityOk,
    spreadOk,
    maxHedgeSizeOk,
    orderSizeOk,
    eventKeyOk,
    venueOk,
    enabledOk,
    liveTradingOk,
    reasonCodes
  };
}

export function defaultHedgeConfig(overrides: Partial<HedgeConfig> = {}): HedgeConfig {
  return {
    enabled: true,
    dryRun: true,
    hedgeRatio: 0.5,
    maxHedgeOrderUsd: overrides.maxHedgeOrderUsd ?? d("10"),
    minHedgeOrderUsd: overrides.minHedgeOrderUsd ?? d("1"),
    maxNetExposureUsd: overrides.maxNetExposureUsd ?? d("25"),
    maxPredictUsagePct: overrides.maxPredictUsagePct ?? d("0.30"),
    maxSpread: 0.035,
    minDepthUsd: overrides.minDepthUsd ?? d("20"),
    maxDepthUsagePct: 0.25,
    maxMarketDataAgeMs: 2000,
    requireSameEventKey: true,
    allowCorrelatedHedge: false,
    allowedVenues: ["polymarket", "predictfun"],
    liveTradingEnabled: false,
    postOnly: true,
    ...overrides
  };
}
