import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  aggregateEventExposure,
  buildExposureTimeline,
  buildHedgeDryRunSummary,
  countRejectReasons,
  countRiskCodes,
  readHedgeDryRunHistory,
} from "../../src/analytics/hedge-dry-run-replay.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "hedge-dry-run-replay-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("hedge dry-run replay analytics", () => {
  it("returns an empty summary for missing history", async () => {
    const records = await readHedgeDryRunHistory({
      historyPath: join(tempDir, "missing.jsonl"),
    });
    const summary = buildHedgeDryRunSummary(records, Date.parse("2026-06-05T00:00:00.000Z"));

    expect(summary).toMatchObject({
      schemaVersion: 1,
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      recordCount: 0,
      planCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      maxAbsExposureUsd: 0,
      rejectReasonCounts: {},
      riskCodeCounts: {},
      eventExposure: [],
      timeline: [],
    });
  });

  it("skips malformed JSONL rows without throwing", async () => {
    const historyPath = join(tempDir, "history.jsonl");
    await writeFile(
      historyPath,
      `${JSON.stringify(record("2026-06-05T00:00:00.000Z", [plan("event-a", 12, true)]))}\nnot-json\n`,
      "utf8",
    );

    const records = await readHedgeDryRunHistory({ historyPath });

    expect(records).toHaveLength(1);
    expect(records[0]?.plans).toHaveLength(1);
  });

  it("counts reject reasons, risk codes, timeline, and event exposure", async () => {
    const records = [
      record("2026-06-05T00:00:00.000Z", [
        plan("event-a", 12, true),
        plan("event-b", -20, false, "no_matching_hedge_market", ["no_matching_hedge_market"]),
      ]),
      record("2026-06-05T00:01:00.000Z", [
        plan("event-a", 42, false, "spread_too_wide", ["spread_too_wide", "depth_insufficient"]),
        plan("event-b", -10, false, "no_matching_hedge_market", ["no_matching_hedge_market"]),
      ]),
    ];

    const summary = buildHedgeDryRunSummary(records, Date.parse("2026-06-05T00:02:00.000Z"));

    expect(summary.recordCount).toBe(2);
    expect(summary.planCount).toBe(4);
    expect(summary.approvedCount).toBe(1);
    expect(summary.rejectedCount).toBe(3);
    expect(summary.maxAbsExposureUsd).toBe(42);
    expect(summary.rejectReasonCounts).toEqual({
      no_matching_hedge_market: 2,
      spread_too_wide: 1,
    });
    expect(summary.riskCodeCounts).toEqual({
      no_matching_hedge_market: 2,
      spread_too_wide: 1,
      depth_insufficient: 1,
    });
    expect(summary.timeline).toEqual([
      {
        generatedAt: "2026-06-05T00:00:00.000Z",
        planCount: 2,
        approvedCount: 1,
        rejectedCount: 1,
        maxAbsExposureUsd: 20,
      },
      {
        generatedAt: "2026-06-05T00:01:00.000Z",
        planCount: 2,
        approvedCount: 0,
        rejectedCount: 2,
        maxAbsExposureUsd: 42,
      },
    ]);
    expect(summary.eventExposure).toEqual([
      {
        eventKey: "event-a",
        latestNetExposureUsd: 42,
        maxAbsExposureUsd: 42,
        observationCount: 2,
      },
      {
        eventKey: "event-b",
        latestNetExposureUsd: -10,
        maxAbsExposureUsd: 20,
        observationCount: 2,
      },
    ]);
  });

  it("applies the recent record limit", async () => {
    const historyPath = join(tempDir, "history.jsonl");
    await writeFile(
      historyPath,
      [
        record("2026-06-05T00:00:00.000Z", [plan("event-a", 1, true)]),
        record("2026-06-05T00:01:00.000Z", [plan("event-a", 2, true)]),
        record("2026-06-05T00:02:00.000Z", [plan("event-a", 3, true)]),
      ].map((item) => JSON.stringify(item)).join("\n"),
      "utf8",
    );

    const records = await readHedgeDryRunHistory({ historyPath, limit: 2 });

    expect(records.map((item) => item.generatedAt)).toEqual([
      "2026-06-05T00:01:00.000Z",
      "2026-06-05T00:02:00.000Z",
    ]);
  });

  it("exports focused helpers for distributions and trends", () => {
    const records = [
      record("2026-06-05T00:00:00.000Z", [
        plan("event-a", 12, false, "stale_market_data", ["stale_market_data"]),
      ]),
    ];

    expect(countRejectReasons(records[0]!.plans)).toEqual({ stale_market_data: 1 });
    expect(countRiskCodes(records[0]!.plans)).toEqual({ stale_market_data: 1 });
    expect(buildExposureTimeline(records)[0]?.maxAbsExposureUsd).toBe(12);
    expect(aggregateEventExposure(records)[0]).toMatchObject({
      eventKey: "event-a",
      latestNetExposureUsd: 12,
      maxAbsExposureUsd: 12,
      observationCount: 1,
    });
  });
});

function record(generatedAt: string, plans: Record<string, unknown>[]) {
  return {
    schemaVersion: 1 as const,
    generatedAt,
    source: "unit_test",
    mode: "dry_run" as const,
    liveTradingEnabled: false as const,
    plans,
  };
}

function plan(
  eventKey: string,
  netExposureUsd: number,
  approved: boolean,
  rejectReason?: string,
  riskCodes: string[] = [],
): Record<string, unknown> {
  return {
    strategy: "EXPOSURE_HEDGE",
    predictMarketId: `predict-${eventKey}`,
    eventKey,
    netExposureUsd,
    hedgeSizeUsd: approved ? Math.abs(netExposureUsd) / 2 : 0,
    executable: true,
    dryRun: false,
    riskApproved: approved,
    riskCodes,
    rejectReason,
  };
}
