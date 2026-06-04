import { Decimal } from "decimal.js";
import { type Outcome } from "../domain/models.js";
import { d, ZERO, type Decimalish } from "../domain/money.js";
import { type LockHandle, type LockManager } from "../locks/redisLocks.js";

export type AccountStatus =
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

export interface HeldPosition {
  marketId: string;
  conditionId?: string;
  outcome: Outcome;
  shares: Decimal;
  costBasis: Decimal;
  oracleStatus: "PENDING_UMA_FINALITY" | "CHALLENGED" | "FINALIZED" | "REDEEMED";
  redeemed: boolean;
  eventEndTs?: Date;
  resolutionDeadlineTs?: Date;
  heldSince?: Date;
  heldReason?: string;
}

export interface PredictPositionSnapshot {
  amount: Decimal;
  valueUsd: Decimal;
  avgBuyPrice: Decimal;
  pnl?: Decimal;
  outcome: Outcome;
  market: {
    id: string;
    conditionId?: string;
    status: string;
    eventEndTs?: Date;
    redeemable?: boolean;
    resolved?: boolean;
  };
}

export interface PredictAccountState {
  accountId: string;
  address: string;
  availableBalance: Decimal;
  openOrders: number;
  heldPosition?: HeldPosition;
  status: AccountStatus;
  maxTradeFraction: Decimal;
  lockedUntil?: Date;
  cooldownUntil?: Date;
  lastUsedAt?: Date;
  lastError?: string;
  heldSince?: Date;
  heldEventEndTs?: Date;
  heldResolutionDeadlineTs?: Date;
  heldReason?: string;
  lock?: LockHandle;
}

export interface PolymarketAccountState {
  accountId: string;
  address: string;
  availableCollateral: Decimal;
  paused: boolean;
  pauseReason?: string;
}

export class NoPredictAccountAvailable extends Error {}
export class GlobalTradingPaused extends Error {}

export function predictAccount(input: {
  accountId: string;
  address: string;
  availableBalance?: Decimalish;
  openOrders?: number;
  heldPosition?: HeldPosition;
  status?: AccountStatus;
  maxTradeFraction?: Decimalish;
  cooldownUntil?: Date;
  lastError?: string;
  heldSince?: Date;
  heldEventEndTs?: Date;
  heldResolutionDeadlineTs?: Date;
  heldReason?: string;
}): PredictAccountState {
  return {
    accountId: input.accountId,
    address: input.address,
    availableBalance: d(input.availableBalance ?? 0),
    openOrders: input.openOrders ?? 0,
    heldPosition: input.heldPosition,
    status: input.status ?? "READY",
    maxTradeFraction: d(input.maxTradeFraction ?? "0.30"),
    cooldownUntil: input.cooldownUntil,
    lastError: input.lastError,
    heldSince: input.heldSince,
    heldEventEndTs: input.heldEventEndTs,
    heldResolutionDeadlineTs: input.heldResolutionDeadlineTs,
    heldReason: input.heldReason
  };
}

export function isReady(account: PredictAccountState, now = new Date()): boolean {
  return (
    account.status === "READY" &&
    account.openOrders === 0 &&
    account.heldPosition === undefined &&
    (account.cooldownUntil === undefined || account.cooldownUntil <= now)
  );
}

export function maxTradeNotional(account: PredictAccountState): Decimal {
  return account.availableBalance.mul(account.maxTradeFraction);
}

export function canFund(account: PredictAccountState, requiredNotional: Decimalish): boolean {
  return isReady(account) && d(requiredNotional).lte(maxTradeNotional(account));
}

export interface PredictAccountAuditor {
  refreshBalance(account: PredictAccountState): Promise<Decimal>;
  listUnsettledPositions(account: PredictAccountState): Promise<readonly PredictPositionSnapshot[]>;
}

export interface AccountSelection {
  account: PredictAccountState;
  lock?: LockHandle;
}

export class PredictAccountRotator {
  private accounts: PredictAccountState[];
  private lastIndex = -1;

