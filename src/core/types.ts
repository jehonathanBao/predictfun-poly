import { Decimal } from "decimal.js";
import { type PredictAccountLifecycleState } from "./state-machine.js";
import { type Outcome, type OrderSide, type Venue } from "../domain/models.js";

export * from "../domain/models.js";

export type Side = OrderSide;
export type MarketAsset = "BTC" | "ETH" | "SOL" | "UNKNOWN";
export type MarketFamily =
  | "BTC_UP_DOWN"
  | "BTC_4H_UP_DOWN"
  | "BTC_DAILY_UP_DOWN"
  | "BTC_PRICE_TARGET"
  | "BTC_RANGE"
  | "BTC_MONTHLY"
  | "BTC_YEARLY"
  | "UNKNOWN";
export type MarketCadence =
  | "FIVE_MIN"
  | "FIFTEEN_MIN"
  | "THIRTY_MIN"
  | "HOURLY"
  | "FOUR_HOUR"
  | "DAILY"
  | "UNKNOWN";
export type DirectionType = "UP_DOWN" | "YES_NO" | "UNKNOWN";
export type PriceFeedProvider = "BINANCE" | "CHAINLINK" | "UMA" | "UNKNOWN";
export type PriceFeedSymbol = "BTC_USDT" | "BTC_USD" | "UNKNOWN";
export type ResolutionSource = "BINANCE_BTC_USDT" | "CHAINLINK_BTC_USD" | "UNKNOWN";
export type UpDownResolutionRule = "CLOSE_GTE_OPEN_IS_UP" | "CLOSE_GT_OPEN_IS_UP" | "UNKNOWN";

export interface NormalizedMarket {
  venue: Venue;
  externalMarketId: string;
  conditionId?: string;
  question: string;
  title?: string;
  description?: string;
  asset: MarketAsset;
  family: MarketFamily;
  eventStartTs?: Date;
  eventEndTs?: Date;
  tradingEndTs?: Date;
  windowSeconds?: number;
  cadence: MarketCadence;
  directionType: DirectionType;
  priceFeedProvider?: PriceFeedProvider;
  priceFeedSymbol?: PriceFeedSymbol;
  resolutionSource: ResolutionSource;
  upDownRule?: UpDownResolutionRule;
  yesTokenId?: string;
  noTokenId?: string;
  isTradable: boolean;
  isClosed: boolean;
  isResolved: boolean;
  secondsDelay?: number;
  acceptingOrders?: boolean;
  minOrderSize?: Decimal;
  tickSize?: Decimal;
  startTs?: Date;
  endTs?: Date;
  status?: "OPEN" | "CLOSED" | "RESOLVED" | "UNKNOWN";
  raw: unknown;
}

export interface BookLevel {
  price: Decimal;
  shares: Decimal;
}

export interface NormalizedOrderbook {
  venue: Venue;
  marketId: string;
  buyYes: BookLevel[];
  buyNo: BookLevel[];
  ts: number;
  minOrderSize?: Decimal;
  tickSize?: Decimal;
}

export interface ArbCandidate {
  marketPairId: string;
  direction: "PREDICT_YES_POLY_NO" | "PREDICT_NO_POLY_YES";
  shares: Decimal;
  predictOutcome: Outcome;
  polymarketOutcome: Outcome;
  predictLimitPrice: Decimal;
  polymarketLimitPrice: Decimal;
  predictCostUsd: Decimal;
  polymarketCostUsd: Decimal;
  totalFeesUsd: Decimal;
  expectedProfitUsd: Decimal;
  expectedProfitPerShare: Decimal;
}

export interface PredictAccountState {
  id: string;
  label: string;
  walletAddress: string;
  predictAccountAddress?: string;
  status: PredictAccountLifecycleState;
  freeBalanceUsdt: Decimal;
  heldMarketPairId?: string;
  lastUsedAt?: Date;
}
