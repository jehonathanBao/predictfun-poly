import { OrderBook, type Outcome, type OrderBookLevel } from "../../domain/models.js";
import { d, ONE, type Decimalish } from "../../domain/money.js";

export type RawLevel = readonly [Decimalish, Decimalish];

export function quantizePrice(value: Decimalish, decimalPrecision: number) {
  return d(value).toDecimalPlaces(decimalPrecision);
}

export function complementPrice(value: Decimalish, decimalPrecision: number) {
  return quantizePrice(ONE.minus(d(value)), decimalPrecision);
}

export function predictYesBookToOutcomeBook(input: {
  yesBids: readonly RawLevel[];
  yesAsks: readonly RawLevel[];
  outcome: Outcome;
  decimalPrecision: number;
  timestampMs?: number;
}): OrderBook {
  const bids = input.yesBids.map(parseLevel);
  const asks = input.yesAsks.map(parseLevel);

  if (input.outcome === "YES") {
    return new OrderBook({
      bids,
      asks,
      decimalPrecision: input.decimalPrecision,
      timestampMs: input.timestampMs
    });
  }

  return new OrderBook({
    bids: asks.map((level) => ({
      price: complementPrice(level.price, input.decimalPrecision),
      size: level.size
    })),
    asks: bids.map((level) => ({
      price: complementPrice(level.price, input.decimalPrecision),
      size: level.size
    })),
    decimalPrecision: input.decimalPrecision,
    timestampMs: input.timestampMs
  });
}

function parseLevel(raw: RawLevel): OrderBookLevel {
  return {
    price: d(raw[0]),
    size: d(raw[1])
  };
}

