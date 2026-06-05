import { pathToFileURL } from "node:url";
import {
  appendHedgePlanHistory,
  DEFAULT_HISTORY_HEDGE_PLANS_PATH,
  DEFAULT_LATEST_HEDGE_PLANS_PATH,
  writeLatestHedgePlans,
  type SanitizedHedgePlanRecord,
  type StoredHedgePlanRecord,
} from "../storage/hedge-plan-store.js";

export interface DryRunHedgeWorkerOptions {
  intervalMs: number;
  once: boolean;
  latestPath: string;
  historyPath: string;
  paperLiveMarketData: boolean;
  paperMarketDataUrl?: string;
  paperPolymarketTokenId?: string;
  paperPolymarketClobBase: string;
  paperSimFundsUsd: number;
  paperSimNetExposureUsd: number;
  paperHedgeRatio: number;
  paperMaxOrderUsd: number;
  paperEventKey: string;
  paperPredictMarketId: string;
  paperHedgeMarketId: string;
}

export const DEFAULT_DRY_RUN_WORKER_INTERVAL_MS = 5_000;
export const DEFAULT_PAPER_POLYMARKET_CLOB_BASE = "https://clob.polymarket.com";

export function buildEmptyDryRunHedgePayload(now = new Date()): StoredHedgePlanRecord {
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    source: "dry_run_worker",
    mode: "dry_run",
    readOnly: true,
    liveTradingEnabled: false,
    plans: [],
  };
}

export async function writeDryRunHedgeSnapshot(options: {
  latestPath?: string;
  historyPath?: string;
  now?: Date;
  workerOptions?: Partial<DryRunHedgeWorkerOptions>;
  fetchFn?: typeof fetch;
} = {}): Promise<SanitizedHedgePlanRecord> {
  const resolved = resolveDryRunHedgeWorkerOptions(options.workerOptions ?? {});
  const payload = resolved.paperLiveMarketData
    ? await buildPaperLiveMarketDataPayload({
      options: resolved,
      now: options.now,
      fetchFn: options.fetchFn ?? fetch,
    })
    : buildEmptyDryRunHedgePayload(options.now);
  const latestPath = options.latestPath ?? DEFAULT_LATEST_HEDGE_PLANS_PATH;
  const historyPath = options.historyPath ?? DEFAULT_HISTORY_HEDGE_PLANS_PATH;
  const written = await writeLatestHedgePlans(payload, latestPath);
  await appendHedgePlanHistory(payload, historyPath);
  return written;
}