  constructor(accounts: readonly PredictAccountState[]) {
    if (accounts.length === 0) throw new Error("at least one Predict account is required");
    if (accounts.length > 10) throw new Error("at most 10 Predict accounts are supported");
    this.accounts = [...accounts];
  }

  snapshot(): readonly PredictAccountState[] {
    return this.accounts.map((account) => ({ ...account }));
  }

  candidatesFromNext(): readonly PredictAccountState[] {
    return this.accounts.map((_, offset) => this.accounts[(this.lastIndex + offset + 1) % this.accounts.length]!);
  }

  reserve(accountId: string): PredictAccountState {
    const index = this.accounts.findIndex((account) => account.accountId === accountId);
    if (index < 0) throw new Error(`unknown Predict account: ${accountId}`);
    const account = this.accounts[index];
    if (!account || !isReady(account)) {
      throw new NoPredictAccountAvailable(`Predict account unavailable: ${accountId}`);
    }
    const reserved = { ...account, status: "COOLDOWN" as const, lastUsedAt: new Date() };
    this.accounts[index] = reserved;
    this.lastIndex = index;
    return reserved;
  }

  select(requiredNotional: Decimalish): PredictAccountState {
    const skipped: string[] = [];
    for (const account of this.candidatesFromNext()) {
      if (canFund(account, requiredNotional)) {
        return this.reserve(account.accountId);
      }
      skipped.push(`${account.accountId}: ${unavailableReason(account, requiredNotional)}`);
    }
    throw new NoPredictAccountAvailable(`no Predict account can fund this hedge; ${skipped.join("; ")}`);
  }

  async selectForTrade(input: {
    requiredNotional: Decimalish;
    minOrderUsdt: Decimalish;
    auditor: PredictAccountAuditor;
    lockManager?: LockManager;
    lockTtlMs?: number;
    lockToken?: string;
    now?: Date;
  }): Promise<AccountSelection> {
    const required = d(input.requiredNotional);
    const minOrder = d(input.minOrderUsdt);
    const now = input.now ?? new Date();
    const skipped: string[] = [];

    for (const account of this.candidatesFromNext()) {
      if (shouldSkipStatus(account.status) || (account.status === "COOLDOWN" && account.cooldownUntil && account.cooldownUntil > now)) {
        skipped.push(`${account.accountId}: ${unavailableReason(account, required)}`);
        continue;
      }
      if (account.status === "COOLDOWN") {
        this.update(account.accountId, { status: "READY", cooldownUntil: undefined });
      }

      let balance: Decimal;
      try {
        balance = await input.auditor.refreshBalance(account);
      } catch (error) {
        this.markAuthError(account.accountId, error instanceof Error ? error.message : "balance refresh failed");
        skipped.push(`${account.accountId}: balance refresh failed`);
        continue;
      }
      this.updateBalance(account.accountId, balance);

      let positions: readonly PredictPositionSnapshot[];
      try {
        positions = await input.auditor.listUnsettledPositions({ ...account, availableBalance: balance });
      } catch (error) {
        this.markAuthError(account.accountId, error instanceof Error ? error.message : "positions audit failed");
        skipped.push(`${account.accountId}: positions audit failed`);
        continue;
      }
      if (positions.length > 0) {
        this.markHeld(account.accountId, heldFromPosition(positions[0]!));
        skipped.push(`${account.accountId}: unsettled Predict position`);
        continue;
      }

      if (balance.lt(minOrder) || balance.lt(required) || required.gt(balance.mul(account.maxTradeFraction))) {
        this.markInsufficient(account.accountId, balance);
        skipped.push(`${account.accountId}: insufficient balance`);
        continue;
      }

      if (account.status !== "READY") {
        this.update(account.accountId, { status: "READY", cooldownUntil: undefined, lastError: undefined });
      }

      let lock: LockHandle | undefined;
      if (input.lockManager) {
        const acquired = await input.lockManager.acquire(
          `predict_account:${account.accountId}`,
          input.lockToken ?? `${account.accountId}:${now.getTime()}`,
          input.lockTtlMs ?? 3000
        );
        if (!acquired) {
          this.markCooldown(account.accountId, 1000, now);
          skipped.push(`${account.accountId}: Redis lock unavailable`);
          continue;
        }
        lock = acquired;
      }

      const reserved = this.reserve(account.accountId);
      this.update(account.accountId, { lock });
      return { account: { ...reserved, lock }, lock };
    }

    throw new NoPredictAccountAvailable(`no Predict account can fund this hedge; ${skipped.join("; ")}`);
  }

