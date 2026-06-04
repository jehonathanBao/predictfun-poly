import {
  classifyCadence,
  classifyMarketFamily,
  normalizePriceFeedProvider,
  normalizePriceFeedSymbol,
  normalizeResolutionSource,
  normalizeUpDownRule
} from "../core/market-classification.js";
import {
  type DirectionType,
  type MarketAsset,
  type MarketCadence,
  type MarketFamily,
  type NormalizedMarket,
  type PriceFeedProvider,
  type PriceFeedSymbol,
  type ResolutionSource,
  type UpDownResolutionRule
} from "../core/types.js";
import { type BinaryMarketSpec, norm } from "../domain/models.js";

export function normalizeBinaryMarketSpec(market: BinaryMarketSpec): NormalizedMarket {
  const eventStartTs = market.eventStartTs ?? parseDate(market.windowStartUtc);
  const eventEndTs = market.eventEndTs ?? parseDate(market.windowEndUtc);
  const metadata = market.metadata ?? {};
  const title = market.title ?? stringMeta(metadata, "title");
  const description = market.description ?? stringMeta(metadata, "description");
  const rules = stringMeta(metadata, "rules") ?? market.resolution?.finalityRule;
  const outcomes = arrayStringMeta(metadata, "outcomes");
  const family = normalizeFamily(
    market.family ??
      stringMeta(metadata, "family") ??
      classifyMarketFamily({ title, question: market.question, description, outcomes })
  );
  const cadence = normalizeCadence(
    market.cadence ?? stringMeta(metadata, "cadence") ?? (eventStartTs && eventEndTs ? classifyCadence(eventStartTs, eventEndTs) : "UNKNOWN")
  );
  const priceFeedProvider = normalizeProvider(
    market.priceFeedProvider ??
      stringMeta(metadata, "priceFeedProvider") ??
      normalizePriceFeedProvider({ title, question: market.question, description, rules, provider: market.settlementSource })
  );
  const priceFeedSymbol = normalizeSymbol(
    market.priceFeedSymbol ??
      stringMeta(metadata, "priceFeedSymbol") ??
      normalizePriceFeedSymbol({ title, question: market.question, description, rules, symbol: market.settlementSource })
  );
  const resolutionSource = normalizeSource(
    market.resolutionSource ??
      stringMeta(metadata, "resolutionSource") ??
      normalizeResolutionSource({ title, question: market.question, description, rules, resolutionSource: market.settlementSource })
  );
  const upDownRule = normalizeRule(
    market.upDownRule ?? stringMeta(metadata, "upDownRule") ?? normalizeUpDownRule({ title, question: market.question, description, rules })
  );
  const directionType: DirectionType = norm(market.contractKind).includes("up") || family === "BTC_UP_DOWN" ? "UP_DOWN" : "UNKNOWN";

  return {
    venue: market.venue,
    externalMarketId: market.venueMarketId,
    conditionId: market.conditionId,
    question: market.question,
    title,
    description,
    asset: normalizeAsset(market.underlying),
    family,
    eventStartTs,
    eventEndTs,
    tradingEndTs: market.tradingEndTs,
    windowSeconds: eventStartTs && eventEndTs ? Math.floor((eventEndTs.getTime() - eventStartTs.getTime()) / 1000) : undefined,
    cadence,
    directionType,
    priceFeedProvider,
    priceFeedSymbol,
    resolutionSource,
    upDownRule,
    yesTokenId: market.yesTokenId,
    noTokenId: market.noTokenId,
    isTradable: market.isTradable ?? market.acceptingOrders ?? true,
    isClosed: market.isClosed ?? false,
    isResolved: market.isResolved ?? false,
    secondsDelay: market.secondsDelay,
    acceptingOrders: market.acceptingOrders,
    startTs: eventStartTs,
    endTs: eventEndTs,
    status: statusFromFlags(market.isClosed, market.isResolved),
    raw: market
  };
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function stringMeta(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function arrayStringMeta(metadata: Record<string, unknown>, key: string): readonly string[] | undefined {
  const value = metadata[key];
  return Array.isArray(value) ? value.map((item) => String(item)) : undefined;
}

function normalizeAsset(value: string): MarketAsset {
  const normalized = norm(value).toUpperCase();
  if (normalized === "BTC" || normalized === "BITCOIN") return "BTC";
  if (normalized === "ETH" || normalized === "ETHEREUM") return "ETH";
  if (normalized === "SOL" || normalized === "SOLANA") return "SOL";
  return "UNKNOWN";
}

function normalizeFamily(value: string): MarketFamily {
  const normalized = value.trim().toUpperCase();
  if (normalized === "BTC_UP_DOWN") return "BTC_UP_DOWN";
  if (normalized === "BTC_4H_UP_DOWN") return "BTC_4H_UP_DOWN";
  if (normalized === "BTC_DAILY_UP_DOWN") return "BTC_DAILY_UP_DOWN";
  if (normalized === "BTC_PRICE_TARGET") return "BTC_PRICE_TARGET";
  if (normalized === "BTC_RANGE") return "BTC_RANGE";
  if (normalized === "BTC_MONTHLY") return "BTC_MONTHLY";
  if (normalized === "BTC_YEARLY") return "BTC_YEARLY";
  return "UNKNOWN";
}

function normalizeCadence(value: string): MarketCadence {
  const normalized = value.trim().toUpperCase();
  if (normalized === "FIVE_MIN") return "FIVE_MIN";
  if (normalized === "FIFTEEN_MIN") return "FIFTEEN_MIN";
  if (normalized === "THIRTY_MIN") return "THIRTY_MIN";
  if (normalized === "HOURLY") return "HOURLY";
  if (normalized === "FOUR_HOUR") return "FOUR_HOUR";
  if (normalized === "DAILY") return "DAILY";
  return "UNKNOWN";
}

function normalizeProvider(value: string): PriceFeedProvider {
  const normalized = value.trim().toUpperCase();
  if (normalized === "BINANCE") return "BINANCE";
  if (normalized === "CHAINLINK") return "CHAINLINK";
  if (normalized === "UMA") return "UMA";
  return "UNKNOWN";
}

function normalizeSymbol(value: string): PriceFeedSymbol {
  const normalized = value.trim().toUpperCase().replace(/[/-]/g, "_");
  if (normalized === "BTC_USDT") return "BTC_USDT";
  if (normalized === "BTC_USD") return "BTC_USD";
  return "UNKNOWN";
}

function normalizeSource(value: string): ResolutionSource {
  const normalized = value.trim().toUpperCase().replace(/[/-]/g, "_");
  if (normalized === "BINANCE_BTC_USDT") return "BINANCE_BTC_USDT";
  if (normalized === "CHAINLINK_BTC_USD") return "CHAINLINK_BTC_USD";
  return "UNKNOWN";
}

function normalizeRule(value: string): UpDownResolutionRule {
  const normalized = value.trim().toUpperCase();
  if (normalized === "CLOSE_GTE_OPEN_IS_UP") return "CLOSE_GTE_OPEN_IS_UP";
  if (normalized === "CLOSE_GT_OPEN_IS_UP") return "CLOSE_GT_OPEN_IS_UP";
  return "UNKNOWN";
}

function statusFromFlags(isClosed: boolean | undefined, isResolved: boolean | undefined): NormalizedMarket["status"] {
  if (isResolved) return "RESOLVED";
  if (isClosed) return "CLOSED";
  return "OPEN";
}
