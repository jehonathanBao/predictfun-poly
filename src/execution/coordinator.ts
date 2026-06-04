import {
  PredictAccountRotator,
  ensurePolymarketCanOpen,
  isReady,
  type HeldPosition,
  type PolymarketAccountState
} from "../accounts/rotator.js";
import { type PolymarketAdapter, type PredictAdapter } from "../adapters/contracts.js";
import { alert, type AlertSink } from "../alerts/alertSink.js";
import { auditEvent, type AuditSink } from "../audit/auditSink.js";
import { ArbEngine, type FeeRates } from "../arb/engine.js";
import { MarketDiscovery } from "../discovery/marketDiscovery.js";
import { type BinaryMarketSpec, type OrderRequest, type OrderResult } from "../domain/models.js";
import { d, ZERO, type D } from "../domain/money.js";
import { isEligibleShortWindowBtcMarket, type ShortWindowFilterConfig } from "../core/short-window-market-filter.js";
import { type NormalizedMarket } from "../core/types.js";
import { BtcMarketScanner } from "../markets/scanner.js";
import { emitMonitorEvent, orderSubmitted, tradeRejected, botPaused } from "../monitoring/observability.js";
import { type MetricsSink } from "../monitoring/metrics.js";
import { StrategyEngine } from "../strategy/strategy-engine.js";
import { type StrategyConfig } from "../strategy/types.js";
import {
  buildResidualRescueOrder,
  confirmOrderFill,
  reconcileExecutionSafety,
  validateConservativeOrderPlan,
  type ExecutionSafetyOutcome,
  type ExecutionSafetyPolicy
} from "./safety.js";

export interface CoordinatorResult {
  paused: boolean;
  pauseReason?: string;
  executed: number;
}

const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  strategyMode: "pure_arbitrage",
  hedgeEnabled: false,
  maxNetExposureUsd: ZERO,
  maxPredictUsagePct: d("0.30"),
  minProfitAfterHedgeFee: ZERO
};

export interface ShortWindowExecutionGuardInput {
  market: NormalizedMarket;
  nowMs: number;
  cfg: ShortWindowFilterConfig;
  staleBookMs: number;
  predictBookTs: number;
  polymarketBookTs: number;
  expectedProfitUsd: D;
  expectedProfitPerShare: D;
  orderType: OrderRequest["orderType"];
}

export interface ShortWindowExecutionGuardResult {
  ok: boolean;
  reasons: readonly string[];
  secondsToClose?: number;
}

export function validateShortWindowExecutionGuard(input: ShortWindowExecutionGuardInput): ShortWindowExecutionGuardResult {
  const reasons: string[] = [];
  const eligibility = isEligibleShortWindowBtcMarket(input.market, input.nowMs, input.cfg);
  if (!eligibility.approved) reasons.push(`REJECT_${eligibility.reason}`);
  if (input.nowMs - input.predictBookTs > input.staleBookMs || input.nowMs - input.polymarketBookTs > input.staleBookMs) {
    reasons.push("REJECT_STALE_BOOK");
  }
  if (input.expectedProfitUsd.lte(0) || input.expectedProfitPerShare.lte(0)) {
    reasons.push("REJECT_NO_PROFIT_AFTER_RECHECK");
  }
  if (input.orderType === "MARKET") {
    reasons.push("REJECT_NAKED_MARKET_ORDER");
  }

  return {
    ok: reasons.length === 0,
    reasons: [...new Set(reasons)],
    secondsToClose: eligibility.approved ? eligibility.secondsToClose : undefined
  };
}

export class ExecutionCoordinator {
  constructor(
    private readonly deps: {
      predict: PredictAdapter;
      polymarket: PolymarketAdapter;
      predictRotator: PredictAccountRotator;
      polymarketAccount: PolymarketAccountState;
      engine: ArbEngine;
      feeRates: FeeRates;
      audit?: AuditSink;
      alerts?: AlertSink;
      metrics?: MetricsSink;
      dryRun: boolean;
      liveTradingEnabled: boolean;
      safetyPolicy?: ExecutionSafetyPolicy;
      strategyConfig?: StrategyConfig;
      strategyEngine?: StrategyEngine;
    }
  ) {}

