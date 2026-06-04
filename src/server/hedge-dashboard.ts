import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { buildExposureHedgePlan } from "../strategy/exposure-hedge.js";
import type { HedgePlan } from "../hedge/hedge-planner.js";

interface DashboardHedgeOrder {
  venue?: string;
  marketId: string;
  side: string;
  limitPrice: number;
  sizeUsd: string;
  postOnly: boolean;
}

interface DashboardHedgePlan {
  strategy: "EXPOSURE_HEDGE";
  marketId: string;
  eventKey: string;
  hedgeDirection: string;
  netExposureUsd: number;
  hedgeSizeUsd: number;
  hedgeMarketId?: string;
  hedgeEventKey?: string;
  hedgeOrder?: DashboardHedgeOrder;
  exposureBeforeUsd: string;
  exposureAfterUsd: string;
  estimatedHedgeCostUsd: string;
  executable: false;
  dryRun: true;
  postOnly: boolean;
  rejectReason?: string;
  riskCodes: readonly string[];
  riskApproved: boolean;
}

export interface WalletDashboardConfig {
  enabled: boolean;
  readOnly: true;
  expectedChainId: number | null;
  expectedChainName: string | null;
  exposeBackendAddress: boolean;
  maskBackendAddress: boolean;
  allowFrontendSigning: false;
  allowFrontendTransactions: false;
}

export interface WalletStatusResponse {
  mode: "dry_run";
  liveTradingEnabled: false;
  readOnly: true;
  expectedChainId: number | null;
  expectedChainName: string | null;
  backendTradingAddressMasked?: string;
  secretsLoaded: boolean;
  canExecuteHedge: false;
  allowedActions: readonly ["OPEN_PURE_ARBITRAGE"];
  blockedActions: readonly ["EXPOSURE_HEDGE", "SIMPLE_MARKET_MAKER_QUOTES"];
  allowFrontendSigning: false;
  allowFrontendTransactions: false;
}

const PORT = Number(process.env.HEDGE_DASHBOARD_API_PORT ?? process.env.PORT ?? 3070);
const SNAPSHOT_PATH = process.env.HEDGE_DASHBOARD_SNAPSHOT;

if (isMainModule()) {
  const server = createDashboardServer();
  server.listen(PORT, () => {
    console.log(`Hedge dashboard API listening at http://localhost:${PORT}`);
  });
}

