import { d } from "../../domain/money.js";
import { type BinaryMarketSpec } from "../../domain/models.js";
import {
  classifyCadence,
  classifyMarketFamily,
  normalizePriceFeedProvider,
  normalizePriceFeedSymbol,
  normalizeResolutionSource,
  normalizeUpDownRule
} from "../../core/market-classification.js";
import { isEligibleShortWindowBtcMarket, type ShortWindowFilterConfig } from "../../core/short-window-market-filter.js";
import { type NormalizedMarket } from "../../core/types.js";

export interface PolymarketMarketDiscovery {
  listBtcMarkets(): Promise<readonly BinaryMarketSpec[]>;
}

export interface PolymarketGammaMarketLike {
  id?: unknown;
  condition_id?: unknown;
  question?: unknown;
  title?: unknown;
  description?: unknown;
  rules?: unknown;
  enable_order_book?: unknown;
  active?: unknown;
  closed?: unknown;
  accepting_orders?: unknown;
  end_date_iso?: unknown;
  game_start_time?: unknown;
  seconds_delay?: unknown;
  tokens?: unknown;
  minimum_order_size?: unknown;
  minimum_tick_size?: unknown;
}

export function normalizePolymarketMarket(raw: PolymarketGammaMarketLike): NormalizedMarket {
  const title = text(raw.title);
  const question = text(raw.question) ?? title ?? "Polymarket BTC Up/Down";
  const description = text(raw.description);
  const rules = text(raw.rules);
  const eventStartTs = date(raw.game_start_time);
  const eventEndTs = date(raw.end_date_iso);
  const outcomes = tokenOutcomes(raw.tokens);
  const family = classifyMarketFamily({ title, question, description: [description, rules].filter(Boolean).join(" "), outcomes });
  const cadence = eventStartTs && eventEndTs ? classifyCadence(eventStartTs, eventEndTs) : "UNKNOWN";
  const resolutionSource = normalizeResolutionSource({ title, question, description, rules });
  const isClosed = bool(raw.closed, false);
  const acceptingOrders = bool(raw.accepting_orders, true);
  const enableOrderBook = bool(raw.enable_order_book, false);
  const active = bool(raw.active, false);

  return {
    venue: "POLYMARKET",
    externalMarketId: text(raw.id) ?? text(raw.condition_id) ?? "unknown-polymarket-market",
    conditionId: text(raw.condition_id),
    question,
    title,
    description,
    asset: question.toLowerCase().includes("eth") ? "ETH" : "BTC",
    family,
    eventStartTs,
    eventEndTs,
    tradingEndTs: eventEndTs,
    windowSeconds: eventStartTs && eventEndTs ? Math.floor((eventEndTs.getTime() - eventStartTs.getTime()) / 1000) : undefined,
    cadence,
    directionType: family === "BTC_UP_DOWN" ? "UP_DOWN" : "UNKNOWN",
    priceFeedProvider: normalizePriceFeedProvider({ title, question, description, rules }),
    priceFeedSymbol: normalizePriceFeedSymbol({ title, question, description, rules }),
    resolutionSource,
    upDownRule: normalizeUpDownRule({ title, question, description, rules }),
    yesTokenId: tokenId(raw.tokens, ["up", "yes"]),
    noTokenId: tokenId(raw.tokens, ["down", "no"]),
    isTradable: active && enableOrderBook && acceptingOrders && !isClosed,
    isClosed,
    isResolved: isClosed,
    secondsDelay: number(raw.seconds_delay),
    acceptingOrders,
    minOrderSize: decimal(raw.minimum_order_size),
    tickSize: decimal(raw.minimum_tick_size),
    raw
  };
}

export function filterPolymarketHourlyBtcMarkets(
  rawMarkets: readonly PolymarketGammaMarketLike[],
  nowMs: number,
  cfg: ShortWindowFilterConfig
): readonly NormalizedMarket[] {
  return rawMarkets.map(normalizePolymarketMarket).filter((market) => isEligibleShortWindowBtcMarket(market, nowMs, cfg).approved);
}

function tokenId(tokens: unknown, names: readonly string[]): string | undefined {
  if (!Array.isArray(tokens)) return undefined;
  const token = tokens.find((item) => {
    if (!item || typeof item !== "object") return false;
    const outcome = text((item as { outcome?: unknown; name?: unknown }).outcome) ?? text((item as { name?: unknown }).name);
    return outcome !== undefined && names.includes(outcome.trim().toLowerCase());
  });
  if (!token || typeof token !== "object") return undefined;
  return text((token as { token_id?: unknown; tokenId?: unknown; id?: unknown }).token_id) ?? text((token as { tokenId?: unknown }).tokenId) ?? text((token as { id?: unknown }).id);
}

function tokenOutcomes(tokens: unknown): readonly string[] {
  if (!Array.isArray(tokens)) return [];
  return tokens
    .map((item) => (item && typeof item === "object" ? text((item as { outcome?: unknown; name?: unknown }).outcome) ?? text((item as { name?: unknown }).name) : undefined))
    .filter((item): item is string => item !== undefined);
}

function text(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function number(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function decimal(value: unknown) {
  const parsed = number(value);
  return parsed === undefined ? undefined : d(String(parsed));
}

function date(value: unknown): Date | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
