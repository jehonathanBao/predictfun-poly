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

export interface PredictMarketDiscovery {
  listBtcMarkets(): Promise<readonly BinaryMarketSpec[]>;
}

export interface PredictMarketLike {
  id?: unknown;
  title?: unknown;
  question?: unknown;
  description?: unknown;
  tradingStatus?: unknown;
  status?: unknown;
  resolution?: unknown;
  oracleQuestionId?: unknown;
  conditionId?: unknown;
  polymarketConditionIds?: unknown;
  marketVariant?: unknown;
  variantData?: unknown;
  outcomes?: unknown;
}

export function normalizePredictMarket(raw: PredictMarketLike): NormalizedMarket {
  const variantData = raw.variantData && typeof raw.variantData === "object" ? (raw.variantData as Record<string, unknown>) : {};
  const rawRecord = raw as Record<string, unknown>;
  const dateSource = { ...rawRecord, ...variantData };
  const title = text(raw.title) ?? text(variantData.title);
  const question = text(raw.question) ?? title ?? "Predict BTC Up/Down";
  const description = text(raw.description) ?? text(variantData.description);
  const resolution = text(raw.resolution) ?? text(variantData.resolution);
  const eventStartTs = firstDate(dateSource, ["eventStartTs", "event_start_ts", "startTs", "start_time", "startsAt", "openTime"]);
  const eventEndTs = firstDate(dateSource, ["eventEndTs", "event_end_ts", "endTs", "end_time", "endsAt", "closeTime"]);
  const marketVariant = text(raw.marketVariant) ?? text(variantData.marketVariant);
  const outcomes = arrayText(raw.outcomes).length > 0 ? arrayText(raw.outcomes) : arrayText(variantData.outcomes);
  const descriptionBlob = [description, resolution, marketVariant, JSON.stringify(variantData)].filter(Boolean).join(" ");
  const family = normalizeFamily(marketVariant) ?? classifyMarketFamily({ title, question, description: descriptionBlob, outcomes });
  const cadence = eventStartTs && eventEndTs ? classifyCadence(eventStartTs, eventEndTs) : "UNKNOWN";
  const tradingStatus = text(raw.tradingStatus)?.toLowerCase();
  const status = text(raw.status)?.toLowerCase();
  const isClosed = status === "closed" || status === "resolved";

  return {
    venue: "PREDICT",
    externalMarketId: text(raw.id) ?? text(raw.conditionId) ?? "unknown-predict-market",
    conditionId: text(raw.conditionId),
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
    priceFeedProvider: normalizePriceFeedProvider({ title, question, description: descriptionBlob, rules: resolution }),
    priceFeedSymbol: normalizePriceFeedSymbol({ title, question, description: descriptionBlob, rules: resolution }),
    resolutionSource: normalizeResolutionSource({ title, question, description: descriptionBlob, rules: resolution }),
    upDownRule: normalizeUpDownRule({ title, question, description: descriptionBlob, rules: resolution }),
    isTradable: (tradingStatus === undefined || ["open", "active", "trading"].includes(tradingStatus)) && !isClosed,
    isClosed,
    isResolved: status === "resolved",
    raw
  };
}

export function filterPredictHourlyBtcMarkets(
  rawMarkets: readonly PredictMarketLike[],
  nowMs: number,
  cfg: ShortWindowFilterConfig
): readonly NormalizedMarket[] {
  return rawMarkets.map(normalizePredictMarket).filter((market) => isEligibleShortWindowBtcMarket(market, nowMs, cfg).approved);
}

function normalizeFamily(marketVariant: string | undefined): "BTC_UP_DOWN" | undefined {
  const normalized = (marketVariant ?? "").trim().toUpperCase();
  return normalized === "BTC_UP_DOWN" || normalized.includes("BTC_UP_DOWN") ? "BTC_UP_DOWN" : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function arrayText(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
    .filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function firstDate(record: Record<string, unknown>, keys: readonly string[]): Date | undefined {
  for (const key of keys) {
    const value = record[key];
    const raw = text(value);
    if (!raw) continue;
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return undefined;
}
