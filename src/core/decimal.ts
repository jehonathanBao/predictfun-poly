import { Decimal } from "decimal.js";
import { assertPrice, d, type Decimalish } from "../domain/money.js";

export * from "../domain/money.js";

export type Money = Decimal;
export type Price = Decimal;
export type Shares = Decimal;

export function D(value: Decimalish): Decimal {
  return d(value);
}

export function Money(value: Decimalish): Money {
  return d(value);
}

export function Price(value: Decimalish): Price {
  const price = d(value);
  assertPrice(price);
  return price;
}

export function Shares(value: Decimalish): Shares {
  const shares = d(value);
  if (shares.lt(0)) {
    throw new Error(`shares must be non-negative, got ${shares.toString()}`);
  }
  return shares;
}

export function floorToTick(value: Decimalish, tick: Decimalish): Decimal {
  const tickSize = positiveTick(tick);
  return d(value).div(tickSize).floor().mul(tickSize);
}

export function ceilToTick(value: Decimalish, tick: Decimalish): Decimal {
  const tickSize = positiveTick(tick);
  return d(value).div(tickSize).ceil().mul(tickSize);
}

export function bps(value: Decimalish, basisPoints: Decimalish): Decimal {
  return d(value).mul(d(basisPoints)).div(10_000);
}

export function gtZeroAfterFees(value: Decimalish): boolean {
  return d(value).gt(0);
}

function positiveTick(tick: Decimalish): Decimal {
  const tickSize = d(tick);
  if (tickSize.lte(0)) {
    throw new Error(`tick must be positive, got ${tickSize.toString()}`);
  }
  return tickSize;
}
