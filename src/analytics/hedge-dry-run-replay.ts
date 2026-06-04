import { readFile } from "node:fs/promises";
import {
  DEFAULT_HISTORY_HEDGE_PLANS_PATH,
  sanitizeHedgePlans,
  summarizeHedgePlans,
  type SanitizedHedgePlanRecord,
} from "../storage/hedge-plan-store.js";

export interface HedgeDryRunReplayOptions {
  historyPath?: string;
  limit?: number;
  nowMs?: number;
}

export interface HedgeDryRunReplaySummary {
  schemaVersion: 1;
  mode: "dry_run";
  readOnly: true;
  liveTradingEnabled: false;
  generatedAt: string;
  recordCount: number;
  planCount: number;
  approvedCount: number;
  rejectedCount: number;
  maxAbsExposureUsd: number;
  rejectReasonCounts: Record<string, number>;
  riskCodeCounts: Record<string, number>;
  eventExposure: {
    eventKey: string;
    latestNetExposureUsd: number;
    maxAbsExposureUsd: number;
    observationCount: number;
  }[];
  timeline: {
    generatedAt: string;
    planCount: number;
    approvedCount: number;
    rejectedCount: number;
    maxAbsExposureUsd: number;
  }[];
}

export const DEFAULT_DRY_RUN_HISTORY_LIMIT = 100;

export async function loadHedgeDryRunSummary(
  options: HedgeDryRunReplayOptions = {},
): Promise<HedgeDryRunReplaySummary> {
  const records = await readHedgeDryRunHistory(options);
  return buildHedgeDryRunSummary(records, options.nowMs);
}

export async function readHedgeDryRunHistory(
  options: HedgeDryRunReplayOptions = {},
): Promise<SanitizedHedgePlanRecord[]> {
  const historyPath =
    options.historyPath ??
    process.env.DASHBOARD_HISTORY_PATH ??
    DEFAULT_HISTORY_HEDGE_PLANS_PATH;
  const limit = normalizeLimit(options.limit ?? numberEnv(process.env.DASHBOARD_DRY_RUN_HISTORY_LIMIT));

  let raw: string;
  try {
    raw = await readFile(historyPath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }

  const records = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .flatMap((line) => parseHistoryLine(line));

  return records.slice(-limit);
}

export function buildHedgeDryRunSummary(
  records: readonly SanitizedHedgePlanRecord[],
  nowMs = Date.now(),
): HedgeDryRunReplaySummary {
  const plans = records.flatMap((record) => record.plans);
  const summary = summarizeHedgePlans(plans);

  return {
    schemaVersion: 1,
    mode: "dry_run",
    readOnly: true,
    liveTradingEnabled: false,
    generatedAt: new Date(nowMs).toISOString(),
    recordCount: records.length,
    planCount: summary.totalPlans,
    approvedCount: summary.approvedCount,
    rejectedCount: summary.rejectedCount,
    maxAbsExposureUsd: summary.maxAbsExposureUsd,
    rejectReasonCounts: countRejectReasons(plans),
    riskCodeCounts: countRiskCodes(plans),
    eventExposure: aggregateEventExposure(records),
    timeline: buildExposureTimeline(records),
  };
}

export function countRejectReasons(
  plans: readonly Record<string, unknown>[],
): Record<string, number> {
  return plans.reduce<Record<string, number>>((counts, plan) => {
    const rejectReason = stringValue(plan.rejectReason);
    if (rejectReason) {
      counts[rejectReason] = (counts[rejectReason] ?? 0) + 1;
    }
    return counts;
  }, {});
}

export function countRiskCodes(
  plans: readonly Record<string, unknown>[],
): Record<string, number> {
  return plans.reduce<Record<string, number>>((counts, plan) => {
    const riskCodes = Array.isArray(plan.riskCodes) ? plan.riskCodes : [];
    for (const code of riskCodes) {
      const normalized = stringValue(code);
      if (normalized) counts[normalized] = (counts[normalized] ?? 0) + 1;
    }
    return counts;
  }, {});
}

export function buildExposureTimeline(
  records: readonly SanitizedHedgePlanRecord[],
): HedgeDryRunReplaySummary["timeline"] {
  return records.map((record) => {
    const summary = summarizeHedgePlans(record.plans);
    return {
      generatedAt: record.generatedAt,
      planCount: summary.totalPlans,
      approvedCount: summary.approvedCount,
      rejectedCount: summary.rejectedCount,
      maxAbsExposureUsd: summary.maxAbsExposureUsd,
    };
  });
}

export function aggregateEventExposure(
  records: readonly SanitizedHedgePlanRecord[],
): HedgeDryRunReplaySummary["eventExposure"] {
  const exposures = new Map<
    string,
    {
      eventKey: string;
      latestNetExposureUsd: number;
      maxAbsExposureUsd: number;
      observationCount: number;
    }
  >();

  for (const record of records) {
    for (const plan of record.plans) {
      const eventKey = stringValue(plan.eventKey);
      if (!eventKey) continue;
      const exposure = numberValue(plan.netExposureUsd);
      const current = exposures.get(eventKey) ?? {
        eventKey,
        latestNetExposureUsd: 0,
        maxAbsExposureUsd: 0,
        observationCount: 0,
      };
      current.latestNetExposureUsd = exposure;
      current.maxAbsExposureUsd = Math.max(current.maxAbsExposureUsd, Math.abs(exposure));
      current.observationCount += 1;
      exposures.set(eventKey, current);
    }
  }

  return [...exposures.values()].sort((left, right) =>
    right.maxAbsExposureUsd - left.maxAbsExposureUsd ||
    left.eventKey.localeCompare(right.eventKey),
  );
}

function parseHistoryLine(line: string): SanitizedHedgePlanRecord[] {
  try {
    return [sanitizeHedgePlans(JSON.parse(line) as unknown)];
  } catch {
    return [];
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_DRY_RUN_HISTORY_LIMIT;
  return Math.max(1, Math.min(1_000, Math.floor(limit)));
}

function numberEnv(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
