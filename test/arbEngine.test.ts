import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { ArbEngine, defaultRiskConfig } from "../src/arb/engine.js";
import { OrderBook } from "../src/domain/models.js";
import { d } from "../src/domain/money.js";

function book(askPrice: string, size = "10") {
  return new OrderBook({
    bids: [{ price: d("0.01"), size: d(size) }],
    asks: [{ price: d(askPrice), size: d(size) }],
    decimalPrecision: 3
  });
}

describe("ArbEngine", () => {
  it("exposes combo A and combo B as the only basic buy/buy combos", () => {
    const engine = new ArbEngine({
      ...defaultRiskConfig,
      predictSlippageBps: d(0),
      polymarketSlippageBps: d(0),
      latencyBufferBps: d(0)
    });
    const comboA = engine.evaluateComboA({
      shares: "10",
      predictYesBook: book("0.45"),
      polymarketNoBook: book("0.50"),
      feeRates: { predictFeeRateBps: 0, polymarketFeeRateBps: 0 }
    });
    const comboB = engine.evaluateComboB({
      shares: "10",
      predictNoBook: book("0.46"),
      polymarketYesBook: book("0.47"),
      feeRates: { predictFeeRateBps: 0, polymarketFeeRateBps: 0 }
    });

    expect(comboA.combo).toBe("COMBO_A");
    expect(comboA.predictLeg.outcome).toBe("YES");
    expect(comboA.polymarketLeg.outcome).toBe("NO");
    expect(comboB.combo).toBe("COMBO_B");
    expect(comboB.predictLeg.outcome).toBe("NO");
    expect(comboB.polymarketLeg.outcome).toBe("YES");
  });

  it("requires positive profit after all buffers", () => {
    const engine = new ArbEngine({
      ...defaultRiskConfig,
      predictSlippageBps: d(0),
      polymarketSlippageBps: d(0),
      latencyBufferBps: d(0),
      gasOrFixedCostPerShare: d("0.02"),
      roundingBufferPerShare: d("0.01")
    });
    const quote = engine.evaluateComboA({
      shares: "10",
      predictYesBook: book("0.49"),
      polymarketNoBook: book("0.49"),
      feeRates: { predictFeeRateBps: 0, polymarketFeeRateBps: 0 }
    });

    expect(quote.executable).toBe(false);
    expect(quote.netCostPerShare.toFixed(2)).toBe("1.01");
    expect(quote.profitPerShare.toFixed(2)).toBe("-0.01");
  });

  it("sizes by the minimum of depth, balances, collateral, and trade cap", () => {
    const engine = new ArbEngine({
      ...defaultRiskConfig,
      predictSlippageBps: d(0),
      polymarketSlippageBps: d(0),
      latencyBufferBps: d(0)
    });
    const result = engine.sizeComboA({
      predictYesBook: book("0.40", "100"),
      polymarketNoBook: book("0.50", "100"),
      feeRates: { predictFeeRateBps: 0, polymarketFeeRateBps: 0 },
      limits: {
        selectedPredictFreeBalance: new Decimal("100"),
        polymarketAvailableCollateral: new Decimal("100"),
        perTradeMaxUsd: new Decimal("20")
      }
    });

    expect(result.executable).toBe(true);
    expect(result.limitedBy).toContain("per_trade_max_usd");
  });
});