  async runOnce(): Promise<CoordinatorResult> {
    const discovery = new MarketDiscovery(this.deps.predict, this.deps.polymarket);
    const discovered = await discovery.discover();
    await this.record("market_discovery", "discovered BTC markets", {
      predict: discovered.predictMarkets.length,
      polymarket: discovered.polymarketMarkets.length
    });

    const scan = new BtcMarketScanner().scan(discovered);
    await this.record("market_matcher", "strict matcher completed", {
      accepted: scan.accepted.length,
      rejected: scan.rejected.length
    });

    try {
      ensurePolymarketCanOpen(this.deps.polymarketAccount);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Polymarket account paused";
      await emitMonitorEvent(
        { metrics: this.deps.metrics, alerts: this.deps.alerts },
        botPaused("POLYMARKET_INSUFFICIENT_BALANCE", reason)
      );
      await this.warn(reason);
      return { paused: true, pauseReason: reason, executed: 0 };
    }

    let executed = 0;
    for (const match of scan.accepted) {
      const books = {
        predictYes: await this.deps.predict.getOrderbook(match.predict, "YES"),
        predictNo: await this.deps.predict.getOrderbook(match.predict, "NO"),
        polymarketYes: await this.deps.polymarket.getOrderbook(match.polymarket, "YES"),
        polymarketNo: await this.deps.polymarket.getOrderbook(match.polymarket, "NO")
      };
      const account = this.deps.predictRotator.candidatesFromNext().find((candidate) => isReady(candidate));
      if (!account) {
        await emitMonitorEvent(
          { metrics: this.deps.metrics, alerts: this.deps.alerts },
          {
            eventType: "ALL_PREDICT_ACCOUNTS_UNAVAILABLE",
            severity: "warning",
            reasonCode: "ALL_PREDICT_ACCOUNTS_UNAVAILABLE",
            message: "all Predict accounts are unavailable",
            marketPairId: `${match.predict.venueMarketId}:${match.polymarket.venueMarketId}`
          }
        );
        continue;
      }
      const sized = this.deps.engine.sizeComboA({
        predictYesBook: books.predictYes,
        polymarketNoBook: books.polymarketNo,
        feeRates: this.deps.feeRates,
        limits: {
          selectedPredictFreeBalance: account.availableBalance,
          polymarketAvailableCollateral: this.deps.polymarketAccount.availableCollateral
        }
      });
      if (!sized.executable || !sized.quote) {
        await emitMonitorEvent(
          { metrics: this.deps.metrics },
          tradeRejected("NO_PROFIT_AFTER_BUFFERS", "sized hedge rejected", { reasons: sized.reasons })
        );
        continue;
      }
      const strategyDecision = (this.deps.strategyEngine ?? new StrategyEngine()).evaluate({
        config: this.deps.strategyConfig ?? DEFAULT_STRATEGY_CONFIG,
        pureArbitrage: {
          sizing: sized,
          predictAccountId: account.accountId,
          selectedPredictFreeBalance: account.availableBalance
        }
      });
      if (!strategyDecision.accepted || !strategyDecision.plan) {
        await emitMonitorEvent(
          { metrics: this.deps.metrics },
          tradeRejected("STRATEGY_REJECTED", "strategy layer rejected hedge", { reasons: strategyDecision.reasons })
        );
        continue;
      }
      if (strategyDecision.plan.action !== "OPEN_PURE_ARBITRAGE") {
        await emitMonitorEvent(
          { metrics: this.deps.metrics },
          tradeRejected("STRATEGY_REJECTED", "strategy plan is signal-only and cannot submit orders", {
            action: strategyDecision.plan.action,
            mode: strategyDecision.plan.mode,
            metadata: strategyDecision.plan.metadata
          })
        );
        continue;
      }
      const reserved = this.deps.predictRotator.reserve(account.accountId);
      const predictLeg = strategyDecision.plan.legs.find((leg) => leg.venue === "PREDICT");
      const polymarketLeg = strategyDecision.plan.legs.find((leg) => leg.venue === "POLYMARKET");
      if (!predictLeg || !polymarketLeg) {
        this.deps.predictRotator.release(reserved.accountId);
        await emitMonitorEvent(
          { metrics: this.deps.metrics },
          tradeRejected("STRATEGY_REJECTED", "strategy plan missing required venue legs", { plan: strategyDecision.plan })
        );
        continue;
      }
      const predictOrder: OrderRequest = {
        venue: "PREDICT",
        marketId: match.predict.venueMarketId,
        outcome: predictLeg.outcome,
        side: "BUY",
        orderType: "FOK",
        shares: sized.quote.shares,
        limitPrice: sized.quote.predictLeg.fill.worstPrice ?? sized.quote.predictLeg.fill.averagePrice,
        accountId: reserved.accountId,
        clientOrderId: `predict-${match.predict.venueMarketId}`
      };
      const polymarketOrder: OrderRequest = {
        venue: "POLYMARKET",
        marketId: match.polymarket.venueMarketId,
        outcome: polymarketLeg.outcome,
        side: "BUY",
        orderType: "FOK",
        shares: sized.quote.shares,
        limitPrice: sized.quote.polymarketLeg.fill.worstPrice ?? sized.quote.polymarketLeg.fill.averagePrice,
        accountId: this.deps.polymarketAccount.accountId,
        clientOrderId: `poly-${match.polymarket.venueMarketId}`
      };
      const safetyCheck = validateConservativeOrderPlan({
        predictOrder,
        polymarketOrder,
        predictWorstAcceptablePrice: sized.quote.predictLeg.fill.worstPrice ?? sized.quote.predictLeg.fill.averagePrice,
        polymarketWorstAcceptablePrice: sized.quote.polymarketLeg.fill.worstPrice ?? sized.quote.polymarketLeg.fill.averagePrice
      });
      if (!safetyCheck.ok) {
        this.deps.predictRotator.release(reserved.accountId);
        await emitMonitorEvent(
          { metrics: this.deps.metrics, alerts: this.deps.alerts },
          tradeRejected("UNKNOWN", "execution rejected by conservative order plan", { reasons: safetyCheck.reasons })
        );
        await this.warn(`execution rejected: ${safetyCheck.reasons.join("; ")}`);
        continue;
      }

      let [predictResult, polymarketResult] = this.deps.dryRun
        ? await this.dryRunResults(reserved.accountId, match.predict.venueMarketId, match.polymarket.venueMarketId, sized.quote.shares)
        : await Promise.all([
            this.deps.predict.placeOrder(predictOrder),
            this.deps.polymarket.placeOrder(polymarketOrder)
          ]);
      let safety = this.safetyOutcome(predictResult, polymarketResult, sized.quote.shares);
      const rescueOrder = buildResidualRescueOrder({
        outcome: safety,
        predictOrder,
        polymarketOrder,
        suffix: "rescue"
      });
      if (!this.deps.dryRun && rescueOrder) {
        const rescueResult =
          rescueOrder.venue === "PREDICT"
            ? await this.deps.predict.placeOrder(rescueOrder)
            : await this.deps.polymarket.placeOrder(rescueOrder);
        await this.record("execution_rescue", "residual rescue attempted", {
          venue: rescueOrder.venue,
          status: rescueResult.status,
          filledShares: rescueResult.filledShares.toFixed()
        });
        if (rescueOrder.venue === "PREDICT") {
          predictResult = combineResults(predictResult, rescueResult);
        } else {
          polymarketResult = combineResults(polymarketResult, rescueResult);
        }
        safety = this.safetyOutcome(
          predictResult,
          polymarketResult,
          sized.quote.shares,
          rescueResult.filledShares.gte(safety.residualShares) ? "succeeded" : "failed"
        );
      }
      await this.record("execution", "execution results", {
        predict: predictResult.status,
        polymarket: polymarketResult.status,
        safetyState: safety.state,
        safetyActions: safety.actions
      });
      await emitMonitorEvent(
        { metrics: this.deps.metrics, alerts: this.deps.alerts },
        orderSubmitted({
          hedgeId: `${match.predict.venueMarketId}:${match.polymarket.venueMarketId}`,
          orderId: predictResult.exchangeOrderId ?? predictResult.clientOrderId,
          venue: "PREDICT"
        })
      );
      await emitMonitorEvent(
        { metrics: this.deps.metrics, alerts: this.deps.alerts },
        orderSubmitted({
          hedgeId: `${match.predict.venueMarketId}:${match.polymarket.venueMarketId}`,
          orderId: polymarketResult.exchangeOrderId ?? polymarketResult.clientOrderId,
          venue: "POLYMARKET"
        })
      );
      this.finishPredictAccount(reserved.accountId, match.predict, predictOrder.outcome, predictResult, safety);
      executed += 1;
      if (safety.state === "PAUSED" || safety.actions.includes("PAUSE_NEW_OPENINGS")) {
        const reason = safety.pauseReason ?? (safety.reasons.join("; ") || "execution safety pause");
        await emitMonitorEvent(
          { metrics: this.deps.metrics, alerts: this.deps.alerts },
          botPaused(safety.pauseReason === "residual rescue failed" ? "RESCUE_FAILED" : "UNHEDGED_RESIDUAL", reason, {
            safetyState: safety.state,
            actions: safety.actions,
            reasons: safety.reasons
          })
        );
        await this.warn(reason);
        return { paused: true, pauseReason: reason, executed };
      }
    }

    return { paused: false, executed };
  }

