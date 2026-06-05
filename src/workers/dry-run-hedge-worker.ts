import { pathToFileURL } from "node:url";
import {
  appendHedgePlanHistory,
  DEFAULT_HISTORY_HEDGE_PLANS_PATH,
  DEFAULT_LATEST_HEDGE_PLANS_PATH,
  writeLatestHedgePlans,
  type PaperLiveStatus,
  type SanitizedHedgePlanRecord,
  type StoredHedgePlanRecord,
} from "../storage/hedge-plan-store.js";
import {
  isPaperLiveFixtureScenario,
  paperLiveFixtureResponse,
  type PaperLiveFixtureScenario,
} from "./dry-run-paper-live-fixture.js";
import { appendOperatorLog, DEFAULT_OPERATOR_LOG_PATH } from "../logging/operator-log.js";
import { buildPaperSimulationStatus } from "../wallet/wallet-manager.js";

export interface DryRunHedgeWorkerOptions {
  intervalMs: number;
  once: boolean;
  latestPath: string;
  historyPath: string;
  paperLiveMarketData: boolean;
  paperSimulateWallets: boolean;
  paperSimPredictWalletCount: number;
  paperSimPredictWalletFundsUsd: number;
  paperSimPolymarketHedgeFundsUsd: number;
  paperFixtureScenario?: PaperLiveFixtureScenario;
  paperMarketDataUrl?: string;
  paperPolymarketTokenId?: string;
  paperPolymarketClobBase: string;
  paperSimFundsUsd: number;
  paperSimNetExposureUsd: number;
  paperHedgeRatio: number;
  paperMaxOrderUsd: number;
  paperMaxSpread: number;
  paperMinDepthUsd: number;
  paperMaxMarketDataAgeMs: number;
  paperEventKey: string;
  paperPredictMarketId: string;
  paperHedgeMarketId: string;
  operatorLogPath: string;
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
  await writeWorkerOperatorEvents(written, resolved, latestPath, historyPath);
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
    paperSimulateWallets: boolOption(args.get("--paper-simulate-wallets"), env.PAPER_SIMULATE_WALLETS, false),
    paperSimPredictWalletCount: integerOption(
      args.get("--paper-sim-predict-wallet-count"),
      env.PAPER_SIM_PREDICT_WALLET_COUNT,
      10,
    ),
    paperSimPredictWalletFundsUsd: numberOption(
      args.get("--paper-sim-predict-wallet-funds-usd"),
      env.PAPER_SIM_PREDICT_WALLET_FUNDS_USD,
      100,
    ),
    paperSimPolymarketHedgeFundsUsd: numberOption(
      args.get("--paper-sim-polymarket-hedge-funds-usd"),
      env.PAPER_SIM_POLYMARKET_HEDGE_FUNDS_USD,
      100,
    ),
    paperFixtureScenario: fixtureScenarioOption(args.get("--paper-fixture-scenario"), env.PAPER_FIXTURE_SCENARIO),
    paperMarketDataUrl: optionalStringOption(args.get("--paper-market-data-url"), env.PAPER_MARKET_DATA_URL),
    paperPolymarketTokenId: optionalStringOption(args.get("--paper-polymarket-token-id"), env.PAPER_POLYMARKET_TOKEN_ID),
    paperPolymarketClobBase: stringOption(
      args.get("--paper-polymarket-clob-base"),
      env.PAPER_POLYMARKET_CLOB_BASE,
      DEFAULT_PAPER_POLYMARKET_CLOB_BASE,
    ),
    paperSimFundsUsd: numberOption(
      args.get("--paper-sim-funds-usd"),
      firstEnv(env.PAPER_SIM_FUNDS_USD, env.PAPER_SIM_POLYMARKET_HEDGE_FUNDS_USD),
      100,
    ),
    paperSimNetExposureUsd: signedNumberOption(
      args.get("--paper-sim-net-exposure-usd"),
      env.PAPER_SIM_NET_EXPOSURE_USD,
      10,
    ),
    paperHedgeRatio: boundedNumberOption(args.get("--paper-hedge-ratio"), env.PAPER_HEDGE_RATIO, 0.5, 0, 1),
    paperMaxOrderUsd: numberOption(args.get("--paper-max-order-usd"), env.PAPER_MAX_ORDER_USD, 10),
    paperMaxSpread: boundedNumberOption(args.get("--paper-max-spread"), env.PAPER_MAX_SPREAD, 0.05, 0, 1),
    paperMinDepthUsd: numberOption(args.get("--paper-min-depth-usd"), env.PAPER_MIN_DEPTH_USD, 1),
    paperMaxMarketDataAgeMs: numberOption(
      args.get("--paper-max-market-data-age-ms"),
      env.PAPER_MAX_MARKET_DATA_AGE_MS,
      10_000,
    ),
    paperEventKey: stringOption(args.get("--paper-event-key"), env.PAPER_EVENT_KEY, "paper-live-market"),
    paperPredictMarketId: stringOption(args.get("--paper-predict-market-id"), env.PAPER_PREDICT_MARKET_ID, "paper-predict"),
    paperHedgeMarketId: stringOption(args.get("--paper-hedge-market-id"), env.PAPER_HEDGE_MARKET_ID, "paper-polymarket"),
    operatorLogPath: stringOption(args.get("--operator-log-path"), env.OPERATOR_LOG_PATH, DEFAULT_OPERATOR_LOG_PATH),
  });
}

