import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDryRunReport,
  writeDailyDryRunReport,
  writeLatestDryRunReport,
} from "../../src/analytics/hedge-dry-run-report.js";
import type { HedgeDryRunReplaySummary } from "../../src/analytics/hedge-dry-run-replay.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "hedge-dry-run-report-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("hedge dry-run report", () => {
  it("builds dry-run report aggregate fields", () => {
    const report = buildDryRunReport(summary(), "2026-06-05");

    expect(report).toEqual({
      schemaVersion: 1,
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      reportDate: "2026-06-05",
      recordCount: 2,
      planCount: 3,
      approvedCount: 1,
      rejectedCount: 2,
      topRejectReasons: [
        { code: "no_matching_hedge_market", count: 2 },
        { code: "spread_too_wide", count: 1 },
      ],
      topRiskCodes: [
        { code: "depth_insufficient", count: 2 },
        { code: "spread_too_wide", count: 1 },
      ],
      maxAbsExposureUsd: 42,
      recommendations: [
        "Review high exposure events before considering live hedge gates",
        "Investigate same-event hedge market coverage",
        "Review spread and depth thresholds against observed market liquidity",
      ],
    });
  });

  it("writes latest and daily report files", async () => {
    const report = buildDryRunReport(summary(), "2026-06-05");
    const latestPath = join(tempDir, "hedge-dry-run-summary.latest.json");

    await writeLatestDryRunReport(report, latestPath);
    await writeDailyDryRunReport(report, tempDir);

    expect(JSON.parse(await readFile(latestPath, "utf8")) as unknown).toMatchObject({
      reportDate: "2026-06-05",
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
    });
    expect(
      JSON.parse(await readFile(join(tempDir, "hedge-dry-run-summary-2026-06-05.json"), "utf8")) as unknown,
    ).toMatchObject({
      reportDate: "2026-06-05",
    });
  });
});

function summary(): HedgeDryRunReplaySummary {
  return {
    schemaVersion: 1,
    mode: "dry_run",
    readOnly: true,
    liveTradingEnabled: false,
    generatedAt: "2026-06-05T00:00:00.000Z",
    recordCount: 2,
    planCount: 3,
    approvedCount: 1,
    rejectedCount: 2,
    maxAbsExposureUsd: 42,
    rejectReasonCounts: {
      no_matching_hedge_market: 2,
      spread_too_wide: 1,
    },
    riskCodeCounts: {
      depth_insufficient: 2,
      spread_too_wide: 1,
    },
    eventExposure: [],
    timeline: [],
  };
}
