import {
  loadHedgePlansForDashboard,
  type DashboardDataSourceOptions,
} from "./dashboard-data-source.js";
import type { DashboardHedgePlanEnvelope } from "../storage/hedge-plan-store.js";

export type DashboardBotStatus = "fresh" | "stale" | "no_data";

export interface DashboardStatusResponse {
  apiStatus: "ok";
  botStatus: DashboardBotStatus;
  readOnly: true;
  liveTradingEnabled: false;
  dataSource: DashboardHedgePlanEnvelope["dataSource"];
  lastUpdated: string | null;
  dataAgeMs: number | null;
  staleThresholdMs: number;
  planCount: number;
  approvedCount: number;
  rejectedCount: number;
  maxAbsExposureUsd: number;
}

export interface DashboardStatusOptions extends DashboardDataSourceOptions {
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
  staleThresholdMs?: number;
}

export const DEFAULT_DASHBOARD_STALE_DATA_THRESHOLD_MS = 30_000;

export async function loadDashboardStatus(
  options: DashboardStatusOptions = {},
): Promise<DashboardStatusResponse> {
  const env = options.env ?? process.env;
  const staleThresholdMs =
    options.staleThresholdMs ?? dashboardStaleThresholdFromEnv(env);
  const envelope = await loadHedgePlansForDashboard({
    snapshotPath: options.snapshotPath ?? env.HEDGE_DASHBOARD_SNAPSHOT,
    latestPath: options.latestPath ?? env.HEDGE_DASHBOARD_LATEST_PATH,
    examplePath: options.examplePath ?? env.HEDGE_DASHBOARD_EXAMPLE_PATH,
  });

  return buildDashboardStatus(envelope, {
    nowMs: options.nowMs,
    staleThresholdMs,
  });
}

export function buildDashboardStatus(
  envelope: DashboardHedgePlanEnvelope,
  options: { nowMs?: number; staleThresholdMs?: number } = {},
): DashboardStatusResponse {
  const staleThresholdMs =
    options.staleThresholdMs ?? DEFAULT_DASHBOARD_STALE_DATA_THRESHOLD_MS;
  const nowMs = options.nowMs ?? Date.now();
  const freshness = calculateFreshness(envelope, nowMs, staleThresholdMs);

  return {
    apiStatus: "ok",
    botStatus: freshness.botStatus,
    readOnly: true,
    liveTradingEnabled: false,
    dataSource: envelope.dataSource,
    lastUpdated: freshness.lastUpdated,
    dataAgeMs: freshness.dataAgeMs,
    staleThresholdMs,
    planCount: envelope.summary.totalPlans,
    approvedCount: envelope.summary.approvedCount,
    rejectedCount: envelope.summary.rejectedCount,
    maxAbsExposureUsd: envelope.summary.maxAbsExposureUsd,
  };
}

export function dashboardStaleThresholdFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.DASHBOARD_STALE_DATA_THRESHOLD_MS;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_DASHBOARD_STALE_DATA_THRESHOLD_MS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_DASHBOARD_STALE_DATA_THRESHOLD_MS;
}

function calculateFreshness(
  envelope: DashboardHedgePlanEnvelope,
  nowMs: number,
  staleThresholdMs: number,
): {
  botStatus: DashboardBotStatus;
  lastUpdated: string | null;
  dataAgeMs: number | null;
} {
  if (
    envelope.dataSource !== "latest_file" &&
    envelope.dataSource !== "paper_live" &&
    envelope.dataSource !== "snapshot_env"
  ) {
    return { botStatus: "no_data", lastUpdated: null, dataAgeMs: null };
  }

  const generatedMs = Date.parse(envelope.generatedAt);
  if (!Number.isFinite(generatedMs)) {
    return { botStatus: "no_data", lastUpdated: null, dataAgeMs: null };
  }

  const dataAgeMs = Math.max(0, nowMs - generatedMs);
  const hasStaleOrderbook = envelope.plans.some((plan) => {
    const riskCodes = Array.isArray(plan.riskCodes) ? plan.riskCodes : [];
    return riskCodes.includes("paper_orderbook_stale");
  });
  return {
    botStatus: dataAgeMs <= staleThresholdMs && !hasStaleOrderbook ? "fresh" : "stale",
    lastUpdated: envelope.generatedAt,
    dataAgeMs,
  };
}