  private async dryRunResults(
    accountId: string,
    predictMarketId: string,
    polymarketMarketId: string,
    shares: D
  ): Promise<[OrderResult, OrderResult]> {
    const predict: OrderResult = {
      venue: "PREDICT",
      clientOrderId: `dry-predict-${predictMarketId}`,
      status: "dry_run",
      filledShares: shares,
      averagePrice: ZERO
    };
    const polymarket: OrderResult = {
      venue: "POLYMARKET",
      clientOrderId: `dry-poly-${polymarketMarketId}`,
      status: "dry_run",
      filledShares: shares,
      averagePrice: ZERO,
      raw: { accountId }
    };
    return [predict, polymarket];
  }

  private async record(eventType: string, message: string, data?: Record<string, unknown>) {
    await this.deps.audit?.record(auditEvent(eventType, message, data));
  }

  private async warn(message: string) {
    await this.record("alert", message);
    await this.deps.alerts?.send(alert("warning", message));
  }

  private safetyOutcome(
    predictResult: OrderResult,
    polymarketResult: OrderResult,
    requestedShares: D,
    rescueAttempt: "none" | "succeeded" | "failed" = "none"
  ): ExecutionSafetyOutcome {
    return reconcileExecutionSafety({
      predict: confirmOrderFill({ placement: predictResult, requestedShares, requireRestAndWs: false }),
      polymarket: confirmOrderFill({ placement: polymarketResult, requestedShares, requireRestAndWs: false }),
      requestedShares,
      policy: this.deps.safetyPolicy ?? {
        maxUnhedgedMs: 3000,
        cancelUnfilledOrders: true,
        postTradeReconcileRequired: false,
        pauseOnUnhedgedResidual: true
      },
      nowMs: Date.now(),
      rescueAttempt
    });
  }