export function paperLiveStatusFromOptions(options: Partial<DryRunHedgeWorkerOptions>): PaperLiveStatus {
  const resolved = resolveDryRunHedgeWorkerOptions(options);
  const sourceType = resolved.paperMarketDataUrl
    ? "market_data_url"
    : resolved.paperFixtureScenario
      ? "fixture"
    : resolved.paperPolymarketTokenId
      ? "polymarket_token_id"
      : "none";
  const marketDataUrlMasked = resolved.paperMarketDataUrl ? maskMarketDataUrl(resolved.paperMarketDataUrl) : undefined;
  const marketDataUrlHost = resolved.paperMarketDataUrl
    ? urlHost(resolved.paperMarketDataUrl)
    : sourceType === "polymarket_token_id"
      ? urlHost(resolved.paperPolymarketClobBase)
      : undefined;
  const polymarketTokenIdMasked = resolved.paperPolymarketTokenId ? maskTokenId(resolved.paperPolymarketTokenId) : undefined;
  const marketDataSource = sourceType === "market_data_url"
    ? "market_data_url"
    : sourceType === "polymarket_token_id"
      ? "polymarket_clob_book"
      : sourceType === "fixture"
        ? "fixture"
        : "none";
  return {
    enabled: resolved.paperLiveMarketData,
    sourceType,
    sourceLabel: resolved.paperFixtureScenario
      ? `fixture:${resolved.paperFixtureScenario}`
      : marketDataUrlMasked ?? polymarketTokenIdMasked ?? "not configured",
    marketDataSource,
    fixtureScenario: resolved.paperFixtureScenario,
    marketDataUrlMasked,
    marketDataUrlHost,
    polymarketTokenIdMasked,
    tokenIdMasked: polymarketTokenIdMasked,
    maxSpread: resolved.paperMaxSpread,
    minDepthUsd: resolved.paperMinDepthUsd,
    maxMarketDataAgeMs: resolved.paperMaxMarketDataAgeMs,
  };
}