export async function runDryRunHedgeWorker(options: Partial<DryRunHedgeWorkerOptions> = {}): Promise<void> {
  const resolved = resolveDryRunHedgeWorkerOptions(options);
  let stopped = false;

  const stop = (): void => {
    stopped = true;
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    do {
      const written = await writeDryRunHedgeSnapshot({
        latestPath: resolved.latestPath,
        historyPath: resolved.historyPath,
        workerOptions: resolved,
      });
      console.log(
        JSON.stringify({
          level: "info",
          worker: "dry_run_hedge_worker",
          generatedAt: written.generatedAt,
          latestPath: resolved.latestPath,
          historyPath: resolved.historyPath,
          mode: written.mode,
          readOnly: written.readOnly,
          liveTradingEnabled: written.liveTradingEnabled,
          source: written.source,
          totalPlans: written.summary.totalPlans,
        }),
      );

      if (resolved.once) return;
      await delay(resolved.intervalMs);
    } while (!stopped);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

export function parseDryRunHedgeWorkerOptions(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): DryRunHedgeWorkerOptions {
  const args = new Map<string, string | true>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined || !arg.startsWith("--")) continue;
    const equalsIndex = arg.indexOf("=");
    if (equalsIndex >= 0) {
      args.set(arg.slice(0, equalsIndex), arg.slice(equalsIndex + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args.set(arg, next);
      index += 1;
    } else {
      args.set(arg, true);
    }
  }

  return resolveDryRunHedgeWorkerOptions({
    intervalMs: numberOption(args.get("--interval-ms"), env.DRY_RUN_WORKER_INTERVAL_MS, DEFAULT_DRY_RUN_WORKER_INTERVAL_MS),
    once: boolOption(args.get("--once"), env.DRY_RUN_WORKER_ONESHOT, false),
    latestPath: stringOption(args.get("--latest-path"), env.HEDGE_DASHBOARD_LATEST_PATH, DEFAULT_LATEST_HEDGE_PLANS_PATH),
    historyPath: stringOption(args.get("--history-path"), env.HEDGE_DASHBOARD_HISTORY_PATH, DEFAULT_HISTORY_HEDGE_PLANS_PATH),
    paperLiveMarketData: boolOption(args.get("--paper-live-market-data"), env.PAPER_LIVE_MARKET_DATA, false),
    paperMarketDataUrl: optionalStringOption(args.get("--paper-market-data-url"), env.PAPER_MARKET_DATA_URL),
    paperPolymarketTokenId: optionalStringOption(args.get("--paper-polymarket-token-id"), env.PAPER_POLYMARKET_TOKEN_ID),
    paperPolymarketClobBase: stringOption(
      args.get("--paper-polymarket-clob-base"),
      env.PAPER_POLYMARKET_CLOB_BASE,
      DEFAULT_PAPER_POLYMARKET_CLOB_BASE,
    ),
    paperSimFundsUsd: numberOption(args.get("--paper-sim-funds-usd"), env.PAPER_SIM_FUNDS_USD, 100),
    paperSimNetExposureUsd: signedNumberOption(
      args.get("--paper-sim-net-exposure-usd"),
      env.PAPER_SIM_NET_EXPOSURE_USD,
      10,
    ),
    paperHedgeRatio: boundedNumberOption(args.get("--paper-hedge-ratio"), env.PAPER_HEDGE_RATIO, 0.5, 0, 1),
    paperMaxOrderUsd: numberOption(args.get("--paper-max-order-usd"), env.PAPER_MAX_ORDER_USD, 10),
    paperEventKey: stringOption(args.get("--paper-event-key"), env.PAPER_EVENT_KEY, "paper-live-market"),
    paperPredictMarketId: stringOption(args.get("--paper-predict-market-id"), env.PAPER_PREDICT_MARKET_ID, "paper-predict"),
    paperHedgeMarketId: stringOption(args.get("--paper-hedge-market-id"), env.PAPER_HEDGE_MARKET_ID, "paper-polymarket"),
  });
}

function resolveDryRunHedgeWorkerOptions(options: Partial<DryRunHedgeWorkerOptions>): DryRunHedgeWorkerOptions {
  return {
    intervalMs: Number.isFinite(options.intervalMs) && Number(options.intervalMs) > 0
      ? Math.floor(Number(options.intervalMs))
      : DEFAULT_DRY_RUN_WORKER_INTERVAL_MS,
    once: options.once ?? false,
    latestPath: options.latestPath ?? DEFAULT_LATEST_HEDGE_PLANS_PATH,
    historyPath: options.historyPath ?? DEFAULT_HISTORY_HEDGE_PLANS_PATH,
    paperLiveMarketData: options.paperLiveMarketData ?? false,
    paperMarketDataUrl: options.paperMarketDataUrl,
    paperPolymarketTokenId: options.paperPolymarketTokenId,
    paperPolymarketClobBase: options.paperPolymarketClobBase ?? DEFAULT_PAPER_POLYMARKET_CLOB_BASE,
    paperSimFundsUsd: positiveNumber(options.paperSimFundsUsd, 100),
    paperSimNetExposureUsd: finiteNumber(options.paperSimNetExposureUsd, 10),
    paperHedgeRatio: clampNumber(finiteNumber(options.paperHedgeRatio, 0.5), 0, 1),
    paperMaxOrderUsd: positiveNumber(options.paperMaxOrderUsd, 10),
    paperEventKey: options.paperEventKey ?? "paper-live-market",
    paperPredictMarketId: options.paperPredictMarketId ?? "paper-predict",
    paperHedgeMarketId: options.paperHedgeMarketId ?? "paper-polymarket",
  };
}

async function buildPaperLiveMarketDataPayload(input: {
  options: DryRunHedgeWorkerOptions;
  now?: Date;
  fetchFn: typeof fetch;
}): Promise<StoredHedgePlanRecord> {
  const generatedAt = (input.now ?? new Date()).toISOString();
  const bookUrl = paperBookUrl(input.options);
  if (bookUrl === undefined) {
    return paperPayload(generatedAt, [
      paperRejectedPlan(input.options, "paper_market_data_not_configured", "no paper market data URL or Polymarket token id configured"),
    ]);
  }

  try {
    const response = await input.fetchFn(bookUrl);
    if (!response.ok) {
      return paperPayload(generatedAt, [
        paperRejectedPlan(input.options, "paper_market_data_fetch_failed", `market data HTTP ${response.status}`),
      ]);
    }

    const book = parsePaperOrderBook(await response.json());
    const plan = buildPaperPlanFromBook(input.options, book);
    return paperPayload(generatedAt, [plan]);
  } catch (error) {
    return paperPayload(generatedAt, [
      paperRejectedPlan(
        input.options,
        "paper_market_data_fetch_failed",
        error instanceof Error ? error.message : "market data fetch failed",
      ),
    ]);
  }
}

function paperPayload(generatedAt: string, plans: unknown[]): StoredHedgePlanRecord {
  return {
    schemaVersion: 1,
    generatedAt,
    source: "paper_live_market_data",
    mode: "dry_run",
    readOnly: true,
    liveTradingEnabled: false,
    plans,
  };
}

function buildPaperPlanFromBook(options: DryRunHedgeWorkerOptions, book: PaperOrderBook): Record<string, unknown> {
  const netExposureUsd = roundUsd(options.paperSimNetExposureUsd);
  const hedgeDirection = netExposureUsd >= 0 ? "SELL" : "BUY";
  const side = hedgeDirection === "SELL" ? book.bids : book.asks;
  const top = side[0];
  const depthUsd = roundUsd(side.reduce((total, level) => total + level.price * level.size, 0));
  const requestedUsd = Math.abs(netExposureUsd) * options.paperHedgeRatio;
  const hedgeSizeUsd = top === undefined
    ? 0
    : roundUsd(Math.min(requestedUsd, options.paperMaxOrderUsd, options.paperSimFundsUsd, depthUsd));
  const spread = book.asks[0] && book.bids[0] ? roundUsd(book.asks[0].price - book.bids[0].price) : undefined;
  const rejectReason = top === undefined || hedgeSizeUsd <= 0 ? "paper_market_depth_unavailable" : undefined;
  const exposureAfterUsd = roundUsd(netExposureUsd >= 0 ? netExposureUsd - hedgeSizeUsd : netExposureUsd + hedgeSizeUsd);

  return {
    strategy: "EXPOSURE_HEDGE",
    marketId: options.paperPredictMarketId,
    predictMarketId: options.paperPredictMarketId,
    eventKey: options.paperEventKey,
    hedgeDirection,
    netExposureUsd,
    hedgeSizeUsd,
    hedgeMarketId: options.paperHedgeMarketId,
    hedgeEventKey: options.paperEventKey,
    hedgeOrder: top === undefined
      ? undefined
      : {
        venue: "POLYMARKET",
        marketId: options.paperHedgeMarketId,
        side: hedgeDirection,
        limitPrice: top.price,
        sizeUsd: String(hedgeSizeUsd),
        postOnly: true,
      },
    exposureBeforeUsd: String(netExposureUsd),
    exposureAfterUsd: String(exposureAfterUsd),
    estimatedHedgeCostUsd: String(hedgeSizeUsd),
    executable: false,
    dryRun: true,
    postOnly: true,
    rejectReason,
    riskApproved: rejectReason === undefined,
    riskCodes: rejectReason === undefined ? [] : [rejectReason],
    risk: {
      approved: rejectReason === undefined,
      reasonCodes: rejectReason === undefined ? [] : [rejectReason],
    },
    metadata: {
      paperTrading: true,
      marketData: "live",
      simulatedFundsUsd: options.paperSimFundsUsd,
      simulatedNetExposureUsd: netExposureUsd,
      bestBid: book.bids[0]?.price,
      bestAsk: book.asks[0]?.price,
      spread,
      depthUsd,
      sourceUrl: paperBookUrl(options),
    },
  };
}

function paperRejectedPlan(
  options: DryRunHedgeWorkerOptions,
  code: string,
  message: string,
): Record<string, unknown> {
  return {
    strategy: "EXPOSURE_HEDGE",
    marketId: options.paperPredictMarketId,
    predictMarketId: options.paperPredictMarketId,
    eventKey: options.paperEventKey,
    hedgeDirection: "WATCH",
    netExposureUsd: roundUsd(options.paperSimNetExposureUsd),
    hedgeSizeUsd: 0,
    hedgeMarketId: options.paperHedgeMarketId,
    hedgeEventKey: options.paperEventKey,
    exposureBeforeUsd: String(roundUsd(options.paperSimNetExposureUsd)),
    exposureAfterUsd: String(roundUsd(options.paperSimNetExposureUsd)),
    estimatedHedgeCostUsd: "0",
    executable: false,
    dryRun: true,
    postOnly: true,
    rejectReason: code,
    riskApproved: false,
    riskCodes: [code],
    risk: {
      approved: false,
      reasonCodes: [code],
      rejectReason: code,
    },
    metadata: {
      paperTrading: true,
      marketData: "live",
      message,
      simulatedFundsUsd: options.paperSimFundsUsd,
      simulatedNetExposureUsd: roundUsd(options.paperSimNetExposureUsd),
    },
  };
}

interface PaperOrderBook {
  bids: PaperOrderBookLevel[];
  asks: PaperOrderBookLevel[];
}

interface PaperOrderBookLevel {
  price: number;
  size: number;
}

function parsePaperOrderBook(payload: unknown): PaperOrderBook {
  const record = asRecord(payload);
  const nestedBook = asRecord(record.book ?? record.orderbook ?? record.data);
  const source = Array.isArray(record.bids) || Array.isArray(record.asks) ? record : nestedBook;

  return {
    bids: levels(source.bids).sort((left, right) => right.price - left.price),
    asks: levels(source.asks).sort((left, right) => left.price - right.price),
  };
}

function levels(value: unknown): PaperOrderBookLevel[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (Array.isArray(item)) {
        return level(item[0], item[1]);
      }
      const record = asRecord(item);
      return level(record.price ?? record.p, record.size ?? record.quantity ?? record.q);
    })
    .filter((item): item is PaperOrderBookLevel => item !== undefined);
}

