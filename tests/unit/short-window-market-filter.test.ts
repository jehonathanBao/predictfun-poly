import { describe, expect, it } from "vitest";
import { isEligibleShortWindowBtcMarket, type ShortWindowFilterConfig } from "../../src/core/short-window-market-filter.js";
import { HourlyBtcUpDownMatcher } from "../../src/core/hourly-btc-market-matcher.js";
import { checkTimeAwareMarketRisk } from "../../src/core/risk-manager.js";
import { type NormalizedMarket } from "../../src/core/types.js";
import { validateShortWindowExecutionGuard } from "../../src/execution/coordinator.js";
import { d } from "../../src/core/decimal.js";

const cfg: ShortWindowFilterConfig = {
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

const now = Date.parse("2026-06-04T00:30:00Z");

function market(overrides: Partial<NormalizedMarket> = {}): NormalizedMarket {
  return {
    venue: "PREDICT",
    externalMarketId: "m1",
    question: "Bitcoin Up or Down Hourly",
    asset: "BTC",
    family: "BTC_UP_DOWN",
    eventStartTs: new Date("2026-06-04T00:00:00Z"),
    eventEndTs: new Date("2026-06-04T01:00:00Z"),
    windowSeconds: 3600,
    cadence: "HOURLY",
    directionType: "UP_DOWN",
    priceFeedProvider: "BINANCE",
    priceFeedSymbol: "BTC_USDT",
    resolutionSource: "BINANCE_BTC_USDT",
    upDownRule: "CLOSE_GTE_OPEN_IS_UP",
    isTradable: true,
    isClosed: false,
    isResolved: false,
    raw: {},
    ...overrides
  };
}

describe("short-window BTC market filter", () => {
  it("approves exact 1H Binance BTC/USDT Up/Down markets", () => {
    const result = isEligibleShortWindowBtcMarket(market(), now, cfg);

    expect(result.approved).toBe(true);
    expect(result.status).toBe("APPROVED");
  });

  it("rejects 4H, daily, and price-target BTC markets", () => {
    expect(isEligibleShortWindowBtcMarket(market({ family: "BTC_4H_UP_DOWN", windowSeconds: 14400 }), now, cfg)).toMatchObject({
      approved: false,
      reason: "NOT_BTC_UP_DOWN"
    });
    expect(isEligibleShortWindowBtcMarket(market({ family: "BTC_DAILY_UP_DOWN", windowSeconds: 86400 }), now, cfg)).toMatchObject({
      approved: false,
      reason: "NOT_BTC_UP_DOWN"
    });
    expect(isEligibleShortWindowBtcMarket(market({ family: "BTC_PRICE_TARGET" }), now, cfg)).toMatchObject({
      approved: false,
      reason: "NOT_BTC_UP_DOWN"
    });
  });

  it("rejects markets too close to close and markets without start/end", () => {
    expect(isEligibleShortWindowBtcMarket(market(), Date.parse("2026-06-04T00:58:31Z"), cfg)).toMatchObject({
      approved: false,
      reason: "TOO_CLOSE_TO_CLOSE"
    });
    expect(isEligibleShortWindowBtcMarket(market({ eventStartTs: undefined, eventEndTs: undefined }), now, cfg)).toMatchObject({
      approved: false,
      reason: "MISSING_START_OR_END"
    });
  });
});

describe("hourly BTC market matcher", () => {
  it("matches only identical hourly source/time/rule pairs", () => {
    const matcher = new HourlyBtcUpDownMatcher({ ...cfg, maxStartTimeMismatchSec: 0, maxEndTimeMismatchSec: 0 });
    const result = matcher.match(market({ venue: "PREDICT" }), market({ venue: "POLYMARKET" }), now);

    expect(result.matched).toBe(true);
  });

  it("rejects same title with different source or start/end", () => {
    const matcher = new HourlyBtcUpDownMatcher({ ...cfg, maxStartTimeMismatchSec: 0, maxEndTimeMismatchSec: 0 });

    expect(
      matcher.match(
        market({ venue: "PREDICT" }),
        market({ venue: "POLYMARKET", priceFeedProvider: "CHAINLINK", priceFeedSymbol: "BTC_USD", resolutionSource: "CHAINLINK_BTC_USD" }),
        now
      ).reasons
    ).toContain("PRICE_FEED_MISMATCH");
    expect(
      matcher.match(
        market({ venue: "PREDICT" }),
        market({ venue: "POLYMARKET", eventStartTs: new Date("2026-06-04T00:01:00Z") }),
        now
      ).reasons
    ).toContain("START_TIME_MISMATCH");
  });
});

describe("time-aware risk checks", () => {
  it("rejects stale books and closing markets", () => {
    const closing = checkTimeAwareMarketRisk({
      market: market(),
      nowMs: Date.parse("2026-06-04T00:58:31Z"),
      cfg,
      staleBookMs: 500,
      predictBookTs: Date.parse("2026-06-04T00:58:31Z"),
      polymarketBookTs: Date.parse("2026-06-04T00:58:31Z")
    });
    const stale = checkTimeAwareMarketRisk({
      market: market(),
      nowMs: now,
      cfg,
      staleBookMs: 500,
      predictBookTs: now - 501,
      polymarketBookTs: now
    });

    expect(closing.accepted).toBe(false);
    expect(closing.reasons).toContain("REJECT_TOO_CLOSE_TO_CLOSE");
    expect(stale.reasons).toContain("REJECT_STALE_BOOK");
  });
});

describe("short-window execution guard", () => {
  it("rejects if time or profit disappears before submit", () => {
    const late = validateShortWindowExecutionGuard({
      market: market(),
      nowMs: Date.parse("2026-06-04T00:58:41Z"),
      cfg,
      staleBookMs: 500,
      predictBookTs: Date.parse("2026-06-04T00:58:41Z"),
      polymarketBookTs: Date.parse("2026-06-04T00:58:41Z"),
      expectedProfitUsd: d("0.01"),
      expectedProfitPerShare: d("0.001"),
      orderType: "FOK"
    });
    const noProfit = validateShortWindowExecutionGuard({
      market: market(),
      nowMs: now,
      cfg,
      staleBookMs: 500,
      predictBookTs: now,
      polymarketBookTs: now,
      expectedProfitUsd: d("0"),
      expectedProfitPerShare: d("0"),
      orderType: "FOK"
    });

    expect(late.ok).toBe(false);
    expect(late.reasons).toContain("REJECT_TOO_CLOSE_TO_CLOSE");
    expect(noProfit.reasons).toContain("REJECT_NO_PROFIT_AFTER_RECHECK");
  });
});