export function paperLiveStatusFromEnv(env: NodeJS.ProcessEnv = process.env): PaperLiveStatus {
  return paperLiveStatusFromOptions(parseDryRunHedgeWorkerOptions([], env));
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
    paperSimulateWallets: options.paperSimulateWallets ?? false,
    paperSimPredictWalletCount: clampInteger(finiteNumber(options.paperSimPredictWalletCount, 10), 0, 10),
    paperSimPredictWalletFundsUsd: positiveNumber(options.paperSimPredictWalletFundsUsd, 100),
    paperSimPolymarketHedgeFundsUsd: positiveNumber(
      options.paperSimPolymarketHedgeFundsUsd,
      positiveNumber(options.paperSimFundsUsd, 100),
    ),
    paperFixtureScenario: options.paperFixtureScenario,
    paperMarketDataUrl: options.paperMarketDataUrl,
    paperPolymarketTokenId: options.paperPolymarketTokenId,
    paperPolymarketClobBase: options.paperPolymarketClobBase ?? DEFAULT_PAPER_POLYMARKET_CLOB_BASE,
    paperSimFundsUsd: positiveNumber(options.paperSimFundsUsd, positiveNumber(options.paperSimPolymarketHedgeFundsUsd, 100)),
    paperSimNetExposureUsd: finiteNumber(options.paperSimNetExposureUsd, 10),
    paperHedgeRatio: clampNumber(finiteNumber(options.paperHedgeRatio, 0.5), 0, 1),
    paperMaxOrderUsd: positiveNumber(options.paperMaxOrderUsd, 10),
    paperMaxSpread: clampNumber(finiteNumber(options.paperMaxSpread, 0.05), 0, 1),
    paperMinDepthUsd: positiveNumber(options.paperMinDepthUsd, 1),
    paperMaxMarketDataAgeMs: positiveNumber(options.paperMaxMarketDataAgeMs, 10_000),
    paperEventKey: options.paperEventKey ?? "paper-live-market",
    paperPredictMarketId: options.paperPredictMarketId ?? "paper-predict",
    paperHedgeMarketId: options.paperHedgeMarketId ?? "paper-polymarket",
    operatorLogPath: options.operatorLogPath ?? process.env.OPERATOR_LOG_PATH ?? DEFAULT_OPERATOR_LOG_PATH,
  };
}

async function buildPaperLiveMarketDataPayload(input: {
  options: DryRunHedgeWorkerOptions;
  now?: Date;
  fetchFn: typeof fetch;
}): Promise<StoredHedgePlanRecord> {
  const generatedAt = (input.now ?? new Date()).toISOString();
  const bookRequest = paperBookRequest(input.options);
  if (bookRequest.errorCode !== undefined || bookRequest.bookUrl === undefined) {
    const code = bookRequest.errorCode ?? "paper_market_token_id_missing";
    return paperPayload(input.options, generatedAt, [
      paperRejectedPlan(
        input.options,
        code,
        bookRequest.message ?? "paper market data source is not configured",
        { fetchErrorCode: code },
      ),
    ], { fetchErrorCode: code });
  }

  const lastFetchAt = generatedAt;
  try {
    const response = input.options.paperFixtureScenario
      ? fixtureFetch(input.options.paperFixtureScenario)
      : await input.fetchFn(bookRequest.bookUrl);
    if (!response.ok) {
      const code = response.status === 404
        ? "paper_market_orderbook_not_found"
        : "paper_market_data_bad_status";
      return paperPayload(input.options, generatedAt, [
        paperRejectedPlan(input.options, code, `market data HTTP ${response.status}`, { lastFetchAt, fetchErrorCode: code }),
      ], { lastFetchAt, fetchErrorCode: code });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      const code = "paper_orderbook_schema_invalid";
      return paperPayload(input.options, generatedAt, [
        paperRejectedPlan(
          input.options,
          code,
          error instanceof Error ? error.message : "orderbook JSON could not be parsed",
          { lastFetchAt, fetchErrorCode: code },
        ),
      ], { lastFetchAt, fetchErrorCode: code });
    }

    const book = parsePaperOrderBook(payload);
    const plan = buildPaperPlanFromBook(input.options, book, { lastFetchAt });
    const riskCodes = Array.isArray(plan.riskCodes) ? plan.riskCodes : [];
    const fetchErrorCode = riskCodes.includes("paper_orderbook_schema_invalid")
      ? "paper_orderbook_schema_invalid"
      : undefined;
    return paperPayload(input.options, generatedAt, [plan], { lastFetchAt, fetchErrorCode });
  } catch (error) {
    const code = "paper_market_data_network_error";
    return paperPayload(input.options, generatedAt, [
      paperRejectedPlan(
        input.options,
        code,
        error instanceof Error ? error.message : "market data fetch failed",
        { lastFetchAt, fetchErrorCode: code },
      ),
    ], { lastFetchAt, fetchErrorCode: code });
  }
}

function paperPayload(
  options: DryRunHedgeWorkerOptions,
  generatedAt: string,
  plans: unknown[],
  diagnostics: PaperMarketDiagnostics = {},
): StoredHedgePlanRecord {
  return {
    schemaVersion: 1,
    generatedAt,
    source: "paper_live_market_data",
    mode: "dry_run",
    readOnly: true,
    liveTradingEnabled: false,
    plans,
    paperLive: {
      ...paperLiveStatusFromOptions(options),
      ...diagnostics,
    },
  };
}

