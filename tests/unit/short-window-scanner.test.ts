import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { ResolutionSpec, type BinaryMarketSpec } from "../../src/domain/models.js";
import { StrictMarketMatcher } from "../../src/matching/strictMatcher.js";
import { BtcMarketScanner } from "../../src/markets/scanner.js";

const nowMs = Date.parse("2026-06-04T00:30:00Z");

function resolution() {
  return new ResolutionSpec({
    oracleSystem: "UMA_OPTIMISTIC_ORACLE",
    dataSource: "BINANCE_BTC_USDT",
    rulesHash: "close-gte-open",
    challengePeriodSeconds: 7200,
    finalityRule: "UNLESS_CHALLENGED_THEN_UMA_FINAL"
  });
}

function market(venue: "PREDICT" | "POLYMARKET", overrides: Partial<BinaryMarketSpec> = {}): BinaryMarketSpec {
  return {
    venue,
    venueMarketId: `${venue}-1h`,
    question: "Bitcoin Up or Down Hourly",
    underlying: "BTC",
    contractKind: "UP_DOWN",
    settlementSource: "BINANCE_BTC_USDT",
    windowStartUtc: "2026-06-04T00:00:00Z",
    windowEndUtc: "2026-06-04T01:00:00Z",
    decimalPrecision: 3,
    isBinary: true,
    strike: new Decimal("0"),
    direction: "UP_DOWN",
    resolutionRuleHash: "close-gte-open",
    resolution: resolution(),
    family: "BTC_UP_DOWN",
    cadence: "HOURLY",
    priceFeedProvider: "BINANCE",
    priceFeedSymbol: "BTC_USDT",
    resolutionSource: "BINANCE_BTC_USDT",
    upDownRule: "CLOSE_GTE_OPEN_IS_UP",
    isTradable: true,
    acceptingOrders: true,
    ...overrides
  };
}

describe("BtcMarketScanner short-window gate", () => {
  it("accepts exact 1H BTC Up/Down pairs before strict matching", () => {
    const result = new BtcMarketScanner(new StrictMarketMatcher(), { nowMs }).scan({
      predictMarkets: [market("PREDICT")],
      polymarketMarkets: [market("POLYMARKET")]
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("rejects 4H BTC Up/Down before strict matching", () => {
    const result = new BtcMarketScanner(new StrictMarketMatcher(), { nowMs }).scan({
      predictMarkets: [
        market("PREDICT", {
          venueMarketId: "predict-4h",
          windowEndUtc: "2026-06-04T04:00:00Z",
          family: "BTC_4H_UP_DOWN",
          cadence: "FOUR_HOUR"
        })
      ],
      polymarketMarkets: [market("POLYMARKET")]
    });

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]?.reasons).toContain("REJECT_NOT_BTC_UP_DOWN");
  });
});
