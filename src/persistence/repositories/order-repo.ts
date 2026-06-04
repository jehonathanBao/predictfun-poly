import { type D } from "../../domain/money.js";

export interface OrderRecord {
  id?: string;
  hedgeId: string;
  venue: string;
  accountRef: string;
  externalOrderId?: string;
  txHash?: string;
  outcome: string;
  side: string;
  orderType: string;
  limitPrice: D;
  requestedShares: D;
  filledShares?: D;
  avgFillPrice?: D;
  feeUsd?: D;
  status: string;
  rawJson?: Record<string, unknown>;
}

export interface OrderRepo {
  createOrder(order: OrderRecord): Promise<string>;
  updateOrder(order: OrderRecord): Promise<void>;
  findOpenOrders(): Promise<readonly OrderRecord[]>;
}
