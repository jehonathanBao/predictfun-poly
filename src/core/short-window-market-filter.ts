import { marketWindowSeconds } from "./market-classification.js";
import { type MarketFamily, type NormalizedMarket, type ResolutionSource } from "./types.js";

export type MarketRejectReason =
  | "NOT_BTC"
  | "NOT_BTC_UP_DOWN"
  | "NOT_SHORT_WINDOW"
  | "NOT_EXACT_1H_WINDOW"
  | "WINDOW_TOO_LONG"
  | "TOO_EARLY"
  | "TOO_CLOSE_TO_CLOSE"
  | "BAD_RESOLUTION_SOURCE"
  | "START_TIME_MISMATCH"
  | "END_TIME_MISMATCH"
  | "RULE_MISMATCH"
  | "PRICE_FEED_MISMATCH"
  | "NOT_TRADABLE"
  | "MISSING_START_OR_END"
  | "UNKNOWN_MARKET_FAMILY"
  | "CADENCE_MISMATCH";

export interface ShortWindowFilterConfig {
  asset: "BTC";
  maxWindowSeconds: number;
  requireExact1hWindow: boolean;
  minSecondsToClose: number;
  discoveryLookaheadSeconds: number;
  allowedResolutionSources: readonly ResolutionSource[];
  rejectMarketFamilies?: readonly MarketFamily[];
}

export type EligibilityResult =
  | {
      status: "APPROVED";
      approved: true;
      secondsToClose: number;
      windowSec: number;
    }
  | {
      status: "REJECTED";
      approved: false;
      reason: MarketRejectReason;
      secondsToClose?: number;
      windowSec?: number;
    };

export const DEFAULT_SHORT_WINDOW_FILTER_CONFIG: ShortWindowFilterConfig = {
  asset: "BTC",
  maxWindowSeconds: 3600,
  requireExact1hWindow: true,
  minSecondsToClose: 90,
  discoveryLookaheadSeconds: 3600,
  allowedResolutionSources: ["BINANCE_BTC_USDT"],
  rejectMarketFamilies: [
    "BTC_4H_UP_DOWN",
    "BTC_DAILY_UP_DOWN",
    "BTC_PRICE_TARGET",
    "BTC_RANGE",
    "BTC_MONTHLY",
    "BTC_YEARLY"
  ]
};

export function isEligibleShortWindowBtcMarket(
  market: NormalizedMarket,
  nowMs: number,
  cfg: ShortWindowFilterConfig = DEFAULT_SHORT_WINDOW_FILTER_CONFIG
): EligibilityResult {
  if (market.asset !== cfg.asset) return reject("NOT_BTC");
  if (market.family === "UNKNOWN") return reject("UNKNOWN_MARKET_FAMILY");
  if (cfg.rejectMarketFamilies?.includes(market.family)) return reject("NOT_BTC_UP_DOWN");
  if (market.family !== "BTC_UP_DOWN") return reject("NOT_BTC_UP_DOWN");

  const start = market.eventStartTs ?? market.startTs;
  const end = market.eventEndTs ?? market.endTs;
  if (!start || !end) return reject("MISSING_START_OR_END");

  const windowSec = market.windowSeconds ?? marketWindowSeconds(market);
  if (windowSec === undefined || windowSec <= 0) return reject("MISSING_START_OR_END");
  const secondsToClose = Math.floor((end.getTime() - nowMs) / 1000);

  if (cfg.requireExact1hWindow && windowSec !== 3600) {
    return reject("NOT_EXACT_1H_WINDOW", { windowSec, secondsToClose });
  }
  if (!cfg.requireExact1hWindow && windowSec > cfg.maxWindowSeconds) {
    return reject("WINDOW_TOO_LONG", { windowSec, secondsToClose });
  }
  if (windowSec > cfg.maxWindowSeconds) {
    return reject("NOT_SHORT_WINDOW", { windowSec, secondsToClose });
  }
  if (secondsToClose > cfg.discoveryLookaheadSeconds) {
    return reject("TOO_EARLY", { windowSec, secondsToClose });
  }
  if (secondsToClose < cfg.minSecondsToClose) {
    return reject("TOO_CLOSE_TO_CLOSE", { windowSec, secondsToClose });
  }
  if (!cfg.allowedResolutionSources.includes(market.resolutionSource)) {
    return reject("BAD_RESOLUTION_SOURCE", { windowSec, secondsToClose });
  }
  if (!market.isTradable || market.isClosed || market.isResolved || market.acceptingOrders === false) {
    return reject("NOT_TRADABLE", { windowSec, secondsToClose });
  }

  return {
    status: "APPROVED",
    approved: true,
    secondsToClose,
    windowSec
  };
}

function reject(
  reason: MarketRejectReason,
  extra: { secondsToClose?: number; windowSec?: number } = {}
): EligibilityResult {
  return {
    status: "REJECTED",
    approved: false,
    reason,
    ...extra
  };
}