  release(accountId: string, availableBalance?: Decimalish): void {
    const index = this.accounts.findIndex((account) => account.accountId === accountId);
    if (index < 0) throw new Error(`unknown Predict account: ${accountId}`);
    const account = this.accounts[index];
    if (!account) throw new Error(`unknown Predict account: ${accountId}`);
    this.accounts[index] = {
      ...account,
      availableBalance: availableBalance === undefined ? account.availableBalance : d(availableBalance),
      openOrders: 0,
      heldPosition: undefined,
      status: "READY",
      heldSince: undefined,
      heldEventEndTs: undefined,
      heldResolutionDeadlineTs: undefined,
      heldReason: undefined,
      lock: undefined,
      lastError: undefined
    };
  }

  updateBalance(accountId: string, availableBalance: Decimalish): void {
    this.update(accountId, { availableBalance: d(availableBalance) });
  }

  markHeld(accountId: string, heldPosition: HeldPosition, availableBalance?: Decimalish): void {
    const index = this.accounts.findIndex((account) => account.accountId === accountId);
    if (index < 0) throw new Error(`unknown Predict account: ${accountId}`);
    const account = this.accounts[index];
    if (!account) throw new Error(`unknown Predict account: ${accountId}`);
    const now = new Date();
    const status =
      heldPosition.oracleStatus === "FINALIZED" || heldPosition.oracleStatus === "REDEEMED"
        ? "HELD_REDEEMABLE"
        : heldPosition.eventEndTs && now.getTime() >= heldPosition.eventEndTs.getTime()
          ? "HELD_AWAITING_RESOLUTION"
          : "HELD_OPEN";
    this.accounts[index] = {
      ...account,
      availableBalance: availableBalance === undefined ? account.availableBalance : d(availableBalance),
      openOrders: 0,
      heldPosition,
      status,
      heldSince: heldPosition.heldSince ?? now,
      heldEventEndTs: heldPosition.eventEndTs,
      heldResolutionDeadlineTs: heldPosition.resolutionDeadlineTs,
      heldReason: heldPosition.heldReason
    };
  }

  markSettling(accountId: string): void {
    this.update(accountId, { status: "HELD_AWAITING_RESOLUTION" });
  }

  markAwaitingResolution(accountId: string, now = new Date()): void {
    const account = this.accounts.find((candidate) => candidate.accountId === accountId);
    if (!account?.heldPosition) return;
    if (account.status === "HELD_OPEN" || account.status === "HELD") {
      this.update(accountId, {
        status: "HELD_AWAITING_RESOLUTION",
        heldReason: `event ended before ${now.toISOString()}`
      });
    }
  }

  markRedeemable(accountId: string): void {
    const account = this.accounts.find((candidate) => candidate.accountId === accountId);
    if (!account?.heldPosition) return;
    this.update(accountId, {
      status: "HELD_REDEEMABLE",
      heldPosition: { ...account.heldPosition, oracleStatus: "FINALIZED" }
    });
  }

  markRedeeming(accountId: string): void {
    const account = this.accounts.find((candidate) => candidate.accountId === accountId);
    if (!account?.heldPosition) return;
    this.update(accountId, { status: "REDEEMING" });
  }

  advanceHeldStateByTime(now = new Date()): void {
    for (const account of this.accounts) {
      const end = account.heldEventEndTs ?? account.heldPosition?.eventEndTs;
      if ((account.status === "HELD_OPEN" || account.status === "HELD") && end && now.getTime() >= end.getTime()) {
        this.markAwaitingResolution(account.accountId, now);
      }
    }
  }

  markInsufficient(accountId: string, availableBalance?: Decimalish): void {
    const changes: Partial<PredictAccountState> = { status: "INSUFFICIENT" };
    if (availableBalance !== undefined) {
      changes.availableBalance = d(availableBalance);
    }
    this.update(accountId, changes);
  }

