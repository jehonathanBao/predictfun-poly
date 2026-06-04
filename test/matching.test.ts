import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { ResolutionSpec, type BinaryMarketSpec } from "../src/domain/models.js";
import { StrictMarketMatcher } from "../src/matching/strictMatcher.js";

function resolution(overrides: Partial<ConstructorParameters<typeof ResolutionSpec>[0]> = {}) {
  return new ResolutionSpec({
    oracleSystem: "UMA_OPTIMISTIC_ORACLE",
    dataSource: "BINANCE_BTC_USDT",
    rulesHash: "abc",
    challengePeriodSeconds: 7200,
    finalityRule: "UNLESS_CHALLENGED_THEN_UMA_FINAL",
    ...overrides
  });
}

function market(venue: "PREDICT" | "POLYMARKET", overrides: Partial<BinaryMarketSpec> = {}): BinaryMarketSpec {
  return {
    venue,
    venueMarketId: `${venue}-btc`,
    question: "Will BTC be up?",
    underlying: "BTC",
    contractKind: "UP_DOWN",
    settlementSource: "BINANCE_BTC_USDT",
    windowStartUtc: "2026-06-03T00:00:00Z",
    windowEndUtc: "2026-06-03T00:15:00Z",
    decimalPrecision: 3,
    isBinary: true,
    strike: new Decimal("70000"),
    direction: "UP",
    resolutionRuleHash: "abc",
    resolution: resolution(),
    ...overrides
  };
}

describe("StrictMarketMatcher", () => {
  it("matches only field-complete equivalent BTC markets", () => {
    const result = new StrictMarketMatcher().match(market("PREDICT"), market("POLYMARKET"));
    expect(result.matched).toBe(true);
  });

  it("rejects resolution differences even with a direct link", () => {
    const result = new StrictMarketMatcher().match(
      market("PREDICT", { linkedPolymarketConditionIds: ["0xpoly"] }),
      market("POLYMARKET", {
        conditionId: "0xpoly",
        resolution: resolution({ challengePeriodSeconds: 3600 })
      })
    );
    expect(result.matched).toBe(false);
    expect(result.reasons).toContain("strict equivalence mismatch: resolution");
  });
});
