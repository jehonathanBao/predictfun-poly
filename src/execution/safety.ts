import { complementOutcome, isOpen, type OrderRequest, type OrderResult, type OrderStatus, type Venue } from "../domain/models.js";
import { ONE, ZERO, type D } from "../domain/money.js";
import { type HedgeExecutionState } from "../core/state-machine.js";

export type ConfirmationSource = "PLACE" | "REST" | "WS";

export type ExecutionSafetyAction =
  | "MARK_HEDGED"
  | "WAIT_FOR_CONFIRMATIONS"
  | "CANCEL_UNFILLED_ORDERS"
  | "RESCUE_PREDICT_LEG"
  | "RESCUE_POLYMARKET_LEG"
  | "RELEASE_PREDICT_ACCOUNT_LOCK"
  | "PAUSE_NEW_OPENINGS"
  | "ALERT";

export interface ExecutionSafetyPolicy {
  maxUnhedgedMs: number;
  cancelUnfilledOrders: boolean;
  postTradeReconcileRequired: boolean;
  pauseOnUnhedgedResidual: boolean;
}

export interface ConservativeOrderPlanInput {
  predictOrder: OrderRequest;
  polymarketOrder: OrderRequest;
  predictWorstAcceptablePrice: D;
  polymarketWorstAcceptablePrice: D;
}

export interface SafetyCheckResult {
  ok: boolean;
  reasons: readonly string[];
}

export interface OrderFillConfirmationInput {
  placement: OrderResult;
  requestedShares: D;
  rest?: OrderResult;
  ws?: OrderResult;
  requireRestAndWs?: boolean;
}

export interface OrderFillConfirmation {
  venue: Venue;
  clientOrderId: string;
  status: OrderStatus;
  filledShares: D;
  confirmed: boolean;
  failed: boolean;
  open: boolean;
  partial: boolean;
  sources: readonly ConfirmationSource[];
  reasons: readonly string[];
}

export interface ExecutionSafetyReconcileInput {
  predict: OrderFillConfirmation;
  polymarket: OrderFillConfirmation;
  requestedShares: D;
  policy: ExecutionSafetyPolicy;
  nowMs: number;
  firstUnhedgedAtMs?: number;
  rescueAttempt?: "none" | "succeeded" | "failed";
}

export interface ExecutionSafetyOutcome {
  state: HedgeExecutionState;
  residualShares: D;
  rescueVenue?: Venue;
  actions: readonly ExecutionSafetyAction[];
  reasons: readonly string[];
  pauseReason?: string;
}

const CONSERVATIVE_ORDER_TYPES = new Set<OrderRequest["orderType"]>(["FOK", "FAK", "LIMIT"]);

export function validateConservativeOrderPlan(input: ConservativeOrderPlanInput): SafetyCheckResult {
  const reasons: string[] = [];
  const { predictOrder, polymarketOrder } = input;

  if (predictOrder.venue !== "PREDICT") reasons.push("plan must contain a Predict order");
  if (polymarketOrder.venue !== "POLYMARKET") reasons.push("plan must contain a Polymarket order");
  if (predictOrder.side !== "BUY" || polymarketOrder.side !== "BUY") reasons.push("only buy/buy hedges are allowed");
  if (predictOrder.outcome !== complementOutcome(polymarketOrder.outcome)) {
    reasons.push("orders must buy complementary outcomes");
  }
  if (!predictOrder.shares.eq(polymarketOrder.shares)) reasons.push("hedge legs must use equal share size");
  if (predictOrder.shares.lte(0)) reasons.push("hedge share size must be positive");

  validateBoundedBuyOrder(reasons, predictOrder, input.predictWorstAcceptablePrice);
  validateBoundedBuyOrder(reasons, polymarketOrder, input.polymarketWorstAcceptablePrice);

  return { ok: reasons.length === 0, reasons };
}

export function confirmOrderFill(input: OrderFillConfirmationInput): OrderFillConfirmation {
  const requireRestAndWs = input.requireRestAndWs ?? true;
  const reports: Array<[ConfirmationSource, OrderResult]> = [["PLACE", input.placement]];
  const reasons: string[] = [];

  if (input.rest) reports.push(["REST", input.rest]);
  if (input.ws) reports.push(["WS", input.ws]);

  if (requireRestAndWs && !input.rest) reasons.push(`${input.placement.venue} REST confirmation is missing`);
  if (requireRestAndWs && !input.ws) reasons.push(`${input.placement.venue} WS confirmation is missing`);
  if (input.rest && input.ws && !input.rest.filledShares.eq(input.ws.filledShares)) {
    reasons.push(`${input.placement.venue} REST/WS filled_shares mismatch`);
  }

  const authoritative =
    input.rest && input.ws && input.rest.filledShares.eq(input.ws.filledShares)
      ? input.rest
      : input.rest ?? input.ws ?? input.placement;
  const filledShares = authoritative.filledShares;
  const failed = reports.some(([, report]) => isTerminalFailure(report.status, report.filledShares));
  const open = reports.some(([, report]) => isOpen(report.status));

  return {
    venue: input.placement.venue,
    clientOrderId: input.placement.clientOrderId,
    status: authoritative.status,
    filledShares,
    confirmed: reasons.length === 0,
    failed,
    open,
    partial: filledShares.gt(0) && filledShares.lt(input.requestedShares),
    sources: reports.map(([source]) => source),
    reasons
  };
}