  markAuthError(accountId: string, error: string): void {
    this.update(accountId, { status: "AUTH_ERROR", lastError: error });
  }

  markCooldown(accountId: string, cooldownMs: number, now = new Date()): void {
    this.update(accountId, {
      status: "COOLDOWN",
      cooldownUntil: new Date(now.getTime() + cooldownMs)
    });
  }

  disable(accountId: string, reason?: string): void {
    this.update(accountId, { status: "DISABLED", lastError: reason });
  }

  restoreIfSufficient(accountId: string, balance: Decimalish, minOrderUsdt: Decimalish): void {
    const nextStatus = d(balance).gte(d(minOrderUsdt)) ? "READY" : "INSUFFICIENT";
    this.update(accountId, { availableBalance: d(balance), status: nextStatus });
  }

  async releaseLock(accountId: string, lockManager: LockManager): Promise<void> {
    const account = this.accounts.find((candidate) => candidate.accountId === accountId);
    if (account?.lock) {
      await lockManager.release(account.lock);
      this.update(accountId, { lock: undefined });
    }
  }

  private update(accountId: string, changes: Partial<PredictAccountState>): void {
    const index = this.accounts.findIndex((account) => account.accountId === accountId);
    if (index < 0) throw new Error(`unknown Predict account: ${accountId}`);
    const account = this.accounts[index];
    if (!account) throw new Error(`unknown Predict account: ${accountId}`);
    this.accounts[index] = { ...account, ...changes };
  }
}

export function unavailableReason(account: PredictAccountState, requiredNotional?: Decimalish): string {
  if (account.status === "DISABLED") return account.lastError ?? "account manually disabled";
  if (account.status === "AUTH_ERROR") return account.lastError ?? "auth/signing/account config error";
  if (account.status === "INSUFFICIENT") return "insufficient balance";
  if (account.status === "SETTLING" || account.status === "HELD_AWAITING_RESOLUTION") {
    return "account is waiting for UMA resolution";
  }
  if (account.status === "HELD_REDEEMABLE") return "account is redeemable and waiting for redeem";
  if (account.status === "REDEEMING") return "account is redeeming a settled position";
  if (account.heldPosition || account.status === "HELD" || account.status === "HELD_OPEN") {
    return "account has a HELD position awaiting finality/redeem";
  }
  if (account.openOrders > 0) return "account has open orders";
  if (account.status === "COOLDOWN") return "account is cooling down";
  if (requiredNotional !== undefined && d(requiredNotional).gt(maxTradeNotional(account))) {
    return "required Predict notional exceeds 30% of available balance";
  }
  return "account unavailable";
}

export function ensurePolymarketCanOpen(account: PolymarketAccountState, requiredNotional: Decimalish = ZERO): void {
  if (account.paused) throw new GlobalTradingPaused(account.pauseReason ?? "Polymarket account paused");
  if (account.availableCollateral.lte(0) || account.availableCollateral.lt(d(requiredNotional))) {
    throw new GlobalTradingPaused("Polymarket account paused: insufficient funds for hedge leg");
  }
}

function shouldSkipStatus(status: AccountStatus): boolean {
  return (
    status === "HELD" ||
    status === "HELD_OPEN" ||
    status === "HELD_AWAITING_RESOLUTION" ||
    status === "HELD_REDEEMABLE" ||
    status === "REDEEMING" ||
    status === "SETTLING" ||
    status === "AUTH_ERROR" ||
    status === "DISABLED"
  );
}

function heldFromPosition(position: PredictPositionSnapshot): HeldPosition {
  return {
    marketId: position.market.id,
    conditionId: position.market.conditionId,
    outcome: position.outcome,
    shares: position.amount,
    costBasis: position.amount.mul(position.avgBuyPrice),
    oracleStatus: position.market.status === "resolved" || position.market.resolved || position.market.redeemable ? "FINALIZED" : "PENDING_UMA_FINALITY",
    redeemed: false,
    eventEndTs: position.market.eventEndTs,
    heldSince: new Date(),
    heldReason: "restored from Predict positions audit"
  };
}
