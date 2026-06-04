import {
  type MarketCadence,
  type MarketFamily,
  type NormalizedMarket,
  type PriceFeedProvider,
  type PriceFeedSymbol,
  type ResolutionSource,
  type UpDownResolutionRule
} from "./types.js";

export function normalizeResolutionSource(input: {
  title?: string;
  question?: string;
  description?: string;
  rules?: string;
  provider?: string;
  symbol?: string;
  resolutionSource?: string;
}): ResolutionSource {
  const explicit = normalizeExplicitResolutionSource(input.resolutionSource);
  if (explicit !== "UNKNOWN") return explicit;

  const text = searchableText(input);
  if (text.includes("binance") && text.includes("btc") && text.includes("usdt")) {
    return "BINANCE_BTC_USDT";
  }
  if (text.includes("chainlink") && text.includes("btc") && text.includes("usd")) {
    return "CHAINLINK_BTC_USD";
  }
  return "UNKNOWN";
}

export function normalizePriceFeedProvider(input: {
  title?: string;
  question?: string;
  description?: string;
  rules?: string;
  provider?: string;
  resolutionSource?: string;
}): PriceFeedProvider {
  const text = searchableText(input);
  if (text.includes("binance")) return "BINANCE";
  if (text.includes("chainlink")) return "CHAINLINK";
  if (text.includes("uma")) return "UMA";
  return "UNKNOWN";
}

export function normalizePriceFeedSymbol(input: {
  title?: string;
  question?: string;
  description?: string;
  rules?: string;
  symbol?: string;
  resolutionSource?: string;
}): PriceFeedSymbol {
  const text = searchableText(input).replace(/[/-]/g, "_");
  if (text.includes("btc_usdt") || (text.includes("btc") && text.includes("usdt"))) return "BTC_USDT";
  if (text.includes("btc_usd") || (text.includes("btc") && text.includes("usd"))) return "BTC_USD";
  return "UNKNOWN";
}

export function classifyMarketFamily(input: {
  title?: string;
  question?: string;
  description?: string;
  outcomes?: readonly string[];
}): MarketFamily {
  const text = searchableText({
    title: input.title,
    question: input.question,
    description: [input.description, ...(input.outcomes ?? [])].filter(Boolean).join(" ")
  });
  const isBtc = text.includes("bitcoin") || /\bbtc\b/.test(text);
  if (!isBtc) return "UNKNOWN";

  if (text.includes("monthly")) return "BTC_MONTHLY";
  if (text.includes("yearly") || text.includes("annual")) return "BTC_YEARLY";
  if (text.includes("daily") || text.includes("24h") || text.includes("24 hour")) return "BTC_DAILY_UP_DOWN";
  if (text.includes("4h") || text.includes("4 hour") || text.includes("four hour")) return "BTC_4H_UP_DOWN";
  if (text.includes("range") || text.includes("between")) return "BTC_RANGE";
  if (text.includes("above") || text.includes("below") || text.includes("target") || text.includes("price of bitcoin")) {
    return "BTC_PRICE_TARGET";
  }

  const isUpDown =
    text.includes("up or down") ||
    text.includes("up/down") ||
    text.includes("up-down") ||
    (/\bup\b/.test(text) && /\bdown\b/.test(text));
  return isUpDown ? "BTC_UP_DOWN" : "UNKNOWN";
}

export function classifyCadence(start: Date, end: Date): MarketCadence {
  const sec = Math.floor((end.getTime() - start.getTime()) / 1000);
  if (sec === 300) return "FIVE_MIN";
  if (sec === 900) return "FIFTEEN_MIN";
  if (sec === 1800) return "THIRTY_MIN";
  if (sec === 3600) return "HOURLY";
  if (sec === 14400) return "FOUR_HOUR";
  if (sec === 86400) return "DAILY";
  return "UNKNOWN";
}

export function normalizeUpDownRule(input: {
  title?: string;
  question?: string;
  description?: string;
  rules?: string;
  rule?: string;
}): UpDownResolutionRule {
  const text = searchableText(input);
  const mentionsCloseOpen = text.includes("close") && text.includes("open");
  if (!mentionsCloseOpen) return "UNKNOWN";
  if (text.includes(">=") || text.includes("greater than or equal") || text.includes("greater or equal")) {
    return "CLOSE_GTE_OPEN_IS_UP";
  }
  if (text.includes(">") || text.includes("greater than")) {
    return "CLOSE_GT_OPEN_IS_UP";
  }
  return "UNKNOWN";
}

export function marketWindowSeconds(market: Pick<NormalizedMarket, "eventStartTs" | "eventEndTs" | "startTs" | "endTs">): number | undefined {
  const start = market.eventStartTs ?? market.startTs;
  const end = market.eventEndTs ?? market.endTs;
  if (!start || !end) return undefined;
  return Math.floor((end.getTime() - start.getTime()) / 1000);
}

function normalizeExplicitResolutionSource(value: string | undefined): ResolutionSource {
  const normalized = (value ?? "").trim().toUpperCase().replace(/[/-]/g, "_");
  if (normalized === "BINANCE_BTC_USDT") return "BINANCE_BTC_USDT";
  if (normalized === "CHAINLINK_BTC_USD") return "CHAINLINK_BTC_USD";
  return "UNKNOWN";
}

function searchableText(input: {
  title?: string;
  question?: string;
  description?: string;
  rules?: string;
  provider?: string;
  symbol?: string;
  resolutionSource?: string;
  rule?: string;
}): string {
  return [
    input.title,
    input.question,
    input.description,
    input.rules,
    input.provider,
    input.symbol,
    input.resolutionSource,
    input.rule
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ");
}