function buildPaperPlanFromBook(
  options: DryRunHedgeWorkerOptions,
  book: PaperOrderBook,
  diagnostics: PaperMarketDiagnostics = {},
): Record<string, unknown> {
  const netExposureUsd = roundUsd(options.paperSimNetExposureUsd);
  const hedgeDirection = netExposureUsd >= 0 ? "SELL" : "BUY";
  const side = hedgeDirection === "SELL" ? book.bids : book.asks;
  const top = side[0];
  const depthUsd = roundUsd(side.reduce((total, level) => total + level.price * level.size, 0));
  const requestedUsd = Math.abs(netExposureUsd) * options.paperHedgeRatio;
  const hedgeSizeUsd = top === undefined
    ? 0
    : roundUsd(Math.min(requestedUsd, options.paperMaxOrderUsd, options.paperSimPolymarketHedgeFundsUsd, depthUsd));
  const spread = book.asks[0] && book.bids[0] ? roundUsd(book.asks[0].price - book.bids[0].price) : undefined;
  const riskCodes = new Set(book.warningCodes);
  if (spread !== undefined && spread > options.paperMaxSpread) riskCodes.add("paper_orderbook_spread_too_wide");
  if (depthUsd < options.paperMinDepthUsd) riskCodes.add("paper_orderbook_depth_insufficient");
  if (book.timestampMs !== undefined && Date.now() - book.timestampMs > options.paperMaxMarketDataAgeMs) {
    riskCodes.add("paper_orderbook_stale");
  }
  if (top === undefined || hedgeSizeUsd <= 0) riskCodes.add("paper_market_depth_unavailable");
  const riskCodeList = [...riskCodes];
  const rejectReason = riskCodeList[0];
  const exposureAfterUsd = roundUsd(netExposureUsd >= 0 ? netExposureUsd - hedgeSizeUsd : netExposureUsd + hedgeSizeUsd);
  const paperSimulation = paperSimulationMetadata(options, {
    plannedHedgeUsd: hedgeSizeUsd,
    reservedHedgeUsd: riskCodeList.length === 0 ? hedgeSizeUsd : 0,
  });

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
    riskApproved: riskCodeList.length === 0,
    riskCodes: riskCodeList,
    risk: {
      approved: riskCodeList.length === 0,
      reasonCodes: riskCodeList,
    },
    metadata: {
      paperTrading: true,
      marketData: "live",
      simulatedFundsUsd: options.paperSimPolymarketHedgeFundsUsd,
      simulatedNetExposureUsd: netExposureUsd,
      bestBid: book.bids[0]?.price,
      bestAsk: book.asks[0]?.price,
      spread,
      depthUsd,
      orderbookTimestampMs: book.timestampMs,
      ...paperMarketMetadata(options, diagnostics, paperSimulation),
    },
  };
}

function paperRejectedPlan(
  options: DryRunHedgeWorkerOptions,
  code: string,
  message: string,
  diagnostics: PaperMarketDiagnostics = {},
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
      message,
      ...paperMarketMetadata(options, diagnostics, paperSimulationMetadata(options, {
        plannedHedgeUsd: 0,
        reservedHedgeUsd: 0,
      })),
      simulatedFundsUsd: options.paperSimPolymarketHedgeFundsUsd,
      simulatedNetExposureUsd: roundUsd(options.paperSimNetExposureUsd),
    },
  };
}

interface PaperOrderBook {
  bids: PaperOrderBookLevel[];
  asks: PaperOrderBookLevel[];
  warningCodes: string[];
  timestampMs?: number;
}

interface PaperBookRequest {
  bookUrl?: string;
  errorCode?: string;
  message?: string;
}

interface PaperMarketDiagnostics {
  lastFetchAt?: string;
  fetchErrorCode?: string;
}

interface PaperOrderBookLevel {
  price: number;
  size: number;
}

