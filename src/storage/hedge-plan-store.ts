import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface StoredHedgePlanRecord {
  schemaVersion: 1;
  generatedAt: string;
  source: string;
  mode: "dry_run";
  liveTradingEnabled: false;
  plans: unknown[];
}

export interface SanitizedHedgePlanRecord extends StoredHedgePlanRecord {
  plans: Record<string, unknown>[];
}

export interface HedgePlanSummary {
  totalPlans: number;
  approvedCount: number;
  rejectedCount: number;
  maxAbsExposureUsd: number;
}

export interface DashboardHedgePlanEnvelope extends SanitizedHedgePlanRecord {
  dataSource: "snapshot_env" | "latest_file" | "example_snapshot" | "empty_fallback";
  summary: HedgePlanSummary;
}

export const DEFAULT_LATEST_HEDGE_PLANS_PATH = "data/hedge-plans.latest.json";
export const DEFAULT_HISTORY_HEDGE_PLANS_PATH = "data/hedge-plans.history.jsonl";

export async function writeLatestHedgePlans(
  payload: StoredHedgePlanRecord,
  filePath = DEFAULT_LATEST_HEDGE_PLANS_PATH,
): Promise<SanitizedHedgePlanRecord> {
  const sanitized = sanitizeHedgePlans(payload);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
  return sanitized;
}

export async function readLatestHedgePlans(
  filePath = DEFAULT_LATEST_HEDGE_PLANS_PATH,
): Promise<SanitizedHedgePlanRecord | undefined> {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return sanitizeHedgePlans(raw);
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

export async function appendHedgePlanHistory(
  payload: StoredHedgePlanRecord,
  filePath = DEFAULT_HISTORY_HEDGE_PLANS_PATH,
): Promise<SanitizedHedgePlanRecord> {
  const sanitized = sanitizeHedgePlans(payload);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(sanitized)}\n`, { encoding: "utf8", flag: "a" });
  return sanitized;
}

export function sanitizeHedgePlans(payload: unknown): SanitizedHedgePlanRecord {
  const input = asRecord(payload);
  const plans = Array.isArray(input.plans)
    ? input.plans
    : Array.isArray(payload)
      ? payload
      : [];

  return {
    schemaVersion: 1,
    generatedAt: stringOrNow(input.generatedAt),
    source: typeof input.source === "string" ? input.source : "unknown",
    mode: "dry_run",
    liveTradingEnabled: false,
    plans: plans.map(sanitizePlan),
  };
}

export function summarizeHedgePlans(plans: readonly Record<string, unknown>[]): HedgePlanSummary {
  return {
    totalPlans: plans.length,
    approvedCount: plans.filter((plan) => planRiskApproved(plan)).length,
    rejectedCount: plans.filter((plan) => !planRiskApproved(plan)).length,
    maxAbsExposureUsd: plans.reduce((maxExposure, plan) => {
      const exposure = Math.abs(Number(plan.netExposureUsd ?? 0));
      return Number.isFinite(exposure) ? Math.max(maxExposure, exposure) : maxExposure;
    }, 0),
  };
}

function sanitizePlan(plan: unknown): Record<string, unknown> {
  const value = asRecord(plan);
  const risk = asRecord(value.risk);
  const riskCodes = Array.isArray(value.riskCodes)
    ? value.riskCodes
    : Array.isArray(risk.reasonCodes)
      ? risk.reasonCodes
      : [];
  const rejectReason =
    typeof value.rejectReason === "string"
      ? value.rejectReason
      : typeof risk.rejectReason === "string"
        ? risk.rejectReason
        : undefined;
  const riskApproved =
    typeof value.riskApproved === "boolean"
      ? value.riskApproved
      : typeof risk.approved === "boolean"
        ? risk.approved
        : rejectReason === undefined;

  return {
    ...value,
    marketId: stringValue(value.marketId ?? value.predictMarketId),
    riskCodes,
    riskApproved,
    exposureBeforeUsd: stringValue(value.exposureBeforeUsd, "0"),
    exposureAfterUsd: stringValue(value.exposureAfterUsd, "0"),
    estimatedHedgeCostUsd: stringValue(value.estimatedHedgeCostUsd, "0"),
    executable: false,
    dryRun: true,
  };
}

function planRiskApproved(plan: Record<string, unknown>): boolean {
  if (typeof plan.riskApproved === "boolean") return plan.riskApproved;
  const risk = asRecord(plan.risk);
  if (typeof risk.approved === "boolean") return risk.approved;
  return !plan.rejectReason;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringOrNow(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value : new Date().toISOString();
}

function stringValue(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && "toString" in value && typeof value.toString === "function") {
    return value.toString();
  }
  return fallback;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
