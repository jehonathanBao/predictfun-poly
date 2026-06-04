import { type OrderBook, type OrderRequest, type OrderResult, type Outcome } from "../../domain/models.js";
import { type PolymarketClobHeartbeatClient } from "./heartbeat.js";

export interface PolymarketClobClient extends PolymarketClobHeartbeatClient {
  getOrderbook(tokenId: string, outcome: Outcome): Promise<OrderBook>;
  placeOrder(request: OrderRequest): Promise<OrderResult>;
  getOrder(exchangeOrderId: string): Promise<OrderResult>;
  cancelOrder(exchangeOrderId: string): Promise<OrderResult>;
}
