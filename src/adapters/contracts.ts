import { type HeldPosition } from "../accounts/rotator.js";
import { type BinaryMarketSpec, type OrderBook, type OrderRequest, type OrderResult, type Outcome } from "../domain/models.js";
import { type D } from "../domain/money.js";

export interface TradingClient {
  placeOrder(request: OrderRequest): Promise<OrderResult>;
  getOrder(exchangeOrderId: string): Promise<OrderResult>;
  cancelOrder(exchangeOrderId: string): Promise<OrderResult>;
}

export interface PredictAdapter extends TradingClient {
  listBtcMarkets(): Promise<readonly BinaryMarketSpec[]>;
  getOrderbook(market: BinaryMarketSpec, outcome: Outcome): Promise<OrderBook>;
  getAvailableBalance(accountId: string): Promise<D>;
  getOpenOrderCount(accountId: string): Promise<number>;
  getHeldPosition(accountId: string): Promise<HeldPosition | undefined>;
}

export interface PolymarketAdapter extends TradingClient {
  listBtcMarkets(): Promise<readonly BinaryMarketSpec[]>;
  getOrderbook(market: BinaryMarketSpec, outcome: Outcome): Promise<OrderBook>;
  getAvailableCollateral(): Promise<D>;
}

