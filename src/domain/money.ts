import { Decimal } from "decimal.js";

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP
});

export type Decimalish = Decimal.Value;
export type D = Decimal;

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);

export function d(value: Decimalish): Decimal {
  return new Decimal(value);
}

export function assertPrice(value: Decimal, name = "price"): void {
  if (value.lt(0) || value.gt(1)) {
    throw new Error(`${name} must be in [0, 1], got ${value.toString()}`);
  }
}

export function minD(...values: Decimal[]): Decimal {
  if (values.length === 0) {
    throw new Error("minD requires at least one value");
  }
  return values.reduce((best, value) => (value.lt(best) ? value : best));
}

export function maxD(...values: Decimal[]): Decimal {
  if (values.length === 0) {
    throw new Error("maxD requires at least one value");
  }
  return values.reduce((best, value) => (value.gt(best) ? value : best));
}
