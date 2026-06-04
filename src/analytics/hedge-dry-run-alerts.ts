import {
  loadHedgeDryRunSummary,
  type HedgeDryRunReplayOptions,
  type HedgeDryRunReplaySummary,
} from "./hedge-dry-run-replay.js";

export type DryRunAlertSeverity = "info" | "warning" | "critical";

export interface DryRunAlert {
  code: string;
  severity: DryRunAlertSeverity;
  message: string;
  value?: number;
  threshold?: number;
  count?: number;
}

export interface DryRunAlertConfig {
  maxExposureAlertUsd: number;
  rejectReasonSpikeThreshold: number;
  riskCodeSpikeThreshold: number;
  staleDataThresholdMs: number;
}

export interface DryRunAlertsResponse {
  schemaVersion: 1;
  mode: "dry_run";
  readOnly: true;
  liveTradingEnabled: false;
  generatedAt: string;
  severity: DryRunAlertSeverity;
  alerts: DryRunAlert[];
}

export interface DryRunAlertOptions extends HedgeDryRunReplayOptions {
  config?: Partial<DryRunAlertConfig>;
}

export const DEFAULT_DRY_RUN_ALERT_CONFIG: DryRunAlertConfig = {
  maxExposureAlertUsd: 25,
  rejectReasonSpikeThreshold: 10,
  riskCodeSpikeThreshold: 10,
  staleDataThresholdMs: 10_000,
};

export async function loadDryRunAlerts(
  options: DryRunAlertOptions = {},
): Promise<DryRunAlertsResponse> {
  const summary = await loadHedgeDryRunSummary(options);
  return buildDryRunAlerts(summary, mergeConfig(configFromEnv(process.env), options.config));
}

export function buildDryRunAlerts(
  summary: HedgeDryRunReplaySummary,
  config: Partial<DryRunAlertConfig> = {},
): DryRunAlertsResponse {
  const resolved = mergeConfig(DEFAULT_DRY_RUN_ALERT_CONFIG, config);
  const alerts = [
    detectMaxExposureAlert(summary, resolved),
    detectStaleDataAlert(summary, resolved),
    ...detectRejectReasonSpike(summary, resolved),
    ...detectRiskCodeSpike(summary, resolved),
  ].filter((alert): alert is DryRunAlert => alert !== undefined);

  return {
    schemaVersion: 1,
    mode: "dry_run",
    readOnly: true,
    liveTradingEnabled: false,
    generatedAt: summary.generatedAt,
    severity: topSeverity(alerts),
    alerts,
  };
}

export function detectMaxExposureAlert(
  summary: HedgeDryRunReplaySummary,
  config: DryRunAlertConfig,
): DryRunAlert | undefined {
  if (summary.maxAbsExposureUsd <= config.maxExposureAlertUsd) return undefined;
  return {
    code: "max_exposure_high",
    severity: "warning",
    message: "Max dry-run exposure is above threshold",
    value: summary.maxAbsExposureUsd,
    threshold: config.maxExposureAlertUsd,
  };
}

export function detectStaleDataAlert(
  summary: HedgeDryRunReplaySummary,
  config: DryRunAlertConfig,
): DryRunAlert | undefined {
  const latest = summary.timeline.at(-1);
  if (!latest) {
    return {
      code: "dry_run_history_empty",
      severity: "info",
      message: "No dry-run history records are available",
      count: 0,
    };
  }

  const generatedMs = Date.parse(latest.generatedAt);
  const nowMs = Date.parse(summary.generatedAt);
  if (!Number.isFinite(generatedMs) || !Number.isFinite(nowMs)) return undefined;
  const ageMs = Math.max(0, nowMs - generatedMs);
  if (ageMs <= config.staleDataThresholdMs) return undefined;
  return {
    code: "stale_data",
    severity: "warning",
    message: "Latest dry-run history record is stale",
    value: ageMs,
    threshold: config.staleDataThresholdMs,
  };
}

export function detectRejectReasonSpike(
  summary: HedgeDryRunReplaySummary,
  config: DryRunAlertConfig,
): DryRunAlert[] {
  return Object.entries(summary.rejectReasonCounts)
    .filter(([, count]) => count >= config.rejectReasonSpikeThreshold)
    .map(([reason, count]) => ({
      code: rejectReasonAlertCode(reason),
      severity: "warning" as const,
      message: `Reject reason count is above threshold: ${reason}`,
      count,
      threshold: config.rejectReasonSpikeThreshold,
    }));
}

export function detectRiskCodeSpike(
  summary: HedgeDryRunReplaySummary,
  config: DryRunAlertConfig,
): DryRunAlert[] {
  return Object.entries(summary.riskCodeCounts)
    .filter(([, count]) => count >= config.riskCodeSpikeThreshold)
    .map(([code, count]) => ({
      code: riskCodeAlertCode(code),
      severity: "warning" as const,
      message: `Risk code count is above threshold: ${code}`,
      count,
      threshold: config.riskCodeSpikeThreshold,
    }));
}

function rejectReasonAlertCode(reason: string): string {
  if (reason === "no_matching_hedge_market") return "no_matching_hedge_market_spike";
  if (reason.includes("spread")) return "spread_reject_spike";
  if (reason.includes("depth")) return "depth_reject_spike";
  return `${reason}_spike`;
}

function riskCodeAlertCode(code: string): string {
  if (code.includes("spread")) return "spread_risk_code_spike";
  if (code.includes("depth")) return "depth_risk_code_spike";
  return `${code}_risk_code_spike`;
}

function topSeverity(alerts: readonly DryRunAlert[]): DryRunAlertSeverity {
  if (alerts.some((alert) => alert.severity === "critical")) return "critical";
  if (alerts.some((alert) => alert.severity === "warning")) return "warning";
  return "info";
}

function configFromEnv(env: NodeJS.ProcessEnv): Partial<DryRunAlertConfig> {
  return definedConfig({
    maxExposureAlertUsd: numberEnv(env.DASHBOARD_MAX_EXPOSURE_ALERT_USD),
    rejectReasonSpikeThreshold: numberEnv(env.DASHBOARD_REJECT_REASON_SPIKE_THRESHOLD),
    riskCodeSpikeThreshold: numberEnv(env.DASHBOARD_RISK_CODE_SPIKE_THRESHOLD),
    staleDataThresholdMs: numberEnv(env.DASHBOARD_STALE_DATA_THRESHOLD_MS),
  });
}

function mergeConfig(
  ...configs: (Partial<DryRunAlertConfig> | undefined)[]
): DryRunAlertConfig {
  return configs.reduce<DryRunAlertConfig>(
    (merged, config) => ({ ...merged, ...definedConfig(config ?? {}) }),
    DEFAULT_DRY_RUN_ALERT_CONFIG,
  );
}

function definedConfig(config: Partial<DryRunAlertConfig>): Partial<DryRunAlertConfig> {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined),
  ) as Partial<DryRunAlertConfig>;
}

function numberEnv(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
