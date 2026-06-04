import { DEFAULT_SHORT_WINDOW_FILTER_CONFIG, isEligibleShortWindowBtcMarket, type MarketRejectReason, type ShortWindowFilterConfig } from "./short-window-market-filter.js";
import { type NormalizedMarket } from "./types.js";

export interface HourlyBtcMatcherConfig extends ShortWindowFilterConfig {
  maxStartTimeMismatchSec: number;
  maxEndTimeMismatchSec: number;
}

export interface HourlyBtcMarketMatch {
  predict: NormalizedMarket;
  polymarket: NormalizedMarket;
  matched: boolean;
  reasons: readonly MarketRejectReason[];
  usedConditionHint: boolean;
}

export const DEFAULT_HOURLY_BTC_MATCHER_CONFIG: HourlyBtcMatcherConfig = {
  ...DEFAULT_SHORT_WINDOW_FILTER_CONFIG,
  maxStartTimeMismatchSec: 0,
  maxEndTimeMismatchSec: 0
};

export class HourlyBtcUpDownMatcher {
  constructor(private readonly cfg: HourlyBtcMatcherConfig = DEFAULT_HOURLY_BTC_MATCHER_CONFIG) {}

  match(predict: NormalizedMarket, polymarket: NormalizedMarket, nowMs: number): HourlyBtcMarketMatch {
    const reasons: MarketRejectReason[] = [];
    if (predict.venue !== "PREDICT" || polymarket.venue !== "POLYMARKET") reasons.push("NOT_TRADABLE");

    const predictEligibility = isEligibleShortWindowBtcMarket(predict, nowMs, this.cfg);
    const polymarketEligibility = isEligibleShortWindowBtcMarket(polymarket, nowMs, this.cfg);
    if (!predictEligibility.approved) reasons.push(predictEligibility.reason);
    if (!polymarketEligibility.approved) reasons.push(polymarketEligibility.reason);

    if (predict.cadence !== "HOURLY" || polymarket.cadence !== "HOURLY") reasons.push("CADENCE_MISMATCH");
    if (predict.family !== "BTC_UP_DOWN" || polymarket.family !== "BTC_UP_DOWN") reasons.push("NOT_BTC_UP_DOWN");

    const predictStart = predict.eventStartTs ?? predict.startTs;
    const polyStart = polymarket.eventStartTs ?? polymarket.startTs;
    const predictEnd = predict.eventEndTs ?? predict.endTs;
    const polyEnd = polymarket.eventEndTs ?? polymarket.endTs;
    if (!predictStart || !polyStart || !predictEnd || !polyEnd) {
      reasons.push("MISSING_START_OR_END");
    } else {
      if (Math.abs(predictStart.getTime() - polyStart.getTime()) / 1000 > this.cfg.maxStartTimeMismatchSec) {
        reasons.push("START_TIME_MISMATCH");
      }
      if (Math.abs(predictEnd.getTime() - polyEnd.getTime()) / 1000 > this.cfg.maxEndTimeMismatchSec) {
        reasons.push("END_TIME_MISMATCH");
      }
    }

    if (predict.resolutionSource !== polymarket.resolutionSource) reasons.push("BAD_RESOLUTION_SOURCE");
    if (predict.priceFeedProvider !== polymarket.priceFeedProvider || predict.priceFeedSymbol !== polymarket.priceFeedSymbol) {
      reasons.push("PRICE_FEED_MISMATCH");
    }
    if (
      predict.upDownRule === undefined ||
      polymarket.upDownRule === undefined ||
      predict.upDownRule === "UNKNOWN" ||
      polymarket.upDownRule === "UNKNOWN" ||
      predict.upDownRule !== polymarket.upDownRule
    ) {
      reasons.push("RULE_MISMATCH");
    }

    return {
      predict,
      polymarket,
      matched: reasons.length === 0,
      reasons: dedupe(reasons),
      usedConditionHint: hasPolymarketConditionHint(predict, polymarket)
    };
  }
}

function hasPolymarketConditionHint(predict: NormalizedMarket, polymarket: NormalizedMarket): boolean {
  const raw = predict.raw;
  if (!raw || typeof raw !== "object") return false;
  const maybeIds = (raw as { polymarketConditionIds?: unknown }).polymarketConditionIds;
  if (!Array.isArray(maybeIds) || !polymarket.conditionId) return false;
  return maybeIds.map((id) => String(id).trim().toLowerCase()).includes(polymarket.conditionId.trim().toLowerCase());
}

function dedupe<T>(items: readonly T[]): readonly T[] {
  return [...new Set(items)];
}