function parsePaperOrderBook(payload: unknown): PaperOrderBook {
  const record = asRecord(payload);
  const nestedBook = asRecord(record.book ?? record.orderbook ?? record.data);
  const source = Array.isArray(record.bids) || Array.isArray(record.asks) ? record : nestedBook;
  const warningCodes: string[] = [];
  if (!Array.isArray(source.bids)) warningCodes.push("paper_orderbook_schema_invalid", "paper_orderbook_bids_missing");
  if (!Array.isArray(source.asks)) warningCodes.push("paper_orderbook_schema_invalid", "paper_orderbook_asks_missing");

  return {
    bids: levels(source.bids, warningCodes).sort((left, right) => right.price - left.price),
    asks: levels(source.asks, warningCodes).sort((left, right) => left.price - right.price),
    warningCodes: [...new Set(warningCodes)],
    timestampMs: timestampMs(source.timestampMs ?? source.timestamp ?? source.updatedAt ?? source.lastUpdated),
  };
}

function levels(value: unknown, warningCodes: string[]): PaperOrderBookLevel[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (Array.isArray(item)) {
        return level(item[0], item[1], warningCodes);
      }
      const record = asRecord(item);
      return level(record.price ?? record.p, record.size ?? record.quantity ?? record.q, warningCodes);
    })
    .filter((item): item is PaperOrderBookLevel => item !== undefined);
}

function level(priceValue: unknown, sizeValue: unknown, warningCodes: string[]): PaperOrderBookLevel | undefined {
  const price = Number(priceValue);
  const size = Number(sizeValue);
  if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) {
    warningCodes.push("paper_orderbook_level_malformed");
    return undefined;
  }
  if (price < 0 || price > 1) {
    warningCodes.push("paper_orderbook_price_out_of_range");
    return undefined;
  }
  if (price === 0) {
    warningCodes.push("paper_orderbook_level_malformed");
    return undefined;
  }
  return { price, size };
}

function timestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function paperBookRequest(options: DryRunHedgeWorkerOptions): PaperBookRequest {
  if (options.paperFixtureScenario) return { bookUrl: `fixture:${options.paperFixtureScenario}` };
  if (options.paperMarketDataUrl) return { bookUrl: options.paperMarketDataUrl };
  if (!options.paperPolymarketTokenId) {
    return {
      errorCode: "paper_market_token_id_missing",
      message: "PAPER_POLYMARKET_TOKEN_ID is required when PAPER_MARKET_DATA_URL is not set",
    };
  }
  if (isPlaceholderTokenId(options.paperPolymarketTokenId)) {
    return {
      errorCode: "paper_market_token_id_placeholder",
      message: "PAPER_POLYMARKET_TOKEN_ID is still a placeholder",
    };
  }
  const base = options.paperPolymarketClobBase.replace(/\/$/, "");
  return { bookUrl: `${base}/book?token_id=${encodeURIComponent(options.paperPolymarketTokenId)}` };
}

function paperMarketMetadata(
  options: DryRunHedgeWorkerOptions,
  diagnostics: PaperMarketDiagnostics = {},
  paperSimulation = paperSimulationMetadata(options),
): Record<string, unknown> {
  const status = paperLiveStatusFromOptions(options);
  return {
    paperTrading: true,
    marketData: "live",
    marketDataSource: status.marketDataSource,
    tokenIdMasked: status.tokenIdMasked,
    marketDataUrlHost: status.marketDataUrlHost,
    lastFetchAt: diagnostics.lastFetchAt,
    fetchErrorCode: diagnostics.fetchErrorCode,
    source: status.sourceLabel,
    paperSimulation,
    simulatedWallets: simulatedWalletMetadata(paperSimulation),
  };
}

