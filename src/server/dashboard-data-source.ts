import { readFile } from "node:fs/promises";
import {
  DEFAULT_LATEST_HEDGE_PLANS_PATH,
  sanitizeHedgePlans,
  summarizeHedgePlans,
  type DashboardHedgePlanEnvelope,
  type SanitizedHedgePlanRecord,
} from "../storage/hedge-plan-store.js";

export interface DashboardDataSourceOptions {
  snapshotPath?: string;
  latestPath?: string;
  examplePath?: string;
}

const DEFAULT_EXAMPLE_SNAPSHOT_PATH = "examples/hedge-dashboard-snapshot.json";

export async function loadHedgePlansForDashboard(
  options: DashboardDataSourceOptions = {},
): Promise<DashboardHedgePlanEnvelope> {
  const snapshotPath = options.snapshotPath ?? process.env.HEDGE_DASHBOARD_SNAPSHOT;
  const latestPath = options.latestPath ?? process.env.HEDGE_DASHBOARD_LATEST_PATH ?? DEFAULT_LATEST_HEDGE_PLANS_PATH;
  const examplePath = options.examplePath ?? process.env.HEDGE_DASHBOARD_EXAMPLE_PATH ?? DEFAULT_EXAMPLE_SNAPSHOT_PATH;

  if (snapshotPath) {
    const snapshot = await readJsonIfExists(snapshotPath);
    if (snapshot !== undefined) return toEnvelope(snapshot, "snapshot_env");
  }

  const latest = await readJsonIfExists(latestPath);
  if (latest !== undefined) return toEnvelope(latest, "latest_file");

  const example = await readJsonIfExists(examplePath);
  if (example !== undefined) return toEnvelope(example, "example_snapshot");

  return toEnvelope(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      source: "empty_fallback",
      mode: "dry_run",
      liveTradingEnabled: false,
      plans: [],
    },
    "empty_fallback",
  );
}

function toEnvelope(payload: unknown, dataSource: DashboardHedgePlanEnvelope["dataSource"]): DashboardHedgePlanEnvelope {
  const sanitized = normalizePayload(payload);
  return {
    ...sanitized,
    dataSource,
    summary: summarizeHedgePlans(sanitized.plans),
  };
}

function normalizePayload(payload: unknown): SanitizedHedgePlanRecord {
  if (Array.isArray(payload)) {
    return sanitizeHedgePlans({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      source: "legacy_plan_array",
      mode: "dry_run",
      liveTradingEnabled: false,
      plans: payload,
    });
  }

  return sanitizeHedgePlans(payload);
}

async function readJsonIfExists(filePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
