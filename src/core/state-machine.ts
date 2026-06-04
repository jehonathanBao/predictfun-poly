export type PredictAccountLifecycleState =
  | "READY"
  | "HELD"
  | "HELD_OPEN"
  | "HELD_AWAITING_RESOLUTION"
  | "HELD_REDEEMABLE"
  | "REDEEMING"
  | "INSUFFICIENT"
  | "AUTH_ERROR"
  | "COOLDOWN"
  | "SETTLING"
  | "DISABLED";

export const allowedPredictAccountTransitions: Record<PredictAccountLifecycleState, readonly PredictAccountLifecycleState[]> = {
  READY: ["COOLDOWN", "HELD", "HELD_OPEN", "INSUFFICIENT", "AUTH_ERROR", "DISABLED"],
  HELD: ["SETTLING", "HELD_AWAITING_RESOLUTION", "HELD_REDEEMABLE", "REDEEMING", "READY", "AUTH_ERROR", "DISABLED"],
  HELD_OPEN: ["HELD_AWAITING_RESOLUTION", "HELD_REDEEMABLE", "REDEEMING", "AUTH_ERROR", "DISABLED"],
  HELD_AWAITING_RESOLUTION: ["HELD_REDEEMABLE", "REDEEMING", "AUTH_ERROR", "DISABLED"],
  HELD_REDEEMABLE: ["REDEEMING", "READY", "AUTH_ERROR", "DISABLED"],
  REDEEMING: ["READY", "HELD_REDEEMABLE", "AUTH_ERROR", "DISABLED"],
  INSUFFICIENT: ["READY", "AUTH_ERROR", "DISABLED"],
  AUTH_ERROR: ["READY", "DISABLED"],
  COOLDOWN: ["READY", "HELD", "HELD_OPEN", "INSUFFICIENT", "AUTH_ERROR", "DISABLED"],
  SETTLING: ["READY", "HELD", "HELD_AWAITING_RESOLUTION", "HELD_REDEEMABLE", "AUTH_ERROR", "DISABLED"],
  DISABLED: ["READY"]
};

export function canPredictAccountTransition(
  from: PredictAccountLifecycleState,
  to: PredictAccountLifecycleState
): boolean {
  return allowedPredictAccountTransitions[from].includes(to);
}

export type HedgeExecutionState =
  | "PLANNED"
  | "LOCKED"
  | "SUBMITTING"
  | "RECONCILING"
  | "HEDGED"
  | "RESCUE"
  | "UNHEDGED"
  | "PAUSED"
  | "FAILED"
  | "SETTLING"
  | "REDEEMED";

export const allowedHedgeTransitions: Record<HedgeExecutionState, readonly HedgeExecutionState[]> = {
  PLANNED: ["LOCKED", "PAUSED", "FAILED"],
  LOCKED: ["SUBMITTING", "PAUSED", "FAILED"],
  SUBMITTING: ["RECONCILING", "RESCUE", "UNHEDGED", "PAUSED", "FAILED"],
  RECONCILING: ["HEDGED", "RESCUE", "UNHEDGED", "PAUSED", "FAILED"],
  HEDGED: ["SETTLING", "PAUSED"],
  RESCUE: ["HEDGED", "UNHEDGED", "PAUSED", "FAILED"],
  UNHEDGED: ["RESCUE", "PAUSED", "FAILED"],
  PAUSED: ["RESCUE", "FAILED"],
  FAILED: [],
  SETTLING: ["REDEEMED", "PAUSED", "FAILED"],
  REDEEMED: []
};

export function canHedgeTransition(from: HedgeExecutionState, to: HedgeExecutionState): boolean {
  return allowedHedgeTransitions[from].includes(to);
}

export function reconcileHedgeState(input: {
  predictFilledShares: string;
  polymarketFilledShares: string;
  predictFailed: boolean;
  polymarketFailed: boolean;
}): HedgeExecutionState {
  const predictFilled = input.predictFilledShares !== "0";
  const polyFilled = input.polymarketFilledShares !== "0";
  if (input.predictFailed && input.polymarketFailed) return "FAILED";
  if (predictFilled && polyFilled && input.predictFilledShares === input.polymarketFilledShares) return "HEDGED";
  if (predictFilled || polyFilled) return "UNHEDGED";
  if (input.predictFailed || input.polymarketFailed) return "RESCUE";
  return "RECONCILING";
}