export function reconcileExecutionSafety(input: ExecutionSafetyReconcileInput): ExecutionSafetyOutcome {
  const actions = new Set<ExecutionSafetyAction>();
  const reasons = [...input.predict.reasons, ...input.polymarket.reasons];
  const predictFilled = input.predict.filledShares;
  const polymarketFilled = input.polymarket.filledShares;
  const unhedgedAgeMs = input.firstUnhedgedAtMs === undefined ? 0 : Math.max(0, input.nowMs - input.firstUnhedgedAtMs);

  if (input.policy.cancelUnfilledOrders && hasUnfilledExposure(input)) {
    actions.add("CANCEL_UNFILLED_ORDERS");
  }

  if (input.policy.postTradeReconcileRequired && (!input.predict.confirmed || !input.polymarket.confirmed)) {
    actions.add("WAIT_FOR_CONFIRMATIONS");
    if ((predictFilled.gt(0) || polymarketFilled.gt(0)) && unhedgedAgeMs > input.policy.maxUnhedgedMs) {
      actions.add("PAUSE_NEW_OPENINGS");
      actions.add("ALERT");
      return outcome("PAUSED", predictFilled.minus(polymarketFilled).abs(), actions, reasons, undefined, "max_unhedged_seconds exceeded");
    }
    return outcome("RECONCILING", ZERO, actions, reasons);
  }

  if (predictFilled.eq(0) && polymarketFilled.eq(0) && input.predict.failed && input.polymarket.failed) {
    actions.add("RELEASE_PREDICT_ACCOUNT_LOCK");
    return outcome("FAILED", ZERO, actions, reasons);
  }

  if (predictFilled.eq(polymarketFilled) && predictFilled.gt(0) && input.predict.confirmed && input.polymarket.confirmed) {
    actions.add("MARK_HEDGED");
    return outcome("HEDGED", ZERO, actions, reasons);
  }

  if (predictFilled.eq(polymarketFilled) && predictFilled.gt(0)) {
    return outcome("RECONCILING", ZERO, actions, reasons);
  }

  if (predictFilled.eq(0) && polymarketFilled.eq(0)) {
    return outcome("RECONCILING", ZERO, actions, reasons);
  }

  const residualShares = predictFilled.minus(polymarketFilled).abs();
  const rescueVenue: Venue = predictFilled.lt(polymarketFilled) ? "PREDICT" : "POLYMARKET";
  actions.add(rescueVenue === "PREDICT" ? "RESCUE_PREDICT_LEG" : "RESCUE_POLYMARKET_LEG");
  actions.add("ALERT");
  reasons.push(`${rescueVenue} leg is short by ${residualShares.toFixed()} shares`);

  if (input.policy.pauseOnUnhedgedResidual) {
    actions.add("PAUSE_NEW_OPENINGS");
  }

  if (input.rescueAttempt === "failed") {
    actions.add("PAUSE_NEW_OPENINGS");
    return outcome("PAUSED", residualShares, actions, reasons, rescueVenue, "residual rescue failed");
  }
  if (input.policy.maxUnhedgedMs >= 0 && unhedgedAgeMs > input.policy.maxUnhedgedMs) {
    actions.add("PAUSE_NEW_OPENINGS");
    return outcome("PAUSED", residualShares, actions, reasons, rescueVenue, "max_unhedged_seconds exceeded");
  }

  return outcome("RESCUE", residualShares, actions, reasons, rescueVenue);
}

export function buildResidualRescueOrder(input: {
  outcome: ExecutionSafetyOutcome;
  predictOrder: OrderRequest;
  polymarketOrder: OrderRequest;
  suffix?: string;
}): OrderRequest | undefined {
  if (!input.outcome.rescueVenue || input.outcome.residualShares.lte(0)) return undefined;
  const original = input.outcome.rescueVenue === "PREDICT" ? input.predictOrder : input.polymarketOrder;
  return {
    ...original,
    shares: input.outcome.residualShares,
    clientOrderId: `${original.clientOrderId}-${input.suffix ?? "rescue"}`
  };
}

function validateBoundedBuyOrder(reasons: string[], order: OrderRequest, worstAcceptablePrice: D): void {
  if (!CONSERVATIVE_ORDER_TYPES.has(order.orderType)) {
    reasons.push(`${order.venue} order type must be FOK, FAK, or bounded LIMIT`);
  }
  if (order.orderType === "MARKET") {
    reasons.push(`${order.venue} naked MARKET orders are disabled`);
  }
  if (order.limitPrice.lte(0) || order.limitPrice.gt(ONE)) {
    reasons.push(`${order.venue} limit price must be in (0, 1]`);
  }
  if (order.limitPrice.gt(worstAcceptablePrice)) {
    reasons.push(`${order.venue} limit price exceeds the quote worst acceptable price`);
  }
  if (order.signedPayload?.postOnly === true) {
    reasons.push(`${order.venue} post-only orders cannot be used for immediate hedging`);
  }
}

function hasUnfilledExposure(input: ExecutionSafetyReconcileInput): boolean {
  return input.predict.open || input.polymarket.open || input.predict.partial || input.polymarket.partial;
}

function isTerminalFailure(status: OrderStatus, filledShares: D): boolean {
  return status === "failed" || (status === "cancelled" && filledShares.eq(0));
}

function outcome(
  state: HedgeExecutionState,
  residualShares: D,
  actions: Set<ExecutionSafetyAction>,
  reasons: readonly string[],
  rescueVenue?: Venue,
  pauseReason?: string
): ExecutionSafetyOutcome {
  return {
    state,
    residualShares,
    rescueVenue,
    actions: [...actions],
    reasons,
    pauseReason
  };
}
