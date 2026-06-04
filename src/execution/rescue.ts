import {
  PredictAccountRotator,
  isReady,
  type PredictAccountState
} from "../accounts/rotator.js";
import { complementOutcome, type OrderRequest, type OrderResult, type Venue } from "../domain/models.js";
import { d, ZERO, type D, type Decimalish } from "../domain/money.js";

export type RescueAction =
  | "NONE"
  | "BUY_POLYMARKET_COMPLEMENT"
  | "BUY_PREDICT_COMPLEMENT_NEXT_ACCOUNT"
  | "SAFE_METHOD_REQUIRED"
  | "PAUSE_NEW_OPENINGS";

export type RescueSafeMethod = "PAUSE_ONLY" | "POLYMARKET_OFFSET";

export interface RescuePolicy {
  rescueMaxLossUsd: D;
  maxUnhedgedSeconds: number;
  pauseOnUnhedgedResidual: boolean;
  safeMethod: RescueSafeMethod;
}

export interface RescueResidualInput {
  hedgeId: string;
  predictOrder: OrderRequest;
  polymarketOrder: OrderRequest;
  predictResult: OrderResult;
  polymarketResult: OrderResult;
  policy: RescuePolicy;
  nowMs: number;
  firstUnhedgedAtMs?: number;
  predictRotator?: PredictAccountRotator;
  polymarketRescueLimitPrice?: Decimalish;
  predictRescueLimitPrice?: Decimalish;
}

export interface RescueResidualDecision {
  hedgeId: string;
  action: RescueAction;
  residualShares: D;
  rescueVenue?: Venue;
  rescueOrder?: OrderRequest;
  predictAccountId?: string;
  expectedLossUsd: D;
  pause: boolean;
  reasons: readonly string[];
}

export function rescueResidual(input: RescueResidualInput): RescueResidualDecision {
  const residual = input.predictResult.filledShares.minus(input.polymarketResult.filledShares);
  const residualShares = residual.abs();
  const reasons: string[] = [];
  const unhedgedAgeSeconds =
    input.firstUnhedgedAtMs === undefined ? 0 : Math.max(0, input.nowMs - input.firstUnhedgedAtMs) / 1000;

  if (residualShares.lte(0)) {
    return decision(input, "NONE", residualShares, ZERO, false, ["no residual exposure"]);
  }

  if (unhedgedAgeSeconds > input.policy.maxUnhedgedSeconds) {
    return decision(input, "PAUSE_NEW_OPENINGS", residualShares, ZERO, true, ["max_unhedged_seconds exceeded"]);
  }

  if (residual.gt(0)) {
    const rescueLimit = d(input.polymarketRescueLimitPrice ?? input.polymarketOrder.limitPrice);
    const expectedLossUsd = rescueLossUsd(residualShares, rescueLimit, input.polymarketOrder.limitPrice);
    if (expectedLossUsd.gt(input.policy.rescueMaxLossUsd)) {
      return decision(input, "PAUSE_NEW_OPENINGS", residualShares, expectedLossUsd, true, [
        "rescue_max_loss_usd would be exceeded"
      ]);
    }
    return decision(
      input,
      "BUY_POLYMARKET_COMPLEMENT",
      residualShares,
      expectedLossUsd,
      false,
      reasons,
      buildRescueOrder(input.polymarketOrder, residualShares, rescueLimit, input.polymarketOrder.accountId)
    );
  }

  const rescueLimit = d(input.predictRescueLimitPrice ?? input.predictOrder.limitPrice);
  const expectedLossUsd = rescueLossUsd(residualShares, rescueLimit, input.predictOrder.limitPrice);
  if (expectedLossUsd.gt(input.policy.rescueMaxLossUsd)) {
    return decision(input, "PAUSE_NEW_OPENINGS", residualShares, expectedLossUsd, true, [
      "rescue_max_loss_usd would be exceeded"
    ]);
  }

  const nextAccount = nextReadyPredictAccount(input.predictRotator, input.predictOrder.accountId);
  if (nextAccount) {
    return decision(
      input,
      "BUY_PREDICT_COMPLEMENT_NEXT_ACCOUNT",
      residualShares,
      expectedLossUsd,
      false,
      reasons,
      buildRescueOrder(input.predictOrder, residualShares, rescueLimit, nextAccount.accountId),
      nextAccount.accountId
    );
  }

  if (input.policy.safeMethod === "POLYMARKET_OFFSET") {
    return decision(input, "SAFE_METHOD_REQUIRED", residualShares, expectedLossUsd, input.policy.pauseOnUnhedgedResidual, [
      "no READY Predict account is available; use configured Polymarket offset method"
    ]);
  }

  return decision(input, "PAUSE_NEW_OPENINGS", residualShares, expectedLossUsd, true, [
    "no READY Predict account is available for residual rescue"
  ]);
}

function buildRescueOrder(original: OrderRequest, shares: D, limitPrice: D, accountId: string): OrderRequest {
  return {
    ...original,
    side: "BUY",
    orderType: original.orderType === "MARKET" ? "FOK" : original.orderType,
    shares,
    limitPrice,
    accountId,
    outcome: original.outcome,
    clientOrderId: `${original.clientOrderId}-rescue-${Date.now()}`
  };
}

function rescueLossUsd(residualShares: D, rescueLimitPrice: D, plannedLimitPrice: D): D {
  return residualShares.mul(DMax(ZERO, rescueLimitPrice.minus(plannedLimitPrice)));
}

function DMax(left: D, right: D): D {
  return left.gt(right) ? left : right;
}

function nextReadyPredictAccount(rotator: PredictAccountRotator | undefined, originalAccountId: string): PredictAccountState | undefined {
  return rotator?.candidatesFromNext().find((account) => account.accountId !== originalAccountId && isReady(account));
}

function decision(
  input: RescueResidualInput,
  action: RescueAction,
  residualShares: D,
  expectedLossUsd: D,
  pause: boolean,
  reasons: readonly string[],
  rescueOrder?: OrderRequest,
  predictAccountId?: string
): RescueResidualDecision {
  const rescueVenue = rescueOrder?.venue;
  return {
    hedgeId: input.hedgeId,
    action,
    residualShares,
    rescueVenue,
    rescueOrder: rescueOrder
      ? {
          ...rescueOrder,
          outcome: rescueOrder.venue === "PREDICT" ? rescueOrder.outcome : complementOutcome(input.predictOrder.outcome)
        }
      : undefined,
    predictAccountId,
    expectedLossUsd,
    pause: pause || (input.policy.pauseOnUnhedgedResidual && action === "SAFE_METHOD_REQUIRED"),
    reasons
  };
}
