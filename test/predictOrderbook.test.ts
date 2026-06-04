import { describe, expect, it } from "vitest";
import { predictYesBookToOutcomeBook } from "../src/adapters/predict/orderbook.js";

describe("Predict YES-based orderbook conversion", () => {
  it("converts YES bids into NO asks when buying NO", () => {
    const book = predictYesBookToOutcomeBook({
      yesBids: [["0.491", "303518.1"]],
      yesAsks: [["0.492", "30192.26"]],
      outcome: "NO",
      decimalPrecision: 3
    });

    expect(book.asks[0]?.price.toFixed(3)).toBe("0.509");
    expect(book.asks[0]?.size.toString()).toBe("303518.1");
    expect(book.bids[0]?.price.toFixed(3)).toBe("0.508");
  });
});

