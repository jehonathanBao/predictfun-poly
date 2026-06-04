import { describe, expect, it } from "vitest";
import {
  buildDryRunAlerts,
  detectMaxExposureAlert,
  detectRejectReasonSpike,
  detectRiskCodeSpike,
  detectStaleDataAlert,
  type DryRunAlertConfig,
} from "../../src/analytics/hedge-dry-run-alerts.js";
import type { HedgeDryRunReplaySummary } from "../../src/analytics/hedge-dry-run-replay.js";

const config: DryRunAlertConfig = {
  maxExposureAlertUsd: 25,
  rejectReasonSpikeThreshold: 2,
  riskCodeSpikeThreshold: 2,
  staleDataThresholdMs: 10_000,
};

describe("hedge dry-run alerts", () => {
  it("generates max exposure alert above threshold", () => {
    const alert = detectMaxExposureAlert(summary({ maxAbsExposureUsd: 42 }), config);

    expect(alert).toMatchObject({
      code: "max_exposure_high",
      severity: "warning",
      value: 42,
      threshold: 25,
    });
  });

  it("generates stale data alert when latest timeline point is old", () => {
    const alert = detectStaleDataAlert(
      summary({
        generatedAt: "2026-06-05T00:01:00.000Z",
        timeline: [
          {
            generatedAt: "2026-06-05T00:00:00.000Z",
            planCount: 1,
            approvedCount: 1,
            rejectedCount: 0,
            maxAbsExposureUsd: 1,
          },
        ],
      }),
      config,
    );

    expect(alert).toMatchObject({
      code: "stale_data",
      severity: "warning",
      value: 60000,
      threshold: 10000,
    });
  });

  it("does not generate stale alert when data is fresh and config is partial", () => {
    const alerts = buildDryRunAlerts(
      summary({
        generatedAt: "2026-06-05T00:00:10.000Z",
        timeline: [
          {
            generatedAt: "2026-06-05T00:00:09.000Z",
            planCount: 1,
            approvedCount: 1,
            rejectedCount: 0,
            maxAbsExposureUsd: 1,
          },
        ],
      }),
      { maxExposureAlertUsd: 25 },
    );

    expect(alerts.alerts.find((alert) => alert.code === "stale_data")).toBeUndefined();
  });

  it("generates reject reason spike alerts", () => {
    const alerts = detectRejectReasonSpike(
      summary({
        rejectReasonCounts: {
          no_matching_hedge_market: 3,
          spread_too_wide: 2,
        },
      }),
      config,
    );

    expect(alerts.map((alert) => alert.code)).toEqual([
      "no_matching_hedge_market_spike",
      "spread_reject_spike",
    ]);
  });

  it("generates risk code spike alerts", () => {
    const alerts = detectRiskCodeSpike(
      summary({
        riskCodeCounts: {
          depth_insufficient: 2,
          stale_market_data: 1,
        },
      }),
      config,
    );

    expect(alerts).toEqual([
      {
        code: "depth_risk_code_spike",
        severity: "warning",
        message: "Risk code count is above threshold: depth_insufficient",
        count: 2,
        threshold: 2,
      },
    ]);
  });

  it("handles empty history without crashing", () => {
    const alerts = buildDryRunAlerts(summary({ recordCount: 0, timeline: [] }), config);

    expect(alerts).toMatchObject({
      schemaVersion: 1,
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      severity: "info",
      alerts: [
        {
          code: "dry_run_history_empty",
          severity: "info",
        },
      ],
    });
  });
});

function summary(overrides: Partial<HedgeDryRunReplaySummary> = {}): HedgeDryRunReplaySummary {
  return {
    schemaVersion: 1,
    mode: "dry_run",
    readOnly: true,
    liveTradingEnabled: false,
    generatedAt: "2026-06-05T00:00:10.000Z",
    recordCount: 1,
    planCount: 1,
    approvedCount: 1,
    rejectedCount: 0,
    maxAbsExposureUsd: 1,
    rejectReasonCounts: {},
    riskCodeCounts: {},
    eventExposure: [],
    timeline: [
      {
        generatedAt: "2026-06-05T00:00:09.000Z",
        planCount: 1,
        approvedCount: 1,
        rejectedCount: 0,
        maxAbsExposureUsd: 1,
      },
    ],
    ...overrides,
  };
}
