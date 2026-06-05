import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface StoredHedgePlanRecord {
  schemaVersion: 1;
  generatedAt: string;
  source: string;
  mode: "dry_run";
  readOnly?: true;
  liveTradingEnabled: false;
  plans: unknown[];
  paperLive?: PaperLiveStatus;
}

export interface HedgePlanSummary {
  totalPlans: number;
  approvedCount: number;
  rejectedCount: number;
  maxAbsExposureUsd: number;
}

export interface SanitizedHedgePlanRecord extends StoredHedgePlanRecord {
  readOnly: true;
  plans: Record<string, unknown>[];
  summary: HedgePlanSummary;
}

export type DashboardDataSource =
  | "snapshot_env"
  | "latest_file"
  | "paper_live"
  | "example_snapshot"
  | "empty_fallback";

export interface PaperLiveStatus {
  enabled: boolean;
  sourceType: "none" | "fixture" | "market_data_url" | "polymarket_token_id";
  sourceLabel: string;
  marketDataSource: "none" | "fixture" | "market_data_url" | "polymarket_clob_book";
  fixtureScenario?: string;
  marketDataUrlMasked?: string;
  marketDataUrlHost?: string;
  polymarketTokenIdMasked?: string;
  tokenIdMasked?: string;
  lastFetchAt?: string;
  fetchErrorCode?: string;
  maxSpread: number;
  minDepthUsd: number;
  maxMarketDataAgeMs: number;
}

export interface DashboardHedgePlanEnvelope extends SanitizedHedgePlanRecord {
  dataSource: DashboardDataSource;
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
  const sanitizedPlans = plans.map(sanitizePlan);

  return {
    schemaVersion: 1,
    generatedAt: stringOrNow(input.generatedAt),
    source: typeof input.source === "string" ? input.source : "unknown",
    mode: "dry_run",
    readOnly: true,
    liveTradingEnabled: false,
    plans: sanitizedPlans,
    summary: summarizeHedgePlans(sanitizedPlans),
    paperLive: sanitizePaperLiveStatus(input.paperLive),
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

function sanitizePaperLiveStatus(value: unknown): PaperLiveStatus | undefined {
  const input = asRecord(value);
  if (Object.keys(input).length === 0) return undefined;
  const sourceType = sourceTypeValue(input.sourceType);
  return {
    enabled: input.enabled === true,
    sourceType,
    sourceLabel: stringValue(input.sourceLabel, sourceType === "none" ? "not configured" : sourceType),
    marketDataSource: marketDataSourceValue(input.marketDataSource, sourceType),
    fixtureScenario: optionalString(input.fixtureScenario),
    marketDataUrlMasked: optionalString(input.marketDataUrlMasked),
    marketDataUrlHost: optionalString(input.marketDataUrlHost),
    polymarketTokenIdMasked: optionalString(input.polymarketTokenIdMasked),
    tokenIdMasked: optionalString(input.tokenIdMasked),
    lastFetchAt: optionalString(input.lastFetchAt),
    fetchErrorCode: optionalString(input.fetchErrorCode),
    maxSpread: finiteNumber(input.maxSpread, 0.05),
    minDepthUsd: finiteNumber(input.minDepthUsd, 1),
    maxMarketDataAgeMs: finiteNumber(input.maxMarketDataAgeMs, 10_000),
  };
}

function sourceTypeValue(value: unknown): PaperLiveStatus["sourceType"] {
  return value === "fixture" || value === "market_data_url" || value === "polymarket_token_id" ? value : "none";
}

function marketDataSourceValue(
  value: unknown,
  sourceType: PaperLiveStatus["sourceType"],
): PaperLiveStatus["marketDataSource"] {
  if (
    value === "market_data_url" ||
    value === "polymarket_clob_book" ||
    value === "fixture" ||
    value === "none"
  ) {
    return value;
  }
  if (sourceType === "fixture") return "fixture";
  if (sourceType === "market_data_url") return "market_data_url";
  if (sourceType === "polymarket_token_id") return "polymarket_clob_book";
  return "none";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
