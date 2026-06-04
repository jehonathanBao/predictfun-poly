import { Decimal } from "decimal.js";
import { assertPrice, d, ONE, ZERO, type Decimalish } from "./money.js";

export type Venue = "PREDICT" | "POLYMARKET";
export type Outcome = "YES" | "NO";
export type OrderSide = "BUY" | "SELL";
export type OrderType = "LIMIT" | "MARKET" | "FOK" | "FAK" | "GTC" | "GTD";
export type OrderStatus = "live" | "matched" | "delayed" | "unmatched" | "cancelled" | "failed" | "dry_run";

export function complementOutcome(outcome: Outcome): Outcome {
  return outcome === "YES" ? "NO" : "YES";
}

export interface ResolutionSpecInput {
  oracleSystem: string;
  dataSource: string;
  rulesHash: string;
  challengePeriodSeconds: number | null;
  finalityRule: string;
  winningPayout?: Decimalish;
  losingPayout?: Decimalish;
  payoutUnit?: string;
  disputeProcess?: string;
}

export class ResolutionSpec {
  readonly oracleSystem: string;
  readonly dataSource: string;
  readonly rulesHash: string;
  readonly challengePeriodSeconds: number | null;
  readonly finalityRule: string;
  readonly winningPayout: Decimal;
  readonly losingPayout: Decimal;
  readonly payoutUnit: string;
  readonly disputeProcess: string;

  constructor(input: ResolutionSpecInput) {
    this.oracleSystem = input.oracleSystem;
    this.dataSource = input.dataSource;
    this.rulesHash = input.rulesHash;
    this.challengePeriodSeconds = input.challengePeriodSeconds;
    this.finalityRule = input.finalityRule;
    this.winningPayout = d(input.winningPayout ?? 1);
    this.losingPayout = d(input.losingPayout ?? 0);
    this.payoutUnit = input.payoutUnit ?? "USD";
    this.disputeProcess = input.disputeProcess ?? "UMA_OPTIMISTIC_ORACLE";
  }

  equivalenceKey(): readonly unknown[] {
    return [
      norm(this.oracleSystem),
      norm(this.dataSource),
      this.rulesHash.trim().toLowerCase(),
      this.challengePeriodSeconds,
      norm(this.finalityRule),
      this.winningPayout.toFixed(),
      this.losingPayout.toFixed(),
      this.payoutUnit.trim().toUpperCase(),
      norm(this.disputeProcess)
    ];
  }
}

export interface BinaryMarketSpec {
  venue: Venue;
  venueMarketId: string;
  question: string;
  title?: string;
  description?: string;
  underlying: string;
  contractKind: string;
  settlementSource: string;
  windowStartUtc: string;
  windowEndUtc: string;
  decimalPrecision: number;
  isBinary: boolean;
  strike?: Decimal;
  direction?: string;
  conditionId?: string;
  yesTokenId?: string;
  noTokenId?: string;
  resolutionRuleHash?: string;
  resolution?: ResolutionSpec;
  linkedPolymarketConditionIds?: readonly string[];
  family?: string;
  cadence?: string;
  eventStartTs?: Date;
  eventEndTs?: Date;
  tradingEndTs?: Date;
  priceFeedProvider?: string;
  priceFeedSymbol?: string;
  resolutionSource?: string;
  upDownRule?: string;
  isTradable?: boolean;
  isClosed?: boolean;
  isResolved?: boolean;
  secondsDelay?: number;
  acceptingOrders?: boolean;
  metadata?: Record<string, unknown>;
}

export interface OrderBookLevel {
  price: Decimal;
  size: Decimal;
}

export interface FillEstimate {
  requestedShares: Decimal;
  filledShares: Decimal;
  grossCost: Decimal;
  averagePrice: Decimal;
  worstPrice: Decimal | null;
  complete: boolean;
  levelsUsed: number;
}

export class OrderBook {
  readonly bids: readonly OrderBookLevel[];
  readonly asks: readonly OrderBookLevel[];
  readonly decimalPrecision: number;
  readonly timestampMs?: number;
  readonly minOrderSize?: Decimal;
  readonly tickSize?: Decimal;

  constructor(input: {
    bids: readonly OrderBookLevel[];
    asks: readonly OrderBookLevel[];
    decimalPrecision: number;
    timestampMs?: number;
    minOrderSize?: Decimalish;
    tickSize?: Decimalish;
  }) {
    this.bids = [...input.bids].map(normalizeLevel).sort((a, b) => b.price.cmp(a.price));
    this.asks = [...input.asks].map(normalizeLevel).sort((a, b) => a.price.cmp(b.price));
    this.decimalPrecision = input.decimalPrecision;
    this.timestampMs = input.timestampMs;
    this.minOrderSize = input.minOrderSize === undefined ? undefined : d(input.minOrderSize);
    this.tickSize = input.tickSize === undefined ? undefined : d(input.tickSize);
  }

  estimateBuy(shares: Decimalish): FillEstimate {
    const target = d(shares);
    if (target.lte(0)) {
      throw new Error("shares must be positive");
    }

    let remaining = target;
    let grossCost = ZERO;
    let filled = ZERO;
    let worstPrice: Decimal | null = null;
    let levelsUsed = 0;

    for (const level of this.asks) {
      if (remaining.lte(0)) {
        break;
      }
      const take = Decimal.min(remaining, level.size);
      if (take.lte(0)) {
        continue;
      }
      grossCost = grossCost.plus(take.mul(level.price));
      filled = filled.plus(take);
      remaining = remaining.minus(take);
      worstPrice = level.price;
      levelsUsed += 1;
    }

    return {
      requestedShares: target,
      filledShares: filled,
      grossCost,
      averagePrice: filled.gt(0) ? grossCost.div(filled) : ZERO,
      worstPrice,
      complete: filled.eq(target),
      levelsUsed
    };
  }
}

export interface OrderRequest {
  venue: Venue;
  marketId: string;
  outcome: Outcome;
  side: OrderSide;
  orderType: OrderType;
  shares: Decimal;
  limitPrice: Decimal;
  accountId: string;
  clientOrderId: string;
  expectedDelayMs?: number;
  signedPayload?: Record<string, unknown>;
}

export interface OrderResult {
  venue: Venue;
  clientOrderId: string;
  status: OrderStatus;
  exchangeOrderId?: string;
  filledShares: Decimal;
  averagePrice: Decimal;
  error?: string;
  raw?: Record<string, unknown>;
}

export function isFilled(status: OrderStatus): boolean {
  return status === "matched";
}

export function isOpen(status: OrderStatus): boolean {
  return status === "live" || status === "delayed" || status === "unmatched";
}

export function tokenIdFor(market: BinaryMarketSpec, outcome: Outcome): string | undefined {
  return outcome === "YES" ? market.yesTokenId : market.noTokenId;
}

function normalizeLevel(level: OrderBookLevel): OrderBookLevel {
  const price = d(level.price);
  const size = d(level.size);
  assertPrice(price);
  if (size.lt(0)) {
    throw new Error(`size must be non-negative, got ${size.toString()}`);
  }
  return { price, size };
}

export function norm(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

export { d, ONE, ZERO, type Decimalish };
