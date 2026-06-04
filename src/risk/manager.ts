import {
  PredictAccountRotator,
  ensurePolymarketCanOpen,
  isReady,
  unavailableReason,
  type PolymarketAccountState
} from "../accounts/rotator.js";
import { ArbEngine, type FeeRates, type SizingResult } from "../arb/engine.js";
import { type OrderBook } from "../domain/models.js";
import { isEligibleShortWindowBtcMarket, type ShortWindowFilterConfig } from "../core/short-window-market-filter.js";
import { type NormalizedMarket } from "../core/types.js";

export interface BookBundle {
  predictYes: OrderBook;
  predictNo: OrderBook;
  polymarketYes: OrderBook;
  polymarketNo: OrderBook;
}

export interface RiskDecision {
  accepted: boolean;
  reasons: readonly string[];
  sizing?: SizingResult;
  predictAccountId?: string;
}

export interface TimeAwareRiskInput {
  market: NormalizedMarket;
  nowMs: number;
  cfg: ShortWindowFilterConfig;
  staleBookMs: number;
  predictBookTs?: number;
  polymarketBookTs?: number;
}

export interface TimeAwareRiskDecision {
  accepted: boolean;
  reasons: readonly string[];
  secondsToClose?: number;
}

export class RiskManager {
  constructor(readonly engine: ArbEngine) {}

  chooseTrade(input: {
    books: BookBundle;
    feeRates: FeeRates;
    predictRotator: PredictAccountRotator;
    polymarketAccount: PolymarketAccountState;
    timeAware?: TimeAwareRiskInput;
  }): RiskDecision {
    if (input.timeAware) {
      const timeRisk = checkTimeAwareMarketRisk(input.timeAware);
      if (!timeRisk.accepted) {
        return {
          accepted: false,
          reasons: timeRisk.reasons
        };
      }
    }

    ensurePolymarketCanOpen(input.polymarketAccount);
    const rejected: string[] = [];

    for (const account of input.predictRotator.candidatesFromNext()) {
      if (!isReady(account)) {
        rejected.push(`${account.accountId}: ${unavailableReason(account)}`);
        continue;
      }
      const comboA = this.engine.sizeComboA({
        predictYesBook: input.books.predictYes,
        polymarketNoBook: input.books.polymarketNo,
        feeRates: input.feeRates,
        limits: {
          selectedPredictFreeBalance: account.availableBalance,
          polymarketAvailableCollateral: input.polymarketAccount.availableCollateral
        }
      });
      const comboB = this.engine.sizeComboB({
        predictNoBook: input.books.predictNo,
        polymarketYesBook: input.books.polymarketYes,
        feeRates: input.feeRates,
        limits: {
          selectedPredictFreeBalance: account.availableBalance,
          polymarketAvailableCollateral: input.polymarketAccount.availableCollateral
        }
      });
      const best = [comboA, comboB]
        .filter((result) => result.executable && result.quote)
        .sort((left, right) => right.quote!.netProfitUsd.cmp(left.quote!.netProfitUsd))[0];
      if (!best) {
        rejected.push(`${account.accountId}: no executable combo`);
        continue;
      }
      const reserved = input.predictRotator.reserve(account.accountId);
      return {
        accepted: true,
        reasons: [],
        sizing: best,
        predictAccountId: reserved.accountId
      };
    }

    return {
      accepted: false,
      reasons: rejected
    };
  }
}

export function checkTimeAwareMarketRisk(input: TimeAwareRiskInput): TimeAwareRiskDecision {
  const reasons: string[] = [];
  const eligibility = isEligibleShortWindowBtcMarket(input.market, input.nowMs, input.cfg);
  if (!eligibility.approved) {
    reasons.push(`REJECT_${eligibility.reason}`);
  }

  const bookAges = [input.predictBookTs, input.polymarketBookTs]
    .filter((value): value is number => value !== undefined)
    .map((ts) => input.nowMs - ts);
  if (bookAges.some((age) => age > input.staleBookMs)) {
    reasons.push("REJECT_STALE_BOOK");
  }

  if (input.market.acceptingOrders === false || !input.market.isTradable || input.market.isClosed || input.market.isResolved) {
    reasons.push("REJECT_NOT_TRADABLE");
  }

  const endTs = input.market.eventEndTs ?? input.market.endTs;
  const secondsToClose = eligibility.approved ? eligibility.secondsToClose : endTs ? Math.floor((endTs.getTime() - input.nowMs) / 1000) : undefined;
  if (secondsToClose !== undefined && secondsToClose < input.cfg.minSecondsToClose) {
    reasons.push("REJECT_MARKET_CLOSING");
  }
  if (
    secondsToClose !== undefined &&
    input.market.secondsDelay !== undefined &&
    input.market.secondsDelay > 0 &&
    input.market.secondsDelay >= secondsToClose - input.cfg.minSecondsToClose
  ) {
    reasons.push("REJECT_SECONDS_DELAY_TOO_HIGH");
  }

  return {
    accepted: reasons.length === 0,
    reasons: [...new Set(reasons)],
    secondsToClose
  };
}