export function createDashboardServer() {
  return createServer(async (request, response) => {
    try {
      await route(request, response);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Unexpected dashboard server error",
      });
    }
  });
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.url === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      strategy: "EXPOSURE_HEDGE",
      executable: false,
      dryRun: true,
    });
    return;
  }

  if (request.url === "/api/hedge-plans") {
    sendJson(response, 200, await loadDashboardPlans());
    return;
  }

  if (request.url === "/api/wallet-status") {
    sendJson(response, 200, buildWalletStatusResponse(process.env));
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

export function buildWalletStatusResponse(env: NodeJS.ProcessEnv = process.env): WalletStatusResponse {
  const config = walletDashboardConfigFromEnv(env);
  const backendAddress = env.POLYMARKET_FUNDER_ADDRESS ?? env.BACKEND_TRADING_ADDRESS;
  const hasSecretMaterial = Boolean(
    env.POLYMARKET_PRIVATE_KEY ??
      env.POLY_API_SECRET ??
      env.POLY_API_KEY ??
      env.POLY_PASSPHRASE ??
      env.PREDICT_API_KEY,
  );

  const response: WalletStatusResponse = {
    mode: "dry_run",
    liveTradingEnabled: false,
    readOnly: true,
    expectedChainId: config.expectedChainId,
    expectedChainName: config.expectedChainName,
    secretsLoaded: hasSecretMaterial,
    canExecuteHedge: false,
    allowedActions: ["OPEN_PURE_ARBITRAGE"],
    blockedActions: ["EXPOSURE_HEDGE", "SIMPLE_MARKET_MAKER_QUOTES"],
    allowFrontendSigning: false,
    allowFrontendTransactions: false,
  };

  if (config.exposeBackendAddress && backendAddress) {
    response.backendTradingAddressMasked = config.maskBackendAddress
      ? maskAddress(backendAddress)
      : backendAddress;
  }

  return response;
}

export function walletDashboardConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WalletDashboardConfig {
  return {
    enabled: env.WALLET_ENABLED === undefined ? true : parseBool(env.WALLET_ENABLED),
    readOnly: true,
    expectedChainId: nullableNumber(env.WALLET_EXPECTED_CHAIN_ID, 137),
    expectedChainName: nullableString(env.WALLET_EXPECTED_CHAIN_NAME, "Polygon"),
    exposeBackendAddress:
      env.WALLET_EXPOSE_BACKEND_ADDRESS === undefined ? true : parseBool(env.WALLET_EXPOSE_BACKEND_ADDRESS),
    maskBackendAddress: env.WALLET_MASK_BACKEND_ADDRESS === undefined ? true : parseBool(env.WALLET_MASK_BACKEND_ADDRESS),
    allowFrontendSigning: false,
    allowFrontendTransactions: false,
  };
}

async function loadDashboardPlans(): Promise<DashboardHedgePlan[]> {
  if (SNAPSHOT_PATH) {
    const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8")) as unknown;
    return normalizeSnapshot(snapshot);
  }

  return samplePlans().map(toDashboardPlan);
}

function normalizeSnapshot(snapshot: unknown): DashboardHedgePlan[] {
  const plans = Array.isArray(snapshot)
    ? snapshot
    : typeof snapshot === "object" && snapshot !== null && "plans" in snapshot
      ? (snapshot as { plans?: unknown }).plans
      : [];

  if (!Array.isArray(plans)) return [];

  return plans.map((plan) => normalizePlanObject(plan));
}

function normalizePlanObject(plan: unknown): DashboardHedgePlan {
  const value = typeof plan === "object" && plan !== null ? (plan as Record<string, unknown>) : {};
  const risk = typeof value.risk === "object" && value.risk !== null ? (value.risk as Record<string, unknown>) : {};
  const riskCodes = Array.isArray(value.riskCodes)
    ? value.riskCodes.map(String)
    : Array.isArray(risk.reasonCodes)
      ? risk.reasonCodes.map(String)
      : [];

  const dashboardPlan: DashboardHedgePlan = {
    strategy: "EXPOSURE_HEDGE",
    marketId: String(value.marketId ?? value.predictMarketId ?? ""),
    eventKey: String(value.eventKey ?? ""),
    hedgeDirection: String(value.hedgeDirection ?? "NONE"),
    netExposureUsd: Number(value.netExposureUsd ?? 0),
    hedgeSizeUsd: Number(value.hedgeSizeUsd ?? 0),
    exposureBeforeUsd: String(value.exposureBeforeUsd ?? value.netExposureUsd ?? "0"),
    exposureAfterUsd: String(value.exposureAfterUsd ?? "0"),
    estimatedHedgeCostUsd: String(value.estimatedHedgeCostUsd ?? "0"),
    executable: false,
    dryRun: true,
    postOnly: Boolean(value.postOnly ?? true),
    riskCodes,
    riskApproved: Boolean(value.riskApproved ?? risk.approved ?? riskCodes.length === 0),
  };

  if (typeof value.hedgeMarketId === "string") {
    dashboardPlan.hedgeMarketId = value.hedgeMarketId;
  }
  if (typeof value.hedgeEventKey === "string") {
    dashboardPlan.hedgeEventKey = value.hedgeEventKey;
  }
  if (typeof value.rejectReason === "string") {
    dashboardPlan.rejectReason = value.rejectReason;
  }

  return dashboardPlan;
}

function samplePlans(): HedgePlan[] {
  return buildExposureHedgePlan({
    predictPositions: [
      {
        marketId: "predict-btc-up-1h",
        eventKey: "btc-hour-2026-06-05-01",
        side: "long",
        sizeUsd: 16,
      },
      {
        marketId: "predict-eth-up-1h",
        eventKey: "eth-hour-2026-06-05-01",
        side: "long",
        sizeUsd: 8,
      },
      {
        marketId: "predict-sol-up-1h",
        eventKey: "sol-hour-2026-06-05-01",
        side: "long",
        sizeUsd: 8,
      },
    ],
    candidates: [
      {
        venue: "polymarket",
        marketId: "poly-btc-up-1h",
        eventKey: "btc-hour-2026-06-05-01",
        noAsk: 0.42,
        depthUsd: 100,
        spread: 0.02,
        timestampMs: Date.now(),
      },
      {
        venue: "polymarket",
        marketId: "poly-sol-up-1h",
        eventKey: "sol-hour-2026-06-05-01",
        noAsk: 0.47,
        depthUsd: 10,
        spread: 0.09,
        timestampMs: Date.now() - 10_000,
      },
    ],
    config: {
      enabled: true,
      dryRun: true,
      hedgeRatio: 0.5,
      maxHedgeOrderUsd: 10,
      minHedgeOrderUsd: 1,
      maxNetExposureUsd: 25,
      maxPredictUsagePct: 0.3,
      maxSpread: 0.035,
      minDepthUsd: 20,
      maxDepthUsagePct: 0.25,
      maxMarketDataAgeMs: 2000,
      requireSameEventKey: true,
      allowCorrelatedHedge: false,
      liveTradingEnabled: false,
      postOnly: true,
    },
    nowMs: Date.now(),
  });
}

function toDashboardPlan(plan: HedgePlan): DashboardHedgePlan {
  const dashboardPlan: DashboardHedgePlan = {
    strategy: plan.strategy,
    marketId: plan.predictMarketId,
    eventKey: plan.eventKey,
    hedgeDirection: plan.hedgeDirection,
    netExposureUsd: plan.netExposureUsd,
    hedgeSizeUsd: plan.hedgeSizeUsd,
    exposureBeforeUsd: plan.exposureBeforeUsd.toString(),
    exposureAfterUsd: plan.exposureAfterUsd.toString(),
    estimatedHedgeCostUsd: plan.estimatedHedgeCostUsd.toString(),
    executable: false,
    dryRun: true,
    postOnly: plan.postOnly,
    riskCodes: plan.risk.reasonCodes,
    riskApproved: plan.risk.approved,
  };

  if (plan.hedgeMarketId) dashboardPlan.hedgeMarketId = plan.hedgeMarketId;
  if (plan.hedgeEventKey) dashboardPlan.hedgeEventKey = plan.hedgeEventKey;
  if (plan.rejectReason) dashboardPlan.rejectReason = plan.rejectReason;
  if (plan.hedgeOrder) {
    const hedgeOrder: DashboardHedgeOrder = {
      marketId: plan.hedgeOrder.marketId,
      side: plan.hedgeOrder.side,
      limitPrice: plan.hedgeOrder.limitPrice,
      sizeUsd: plan.hedgeOrder.sizeUsd.toString(),
      postOnly: plan.hedgeOrder.postOnly,
    };
    if (plan.hedgeOrder.venue) hedgeOrder.venue = plan.hedgeOrder.venue;
    dashboardPlan.hedgeOrder = hedgeOrder;
  }

  return dashboardPlan;
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function maskAddress(address: string): string {
  const normalized = address.trim();
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

function parseBool(value: string): boolean {
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function nullableString(value: string | undefined, fallback: string | null): string | null {
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "null") return null;
  return trimmed;
}

function nullableNumber(value: string | undefined, fallback: number | null): number | null {
  const normalized = nullableString(value, fallback === null ? null : String(fallback));
  if (normalized === null) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}
