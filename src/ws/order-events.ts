import { type PredictWsEvent } from "../adapters/predict/ws.js";
import { type PolymarketUserEvent } from "../adapters/polymarket/ws-user.js";
import { d } from "../domain/money.js";
import { type OrderRecord, type OrderRepo } from "../persistence/repositories/order-repo.js";

export type PrivateOrderEvent = PredictWsEvent | PolymarketUserEvent;

export interface PrivateOrderEventApplyResult {
  applied: boolean;
  reason?: string;
}

export async function applyPrivateOrderEventToOrderRepo(input: {
  orderRepo: OrderRepo;
  event: PrivateOrderEvent;
  existingOrder?: OrderRecord;
}): Promise<PrivateOrderEventApplyResult> {
  const update = normalizePrivateOrderEvent(input.event);
  if (!update) return { applied: false, reason: "event does not describe an order update" };
  if (!input.existingOrder) return { applied: false, reason: "existing order record is required" };

  await input.orderRepo.updateOrder({
    ...input.existingOrder,
    externalOrderId: update.externalOrderId ?? input.existingOrder.externalOrderId,
    status: update.status ?? input.existingOrder.status,
    filledShares: update.filledShares ?? input.existingOrder.filledShares,
    avgFillPrice: update.avgFillPrice ?? input.existingOrder.avgFillPrice,
    rawJson: {
      previous: input.existingOrder.rawJson,
      event: input.event as Record<string, unknown>
    }
  });
  return { applied: true };
}

function normalizePrivateOrderEvent(event: PrivateOrderEvent): {
  externalOrderId?: string;
  status?: string;
  filledShares?: ReturnType<typeof d>;
  avgFillPrice?: ReturnType<typeof d>;
} | null {
  const topic = "topic" in event && typeof event.topic === "string" ? event.topic : undefined;
  if (topic?.startsWith("predictWalletEvents/")) {
    const data = event.data;
    if (!isRecord(data)) return null;
    return {
      externalOrderId: stringField(data, "orderId") ?? stringField(data, "orderHash"),
      status: predictStatus(stringField(data, "eventType")),
      filledShares: decimalField(data, "filledShares") ?? decimalField(data, "filled_shares"),
      avgFillPrice: decimalField(data, "averagePrice") ?? decimalField(data, "avgFillPrice")
    };
  }
  if ("event_type" in event || "type" in event) {
    return {
      externalOrderId: stringField(event, "id") ?? stringField(event, "order_id"),
      status: stringField(event, "status") ?? stringField(event, "type"),
      filledShares: decimalField(event, "filled_size") ?? decimalField(event, "size"),
      avgFillPrice: decimalField(event, "price") ?? decimalField(event, "avg_price")
    };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function predictStatus(eventType: string | undefined): string | undefined {
  if (!eventType) return undefined;
  if (eventType === "orderAccepted") return "live";
  if (eventType === "orderTransactionSuccess") return "matched";
  if (eventType === "orderCancelled" || eventType === "orderExpired") return "cancelled";
  if (eventType === "orderNotAccepted" || eventType === "orderTransactionFailed") return "failed";
  return eventType;
}

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function decimalField(source: Record<string, unknown>, key: string): ReturnType<typeof d> | undefined {
  const value = source[key];
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return d(String(value));
}
