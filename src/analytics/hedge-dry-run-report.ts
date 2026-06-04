import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  loadHedgeDryRunSummary,
  type HedgeDryRunReplayOptions,
  type HedgeDryRunReplaySummary,
} from "./hedge-dry-run-replay.js";

export interface DryRunReport {
  schemaVersion: 1;
  mode: "dry_run";
  readOnly: true;
  liveTradingEnabled: false;
  reportDate: string;
  recordCount: number;
  planCount: number;
  approvedCount: number;
  rejectedCount: number;
  topRejectReasons: { code: string; count: number }[];
  topRiskCodes: { code: string; count: number }[];
  maxAbsExposureUsd: number;
  recommendations: string[];
}

export interface DryRunReportOptions extends HedgeDryRunReplayOptions {
  reportDate?: string;
  reportsDir?: string;
}

export const DEFAULT_REPORTS_DIR = "reports";
export const DEFAULT_LATEST_DRY_RUN_REPORT_PATH = "reports/hedge-dry-run-summary.latest.json";

export async function loadDryRunReport(
  options: DryRunReportOptions = {},
): Promise<DryRunReport> {
  const summary = await loadHedgeDryRunSummary(options);
  return buildDryRunReport(summary, options.reportDate);
}

export function buildDryRunReport(
  summary: HedgeDryRunReplaySummary,
  reportDate = summary.generatedAt.slice(0, 10),
): DryRunReport {
  return {
    schemaVersion: 1,
    mode: "dry_run",
    readOnly: true,
    liveTradingEnabled: false,
    reportDate,
    recordCount: summary.recordCount,
    planCount: summary.planCount,
    approvedCount: summary.approvedCount,
    rejectedCount: summary.rejectedCount,
    topRejectReasons: topCounts(summary.rejectReasonCounts),
    topRiskCodes: topCounts(summary.riskCodeCounts),
    maxAbsExposureUsd: summary.maxAbsExposureUsd,
    recommendations: recommendations(summary),
  };
}

export async function writeLatestDryRunReport(
  report: DryRunReport,
  filePath = DEFAULT_LATEST_DRY_RUN_REPORT_PATH,
): Promise<DryRunReport> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

export async function writeDailyDryRunReport(
  report: DryRunReport,
  reportsDir = DEFAULT_REPORTS_DIR,
): Promise<DryRunReport> {
  const filePath = join(reportsDir, `hedge-dry-run-summary-${report.reportDate}.json`);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function topCounts(values: Record<string, number>): { code: string; count: number }[] {
  return Object.entries(values)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([code, count]) => ({ code, count }));
}

function recommendations(summary: HedgeDryRunReplaySummary): string[] {
  const output: string[] = [];
  if (summary.recordCount === 0) output.push("Collect dry-run history before evaluating live hedge readiness");
  if (summary.maxAbsExposureUsd > 25) output.push("Review high exposure events before considering live hedge gates");
  if ((summary.rejectReasonCounts.no_matching_hedge_market ?? 0) > 0) {
    output.push("Investigate same-event hedge market coverage");
  }
  if (Object.keys(summary.riskCodeCounts).some((code) => code.includes("spread") || code.includes("depth"))) {
    output.push("Review spread and depth thresholds against observed market liquidity");
  }
  return output;
}
