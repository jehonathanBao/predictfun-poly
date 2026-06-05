import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { loadHedgeDryRunSummary } from "../analytics/hedge-dry-run-replay.js";
import { buildAccountHealthResponse } from "./account-health.js";
import {
  loadDashboardDryRunAlerts,
  loadDashboardDryRunReport,
} from "./dashboard-alerts.js";
import { loadHedgePlansForDashboard } from "./dashboard-data-source.js";
import { loadDashboardStatus } from "./dashboard-status.js";
import { buildWalletManagerDashboardResponse } from "../wallet/wallet-manager.js";

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
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      strategy: "EXPOSURE_HEDGE",
      executable: false,
      dryRun: true,
    });
    return;
  }

  if (url.pathname === "/api/hedge-plans") {
    sendJson(response, 200, await loadHedgePlansForDashboard());
    return;
  }

  if (url.pathname === "/api/dashboard-status") {
    sendJson(response, 200, await loadDashboardStatus());
    return;
  }

  if (url.pathname === "/api/wallet-status") {
    sendJson(response, 200, buildWalletStatusResponse(process.env));
    return;
  }

  if (url.pathname === "/api/wallet-manager") {
    sendJson(response, 200, buildWalletManagerDashboardResponse(process.env));
    return;
  }

  if (url.pathname === "/api/account-health") {
    sendJson(response, 200, buildAccountHealthResponse(process.env));
    return;
  }

  if (url.pathname === "/api/dry-run-summary") {
    sendJson(response, 200, await loadHedgeDryRunSummary({ limit: queryLimit(url) }));
    return;
  }

  if (url.pathname === "/api/dry-run-alerts") {
    sendJson(response, 200, await loadDashboardDryRunAlerts(queryLimit(url)));
    return;
  }

  if (url.pathname === "/api/dry-run-report") {
    sendJson(response, 200, await loadDashboardDryRunReport(queryLimit(url)));
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

function queryLimit(url: URL): number | undefined {
  const raw = url.searchParams.get("limit");
  if (raw === null || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}