async function writeWorkerOperatorEvents(
  written: SanitizedHedgePlanRecord,
  options: DryRunHedgeWorkerOptions,
  latestPath: string,
  historyPath: string,
): Promise<void> {
  if (!options.paperLiveMarketData) return;
  try {
    const paperLive = paperLiveStatusFromOptions(options);
    const firstPlan = written.plans[0] ?? {};
    const riskCodes = Array.isArray(firstPlan.riskCodes) ? firstPlan.riskCodes.map(String) : [];
    const rejectReason = typeof firstPlan.rejectReason === "string" ? firstPlan.rejectReason : undefined;
    const metadata = asRecord(firstPlan.metadata);
    const planPaperSimulation = asRecord(metadata.paperSimulation);
    const paperSimulation = Object.keys(planPaperSimulation).length > 0
      ? planPaperSimulation
      : paperSimulationMetadata(options);
    const baseData = {
      paperLive: true,
      readOnly: true,
      liveTradingEnabled: false,
      marketDataSource: paperLive.marketDataSource,
      sourceLabel: paperLive.sourceLabel,
      tokenIdMasked: paperLive.tokenIdMasked,
      marketDataUrlHost: paperLive.marketDataUrlHost,
      fixtureScenario: paperLive.fixtureScenario,
      paperSimulation,
    };

    await appendOperatorLog({
      level: "info",
      component: "dry-run-worker",
      event: "paper_live_started",
      message: "Paper-live dry-run worker started",
      data: baseData,
    }, options.operatorLogPath);

    if (options.paperSimulateWallets) {
      await appendOperatorLog({
        level: "info",
        component: "dry-run-worker",
        event: "paper_sim_wallets_loaded",
        message: "Paper simulated wallets loaded",
        data: paperSimulation,
      }, options.operatorLogPath);
      await appendOperatorLog({
        level: "info",
        component: "dry-run-worker",
        event: "paper_wallet_funds_updated",
        message: "Paper simulated wallet funds updated",
        data: {
          paperSimulation,
          hedgeSizeUsd: firstPlan.hedgeSizeUsd,
          riskApproved: riskCodes.length === 0,
        },
      }, options.operatorLogPath);
    }

    if (rejectReason === "paper_market_token_id_missing") {
      await appendOperatorLog({
        level: "warn",
        component: "market-data",
        event: "market_data_config_missing",
        message: "Paper-live market data token/url is missing",
        data: baseData,
      }, options.operatorLogPath);
    }

    if (riskCodes.includes("paper_orderbook_schema_invalid")) {
      await appendOperatorLog({
        level: "error",
        component: "market-data",
        event: "orderbook_schema_invalid",
        message: "Orderbook schema is invalid",
        data: { ...baseData, rejectReason, riskCodes },
      }, options.operatorLogPath);
    } else if (rejectReason?.startsWith("paper_market_data_") || rejectReason === "paper_market_orderbook_not_found") {
      await appendOperatorLog({
        level: "warn",
        component: "market-data",
        event: "market_data_fetch_failed",
        message: "Market data fetch failed",
        data: { ...baseData, rejectReason, riskCodes },
      }, options.operatorLogPath);
    } else if (metadata.bestBid !== undefined || metadata.bestAsk !== undefined) {
      await appendOperatorLog({
        level: "info",
        component: "market-data",
        event: "market_data_fetch_succeeded",
        message: "Market data fetch succeeded",
        data: {
          ...baseData,
          bestBid: metadata.bestBid,
          bestAsk: metadata.bestAsk,
          spread: metadata.spread,
          depthUsd: metadata.depthUsd,
        },
      }, options.operatorLogPath);
    }

    await appendOperatorLog({
      level: riskCodes.length === 0 ? "info" : "warn",
      component: "dry-run-worker",
      event: "orderbook_diagnostics_updated",
      message: "Orderbook diagnostics updated",
      data: {
        ...baseData,
        riskCodes,
        rejectReason,
        bestBid: metadata.bestBid,
        bestAsk: metadata.bestAsk,
        spread: metadata.spread,
        depthUsd: metadata.depthUsd,
      },
    }, options.operatorLogPath);

    await appendOperatorLog({
      level: written.summary.rejectedCount > 0 ? "warn" : "info",
      component: "dry-run-worker",
      event: "dry_run_plan_created",
      message: "Dry-run hedge plan created",
      data: {
        ...baseData,
        planCount: written.summary.totalPlans,
        approvedCount: written.summary.approvedCount,
        rejectedCount: written.summary.rejectedCount,
        hedgeSizeUsd: firstPlan.hedgeSizeUsd,
        executable: false,
        dryRun: true,
      },
    }, options.operatorLogPath);

    await appendOperatorLog({
      level: "debug",
      component: "dry-run-worker",
      event: "latest_file_written",
      message: "Latest dry-run hedge plan file written",
      data: { latestPath },
    }, options.operatorLogPath);
    await appendOperatorLog({
      level: "debug",
      component: "dry-run-worker",
      event: "history_file_appended",
      message: "Dry-run hedge plan history appended",
      data: { historyPath },
    }, options.operatorLogPath);
  } catch {
    // Operator logging is diagnostic-only and must not stop the dry-run worker.
  }
}

