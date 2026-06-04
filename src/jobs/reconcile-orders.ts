import { reconcileOrderReports, type ReconcileInput, type ReconcileResult } from "../execution/flow.js";
import { type TradingClient } from "../adapters/contracts.js";
import { type OrderResult } from "../domain/models.js";
import { type AuditRepo } from "../persistence/repositories/audit-repo.js";
import { type OrderRecord, type OrderRepo } from "../persistence/repositories/order-repo.js";

export async function reconcileOrdersJob(reports: readonly ReconcileInput[]): Promise<readonly ReconcileResult[]> {
  return reports.map(reconcileOrderReports);
}

export interface RestartReconcileInput {
  orderRepo: OrderRepo;
  predictClient: TradingClient;
  polymarketClient: TradingClient;
  auditRepo?: AuditRepo;
}

export interface RestartReconcileResult {
  checked: number;
  updated: number;
  mismatches: number;
}

export async function reconcileOpenOrdersJob(input: RestartReconcileInput): Promise<RestartReconcileResult> {
  const openOrders = await input.orderRepo.findOpenOrders();
  let updated = 0;
  let mismatches = 0;

  for (const order of openOrders) {
    if (!order.externalOrderId) {
      mismatches += 1;
      await recordMismatch(input.auditRepo, order, "open order is missing external_order_id");
      continue;
    }
    const client = order.venue === "PREDICT" ? input.predictClient : input.polymarketClient;
    const venueOrder = await client.getOrder(order.externalOrderId);
    if (statusChanged(order, venueOrder)) {
      await input.orderRepo.updateOrder({
        ...order,
        status: venueOrder.status,
        filledShares: venueOrder.filledShares,
        avgFillPrice: venueOrder.averagePrice,
        rawJson: venueOrder.raw
      });
      updated += 1;
    }
    if (order.filledShares && !order.filledShares.eq(venueOrder.filledShares)) {
      mismatches += 1;
      await recordMismatch(input.auditRepo, order, "DB filled_shares differs from venue filled_shares", venueOrder);
    }
  }

  return {
    checked: openOrders.length,
    updated,
    mismatches
  };
}

function statusChanged(order: OrderRecord, venueOrder: OrderResult): boolean {
  return (
    order.status !== venueOrder.status ||
    order.filledShares === undefined ||
    !order.filledShares.eq(venueOrder.filledShares)
  );
}

async function recordMismatch(
  auditRepo: AuditRepo | undefined,
  order: OrderRecord,
  message: string,
  venueOrder?: OrderResult
): Promise<void> {
  await auditRepo?.record({
    eventType: "order_reconcile_mismatch",
    severity: "warning",
    entityType: "order",
    entityId: order.id,
    message,
    rawJson: {
      order,
      venueOrder
    }
  });
}
