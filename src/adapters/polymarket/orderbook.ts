import { OrderBook, type OrderBookLevel } from "../../domain/models.js";
import { d, type Decimalish } from "../../domain/money.js";

export interface PolymarketBookLevel {
  price: Decimalish;
  size: Decimalish;
}

export interface PolymarketBookPayload {
  bids?: readonly PolymarketBookLevel[];
  asks?: readonly PolymarketBookLevel[];
  min_order_size?: Decimalish;
  tick_size?: Decimalish;
}

export function polymarketTokenBookToOrderBook(payload: PolymarketBookPayload, decimalPrecision = 2): OrderBook {
  return new OrderBook({
    bids: parseLevels(payload.bids ?? []),
    asks: parseLevels(payload.asks ?? []),
    decimalPrecision,
    minOrderSize: payload.min_order_size,
    tickSize: payload.tick_size
  });
}

function parseLevels(levels: readonly PolymarketBookLevel[]): readonly OrderBookLevel[] {
  return levels.map((level) => ({
    price: d(level.price),
    size: d(level.size)
  }));
}