function paperSimulationMetadata(
  options: DryRunHedgeWorkerOptions,
  overrides: {
    plannedHedgeUsd?: number;
    reservedHedgeUsd?: number;
  } = {},
): Record<string, unknown> {
  const fallbackPlannedHedgeUsd = Math.min(
    Math.abs(options.paperSimNetExposureUsd) * options.paperHedgeRatio,
    options.paperMaxOrderUsd,
    options.paperSimPolymarketHedgeFundsUsd,
  );
  return buildPaperSimulationStatus({
    enabled: options.paperSimulateWallets,
    predictWalletCount: options.paperSimPredictWalletCount,
    predictWalletFundsUsd: options.paperSimPredictWalletFundsUsd,
    polymarketHedgeFundsUsd: options.paperSimPolymarketHedgeFundsUsd,
    simulatedNetExposureUsd: roundUsd(options.paperSimNetExposureUsd),
    plannedHedgeUsd: roundUsd(overrides.plannedHedgeUsd ?? fallbackPlannedHedgeUsd),
    reservedHedgeUsd: roundUsd(overrides.reservedHedgeUsd ?? fallbackPlannedHedgeUsd),
  }) as unknown as Record<string, unknown>;
}

function simulatedWalletMetadata(paperSimulation: Record<string, unknown>): Record<string, unknown> {
  const predictWallets = Array.isArray(paperSimulation.predictWallets)
    ? paperSimulation.predictWallets.map((wallet) => asRecord(wallet))
    : [];
  const polymarketWallet = asRecord(paperSimulation.polymarketHedgeWallet);
  return {
    predictWallets: paperSimulation.predictWalletCount,
    perWalletFundsUsd: paperSimulation.predictWalletFundsUsd,
    polymarketHedgeFundsUsd: paperSimulation.polymarketHedgeFundsUsd,
    availableUsd: predictWallets.map((wallet) => wallet.availableUsd),
    reservedUsd: predictWallets.map((wallet) => wallet.reservedUsd),
    netExposureUsd: predictWallets.map((wallet) => wallet.netExposureUsd),
    polymarketAvailableUsd: polymarketWallet.availableUsd,
    polymarketReservedUsd: polymarketWallet.reservedUsd,
    plannedHedgeUsd: paperSimulation.plannedHedgeUsd,
  };
}

function maskMarketDataUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "data:") return "data:application/json,<redacted>";
    url.search = url.search ? "?..." : "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.length <= 24 ? value : `${value.slice(0, 16)}...${value.slice(-6)}`;
  }
}

function urlHost(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol === "data:") return "data";
    return url.host;
  } catch {
    return undefined;
  }
}

function maskTokenId(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

function isPlaceholderTokenId(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "<readonly-token-id>" ||
    normalized === "readonly-token-id" ||
    normalized === "<token-id>" ||
    normalized === "token-id" ||
    normalized === "<polymarket-token-id>" ||
    normalized === "<真实 polymarket token_id>" ||
    (normalized.startsWith("<") && normalized.endsWith(">"));
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

function integerOption(
  cliValue: string | true | undefined,
  envValue: string | undefined,
  fallback: number,
): number {
  return Math.floor(numberOption(cliValue, envValue, fallback));
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

function firstEnv(...values: (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined && value.trim() !== "");
}

function fixtureScenarioOption(
  cliValue: string | true | undefined,
  envValue: string | undefined,
): PaperLiveFixtureScenario | undefined {
  const value = typeof cliValue === "string" ? cliValue : envValue;
  if (value === undefined || value.trim() === "") return undefined;
  const normalized = value.trim();
  return isPaperLiveFixtureScenario(normalized) ? normalized : undefined;
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

function clampInteger(value: number, min: number, max: number): number {
  return Math.floor(clampNumber(value, min, max));
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

function fixtureFetch(scenario: PaperLiveFixtureScenario): Response {
  const fixture = paperLiveFixtureResponse(scenario);
  return new Response(fixture.body, {
    status: fixture.status,
    headers: { "content-type": fixture.contentType },
  });
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isMainModule()) {
  await runDryRunHedgeWorker(parseDryRunHedgeWorkerOptions());
}