function level(priceValue: unknown, sizeValue: unknown): PaperOrderBookLevel | undefined {
  const price = Number(priceValue);
  const size = Number(sizeValue);
  if (!Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size <= 0) return undefined;
  return { price, size };
}

function paperBookUrl(options: DryRunHedgeWorkerOptions): string | undefined {
  if (options.paperMarketDataUrl) return options.paperMarketDataUrl;
  if (!options.paperPolymarketTokenId) return undefined;
  const base = options.paperPolymarketClobBase.replace(/\/$/, "");
  return `${base}/book?token_id=${encodeURIComponent(options.paperPolymarketTokenId)}`;
}

function boolOption(cliValue: string | true | undefined, envValue: string | undefined, fallback: boolean): boolean {
  if (cliValue === true) return true;
  if (typeof cliValue === "string") return parseBool(cliValue, fallback);
  return parseBool(envValue, fallback);
}

function numberOption(
  cliValue: string | true | undefined,
  envValue: string | undefined,
  fallback: number,
): number {
  if (typeof cliValue === "string") return numberValue(cliValue, fallback);
  return numberValue(envValue, fallback);
}

function stringOption(
  cliValue: string | true | undefined,
  envValue: string | undefined,
  fallback: string,
): string {
  if (typeof cliValue === "string" && cliValue.trim() !== "") return cliValue.trim();
  if (envValue !== undefined && envValue.trim() !== "") return envValue.trim();
  return fallback;
}

function optionalStringOption(cliValue: string | true | undefined, envValue: string | undefined): string | undefined {
  if (typeof cliValue === "string" && cliValue.trim() !== "") return cliValue.trim();
  if (envValue !== undefined && envValue.trim() !== "") return envValue.trim();
  return undefined;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function numberValue(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function signedNumberOption(
  cliValue: string | true | undefined,
  envValue: string | undefined,
  fallback: number,
): number {
  if (typeof cliValue === "string") return signedNumberValue(cliValue, fallback);
  return signedNumberValue(envValue, fallback);
}

function boundedNumberOption(
  cliValue: string | true | undefined,
  envValue: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  return clampNumber(signedNumberOption(cliValue, envValue, fallback), min, max);
}

function signedNumberValue(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isMainModule()) {
  await runDryRunHedgeWorker(parseDryRunHedgeWorkerOptions());
}
