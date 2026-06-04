import { describe, expect, it } from "vitest";
import { PredictAccountRotator, predictAccount } from "../../src/core/account-rotator.js";
import { ArbEngine, defaultRiskConfig } from "../../src/core/arb-engine.js";
import { OrderBook } from "../../src/core/types.js";
import { d } from "../../src/core/decimal.js";
import { RiskManager } from "../../src/core/risk-manager.js";

function book(askPrice: string) {
  return new OrderBook({
    bids: [{ price: d("0.01"), size: d("100") }],
    asks: [{ price: d(askPrice), size: d("100") }],
    decimalPrecision: 3
  });
}

describe("RiskManager", () => {
  it("chooses an executable hedge and reserves a Predict account", () => {
    const manager = new RiskManager(
      new ArbEngine({
        ...defaultRiskConfig,
        predictSlippageBps: d(0),
        polymarketSlippageBps: d(0),
        latencyBufferBps: d(0)
      })
    );
    const rotator = new PredictAccountRotator([
      predictAccount({ accountId: "p1", address: "0x1", availableBalance: "100" })
    ]);

    const decision = manager.chooseTrade({
      books: {
        predictYes: book("0.40"),
        predictNo: book("0.41"),
        polymarketYes: book("0.50"),
        polymarketNo: book("0.50")
      },
      feeRates: { predictFeeRateBps: 0, polymarketFeeRateBps: 0 },
      predictRotator: rotator,
      polymarketAccount: {
        accountId: "poly",
        address: "0xpoly",
        availableCollateral: d("100"),
        paused: false
      }
    });

    expect(decision.accepted).toBe(true);
    expect(decision.predictAccountId).toBe("p1");
  });
});

