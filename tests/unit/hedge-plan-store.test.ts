import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendHedgePlanHistory,
  readLatestHedgePlans,
  sanitizeHedgePlans,
  summarizeHedgePlans,
  writeLatestHedgePlans,
  type StoredHedgePlanRecord,
} from "../../src/storage/hedge-plan-store.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "hedge-plan-store-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("hedge plan store", () => {
  it("writes and reads the latest dry-run plan record", async () => {
    const filePath = join(tempDir, "hedge-plans.latest.json");
    const written = await writeLatestHedgePlans(maliciousRecord(), filePath);
    const readBack = await readLatestHedgePlans(filePath);

    expect(written.mode).toBe("dry_run");
    expect(written.liveTradingEnabled).toBe(false);
    expect(written.plans[0]).toMatchObject({
      marketId: "predict-1",
      riskCodes: ["forced_live_attempt"],
      riskApproved: false,
      executable: false,
      dryRun: true,
    });
    expect(readBack).toEqual(written);
  });

  it("appends sanitized history as jsonl", async () => {
    const filePath = join(tempDir, "hedge-plans.history.jsonl");

    await appendHedgePlanHistory(maliciousRecord("first"), filePath);
    await appendHedgePlanHistory(maliciousRecord("second"), filePath);

    const lines = (await readFile(filePath, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!) as unknown).toMatchObject({
      source: "first",
      mode: "dry_run",
      liveTradingEnabled: false,
      plans: [{ executable: false, dryRun: true }],
    });
    expect(JSON.parse(lines[1]!) as unknown).toMatchObject({ source: "second" });
  });

  it("sanitizes legacy plan arrays for the dashboard", () => {
    const sanitized = sanitizeHedgePlans([
      {
        predictMarketId: "predict-array",
        eventKey: "event-a",
        netExposureUsd: 12,
        executable: true,
        dryRun: false,
        risk: { approved: true, reasonCodes: [] },
      },
    ]);

    expect(sanitized.plans[0]).toMatchObject({
      marketId: "predict-array",
      executable: false,
      dryRun: true,
      riskApproved: true,
      riskCodes: [],
    });
  });

  it("summarizes approved, rejected, and max exposure counts", () => {
    const summary = summarizeHedgePlans([
      { netExposureUsd: 11, riskApproved: true },
      { netExposureUsd: -24, rejectReason: "spread_too_wide" },
    ]);

    expect(summary).toEqual({
      totalPlans: 2,
      approvedCount: 1,
      rejectedCount: 1,
      maxAbsExposureUsd: 24,
    });
  });
});

function maliciousRecord(source = "unit_test"): StoredHedgePlanRecord {
  return {
    schemaVersion: 1,
    generatedAt: "2026-06-05T00:00:00.000Z",
    source,
    mode: "dry_run",
    liveTradingEnabled: false,
    plans: [
      {
        strategy: "EXPOSURE_HEDGE",
        predictMarketId: "predict-1",
        eventKey: "event-a",
        netExposureUsd: 10,
        executable: true,
        dryRun: false,
        risk: {
          approved: false,
          reasonCodes: ["forced_live_attempt"],
          rejectReason: "forced_live_attempt",
        },
      },
    ],
  };
}