  private finishPredictAccount(
    accountId: string,
    market: BinaryMarketSpec,
    outcome: HeldPosition["outcome"],
    predictResult: OrderResult,
    safety: ExecutionSafetyOutcome
  ): void {
    if (this.deps.dryRun) {
      this.deps.predictRotator.release(accountId);
      return;
    }
    if (!this.deps.dryRun && predictResult.filledShares.gt(0)) {
      this.deps.predictRotator.markHeld(accountId, {
        marketId: market.venueMarketId,
        outcome,
        shares: predictResult.filledShares,
        costBasis: predictResult.filledShares.mul(predictResult.averagePrice),
        oracleStatus: "PENDING_UMA_FINALITY",
        redeemed: false,
        eventEndTs: parseDate(market.windowEndUtc),
        heldSince: new Date(),
        heldReason: "opened by execution coordinator"
      });
      return;
    }
    if (safety.actions.includes("RELEASE_PREDICT_ACCOUNT_LOCK") || predictResult.filledShares.eq(0)) {
      this.deps.predictRotator.release(accountId);
    }
  }
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function combineResults(left: OrderResult, right: OrderResult): OrderResult {
  const filledShares = left.filledShares.plus(right.filledShares);
  const gross = left.filledShares.mul(left.averagePrice).plus(right.filledShares.mul(right.averagePrice));
  return {
    ...left,
    status: filledShares.gt(0) ? "matched" : right.status,
    filledShares,
    averagePrice: filledShares.gt(0) ? gross.div(filledShares) : ZERO,
    raw: {
      first: left.raw,
      rescue: right.raw
    }
  };
}
