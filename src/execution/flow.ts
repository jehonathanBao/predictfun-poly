import { type FeeRates, type SizingResult } from "../arb/engine.js";
import { type DoctorReport } from "../core/doctor.js";
import { runPreflight, type PreflightInput, type PreflightResult } from "../core/preflight.js";
import { reconcileHedgeState, type HedgeExecutionState } from "../core/state-machine.js";
import { type OrderResult } from "../domain/models.js";
import { type D } from "../domain/money.js";
import { type MarketMatch } from "../matching/strictMatcher.js";
import { type BookBundle, type RiskManager } from "../risk/manager.js";
import {
  confirmOrderFill,
  reconcileExecutionSafety,
  type ExecutionSafetyOutcome,
  type ExecutionSafetyPolicy
} from "./safety.js";

export type ExecutionFlowStep =
  | "LOAD_CONFIG_ACCOUNTS_KEYS"
  | "COMPLIANCE_GEOBLOCK_DOCTOR"
  | "DISCOVER_BTC_MARKETS"
  | "STRICT_MARKET_MATCH"
  | "SUBSCRIBE_ORDERBOOK_WS"
  | "ORDERBOOK_UPDATE_TRIGGERS_ARB"
  | "EVALUATE_TWO_DIRECTIONS"
  | "STRATEGY_ENGINE_PLAN"
  | "HEDGE_ENGINE_SELECT"
  | "RISK_ENGINE_CHECK"
  | "RISK_SIZE_ROTATE_PREFLIGHT"
  | "LOCK_AND_SUBMIT"
  | "CONFIRM_REST_WS_FILLS"
  | "RECONCILE_ORDER_REPORTS"
  | "MARK_HEDGED"
  | "RESCUE_UNHEDGED_OR_PAUSE"
  | "AUDIT_SETTLEMENT_REDEEM_RELEASE";

export const EXECUTION_FLOW_STEPS: readonly ExecutionFlowStep[] = [
  "LOAD_CONFIG_ACCOUNTS_KEYS",
  "COMPLIANCE_GEOBLOCK_DOCTOR",
  "DISCOVER_BTC_MARKETS",
  "STRICT_MARKET_MATCH",
  "SUBSCRIBE_ORDERBOOK_WS",
  "ORDERBOOK_UPDATE_TRIGGERS_ARB",
  "EVALUATE_TWO_DIRECTIONS",
  "STRATEGY_ENGINE_PLAN",
  "HEDGE_ENGINE_SELECT",
  "RISK_ENGINE_CHECK",
  "RISK_SIZE_ROTATE_PREFLIGHT",
  "LOCK_AND_SUBMIT",
  "CONFIRM_REST_WS_FILLS",
  "RECONCILE_ORDER_REPORTS",
  "MARK_HEDGED",
  "RESCUE_UNHEDGED_OR_PAUSE",
  "AUDIT_SETTLEMENT_REDEEM_RELEASE"
];

export interface StartupFlowResult {
  doctor: DoctorReport;
  matches: readonly MarketMatch[];
  nextStep: ExecutionFlowStep;
}

export interface OrderbookUpdateEvaluation {
  comboA: SizingResult;
  comboB: SizingResult;
  best?: SizingResult;
}

export interface ReconcileInput {
  predictResult: OrderResult;
  polymarketResult: OrderResult;
}

export interface ConfirmedReconcileInput {
  predictPlacement: OrderResult;
  polymarketPlacement: OrderResult;
  requestedShares: D;
  policy: ExecutionSafetyPolicy;
  nowMs: number;
  predictRest?: OrderResult;
  predictWs?: OrderResult;
  polymarketRest?: OrderResult;
  polymarketWs?: OrderResult;
  firstUnhedgedAtMs?: number;
  rescueAttempt?: "none" | "succeeded" | "failed";
}

export interface ReconcileResult {
  state: HedgeExecutionState;
  nextStep: ExecutionFlowStep;
}

export function evaluateOrderbookUpdate(input: {
  riskManager: RiskManager;
  books: BookBundle;
  feeRates: FeeRates;
  predictRotator: Parameters<RiskManager["chooseTrade"]>[0]["predictRotator"];
  polymarketAccount: Parameters<RiskManager["chooseTrade"]>[0]["polymarketAccount"];
}): OrderbookUpdateEvaluation {
  const selectedPredictFreeBalance =
    input.predictRotator.candidatesFromNext().find((account) => account.status === "READY")?.availableBalance ??
    input.polymarketAccount.availableCollateral;

  const comboA = input.riskManager.engine.sizeComboA({
    predictYesBook: input.books.predictYes,
    polymarketNoBook: input.books.polymarketNo,
    feeRates: input.feeRates,
    limits: {
      selectedPredictFreeBalance,
      polymarketAvailableCollateral: input.polymarketAccount.availableCollateral
    }
  });
  const comboB = input.riskManager.engine.sizeComboB({
    predictNoBook: input.books.predictNo,
    polymarketYesBook: input.books.polymarketYes,
    feeRates: input.feeRates,
    limits: {
      selectedPredictFreeBalance,
      polymarketAvailableCollateral: input.polymarketAccount.availableCollateral
    }
  });
  const candidates = [comboA, comboB].filter((candidate) => candidate.executable && candidate.quote);
  const best = candidates.sort((left, right) => right.quote!.netProfitUsd.cmp(left.quote!.netProfitUsd))[0];

  return {
    comboA,
    comboB,
    best
  };
}

export function preflightBeforeSubmit(input: PreflightInput): PreflightResult {
  return runPreflight(input);
}

export function reconcileOrderReports(input: ReconcileInput): ReconcileResult {
  const state = reconcileHedgeState({
    predictFilledShares: input.predictResult.filledShares.toFixed(),
    polymarketFilledShares: input.polymarketResult.filledShares.toFixed(),
    predictFailed: input.predictResult.status === "failed",
    polymarketFailed: input.polymarketResult.status === "failed"
  });
  return {
    state,
    nextStep: state === "HEDGED" ? "MARK_HEDGED" : "RESCUE_UNHEDGED_OR_PAUSE"
  };
}

export function reconcileConfirmedOrderReports(input: ConfirmedReconcileInput): ExecutionSafetyOutcome {
  return reconcileExecutionSafety({
    predict: confirmOrderFill({
      placement: input.predictPlacement,
      rest: input.predictRest,
      ws: input.predictWs,
      requestedShares: input.requestedShares
    }),
    polymarket: confirmOrderFill({
      placement: input.polymarketPlacement,
      rest: input.polymarketRest,
      ws: input.polymarketWs,
      requestedShares: input.requestedShares
    }),
    requestedShares: input.requestedShares,
    policy: input.policy,
    nowMs: input.nowMs,
    firstUnhedgedAtMs: input.firstUnhedgedAtMs,
    rescueAttempt: input.rescueAttempt
  });
}
