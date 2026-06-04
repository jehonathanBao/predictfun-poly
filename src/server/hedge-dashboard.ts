import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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

const PORT = Number(process.env.HEDGE_DASHBOARD_API_PORT ?? process.env.PORT ?? 3070);
const SNAPSHOT_PATH = process.env.HEDGE_DASHBOARD_SNAPSHOT;

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unexpected dashboard server error",
    });
  }
});

server.listen(PORT, () => {
  console.log(`Hedge dashboard API listening at http://localhost:${PORT}`);
});

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

  sendJson(response, 404, { error: "Not found" });
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
