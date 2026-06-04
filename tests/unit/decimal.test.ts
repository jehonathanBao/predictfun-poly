import { describe, expect, it } from "vitest";
import { D, Price, Shares, bps, ceilToTick, floorToTick, gtZeroAfterFees, maxD, minD } from "../../src/core/decimal.js";

describe("decimal helpers", () => {
  it("avoids JavaScript floating point drift", () => {
    expect(D("0.1").plus(D("0.2")).toFixed()).toBe("0.3");
  });

  it("rounds down and up to tick size", () => {
    expect(floorToTick("0.123", "0.01").toFixed(2)).toBe("0.12");
    expect(ceilToTick("0.123", "0.01").toFixed(2)).toBe("0.13");
    expect(ceilToTick("0.120", "0.01").toFixed(2)).toBe("0.12");
  });

  it("rejects invalid tick sizes", () => {
    expect(() => floorToTick("0.12", "0")).toThrow(/tick must be positive/);
  });

  it("calculates basis points with Decimal math", () => {
    expect(bps("100", "25").toFixed()).toBe("0.25");
  });

  it("returns min and max Decimal values", () => {
    expect(minD(D("0.3"), D("0.1"), D("0.2")).toFixed()).toBe("0.1");
    expect(maxD(D("0.3"), D("0.1"), D("0.2")).toFixed()).toBe("0.3");
  });

  it("checks positive values after fees", () => {
    expect(gtZeroAfterFees("0.00000001")).toBe(true);
    expect(gtZeroAfterFees("0")).toBe(false);
    expect(gtZeroAfterFees("-0.01")).toBe(false);
  });

  it("validates price and share helper bounds", () => {
    expect(Price("0.99").toFixed()).toBe("0.99");
    expect(Shares("10").toFixed()).toBe("10");
    expect(() => Price("1.01")).toThrow(/price must be in/);
    expect(() => Shares("-1")).toThrow(/shares must be non-negative/);
  });
});
