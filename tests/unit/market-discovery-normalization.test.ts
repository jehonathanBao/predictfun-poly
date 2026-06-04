import { describe, expect, it } from "vitest";
import {
  filterPolymarketHourlyBtcMarkets,
  normalizePolymarketMarket
} from "../../src/adapters/polymarket/market-discovery.js";
import { filterPredictHourlyBtcMarkets, normalizePredictMarket } from "../../src/adapters/predict/market-discovery.js";
import { type ShortWindowFilterConfig } from "../../src/core/short-window-market-filter.js";

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

describe("Polymarket hourly BTC discovery normalization", () => {
  it("recognizes Bitcoin Up or Down Hourly as Binance BTC/USDT hourly", () => {
    const market = normalizePolymarketMarket({
      id: "poly-1h",
      condition_id: "0xpoly",
      title: "Bitcoin Up or Down - June 4, 2026 12AM ET",
      question: "Bitcoin Up or Down?",
      rules: "If the Binance BTC/USDT 1 hour candle close is greater than or equal to open, Up wins. Otherwise Down wins.",
      enable_order_book: true,
      active: true,
      closed: false,
      accepting_orders: true,
      game_start_time: "2026-06-04T00:00:00Z",
      end_date_iso: "2026-06-04T01:00:00Z",
      tokens: [
        { outcome: "Up", token_id: "up-token" },
        { outcome: "Down", token_id: "down-token" }
      ],
      minimum_order_size: "1",
      minimum_tick_size: "0.01"
    });

    expect(market.family).toBe("BTC_UP_DOWN");
    expect(market.cadence).toBe("HOURLY");
    expect(market.resolutionSource).toBe("BINANCE_BTC_USDT");
    expect(market.yesTokenId).toBe("up-token");
    expect(market.noTokenId).toBe("down-token");
  });

  it("filters out 4H and price-target markets", () => {
    const accepted = filterPolymarketHourlyBtcMarkets(
      [
        {
          id: "4h",
          title: "Bitcoin 4H Up or Down",
          rules: "Binance BTC/USDT",
          active: true,
          enable_order_book: true,
          accepting_orders: true,
          game_start_time: "2026-06-04T00:00:00Z",
          end_date_iso: "2026-06-04T04:00:00Z"
        },
        {
          id: "target",
          title: "Will Bitcoin be above 70000?",
          rules: "Binance BTC/USDT",
          active: true,
          enable_order_book: true,
          accepting_orders: true,
          game_start_time: "2026-06-04T00:00:00Z",
          end_date_iso: "2026-06-04T01:00:00Z"
        }
      ],
      now,
      cfg
    );

    expect(accepted).toEqual([]);
  });
});

describe("Predict hourly BTC discovery normalization", () => {
  it("parses Predict BTC_UP_DOWN variant fields", () => {
    const market = normalizePredictMarket({
      id: "predict-1h",
      title: "BTC Up or Down Hourly",
      question: "Will BTC be up?",
      description: "Uses Binance BTC/USDT. Close greater than or equal to open resolves Up.",
      tradingStatus: "open",
      status: "open",
      conditionId: "0xpredict",
      polymarketConditionIds: ["0xpoly"],
      marketVariant: "BTC_UP_DOWN",
      variantData: {
        startTs: "2026-06-04T00:00:00Z",
        endTs: "2026-06-04T01:00:00Z",
        priceFeedProvider: "BINANCE",
        priceFeedSymbol: "BTC_USDT"
      },
      outcomes: ["Up", "Down"]
    });

    expect(market.family).toBe("BTC_UP_DOWN");
    expect(market.cadence).toBe("HOURLY");
    expect(market.resolutionSource).toBe("BINANCE_BTC_USDT");
  });

  it("rejects Predict markets missing required short-window fields", () => {
    const accepted = filterPredictHourlyBtcMarkets(
      [
        {
          id: "missing",
          title: "BTC Up or Down Hourly",
          question: "Will BTC be up?",
          description: "Uses Binance BTC/USDT",
          tradingStatus: "open",
          status: "open",
          marketVariant: "BTC_UP_DOWN"
        }
      ],
      now,
      cfg
    );

    expect(accepted).toEqual([]);
  });
});
