import { type OrderRequest, type OrderResult } from "../../domain/models.js";

export interface PolymarketOrdersAdapter {
  placeOrder(request: OrderRequest): Promise<OrderResult>;
  getOrder(exchangeOrderId: string): Promise<OrderResult>;
  cancelOrder(exchangeOrderId: string): Promise<OrderResult>;
}

