import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDashboardStatus,
  dashboardStaleThresholdFromEnv,
  loadDashboardStatus,
} from "../../src/server/dashboard-status.js";
import type { DashboardHedgePlanEnvelope } from "../../src/storage/hedge-plan-store.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "dashboard-status-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("dashboard runtime status", () => {
  it("reports fresh data within the stale threshold", async () => {
    const latestPath = join(tempDir, "latest.json");
    const generatedAt = "2026-06-05T00:00:00.000Z";
    await writeJson(latestPath, record(generatedAt));

    const status = await loadDashboardStatus({
      latestPath,
      examplePath: join(tempDir, "missing-example.json"),
      nowMs: Date.parse(generatedAt) + 1_200,
      staleThresholdMs: 10_000,
    });

    expect(status).toMatchObject({
      apiStatus: "ok",
      botStatus: "fresh",
      readOnly: true,
      liveTradingEnabled: false,
      dataSource: "latest_file",
      lastUpdated: generatedAt,
      dataAgeMs: 1200,
      staleThresholdMs: 10000,
      planCount: 1,
      approvedCount: 1,
      rejectedCount: 0,
      maxAbsExposureUsd: 42,
    });
  });

  it("reports stale data beyond the stale threshold", async () => {
    const latestPath = join(tempDir, "latest.json");
    const generatedAt = "2026-06-05T00:00:00.000Z";
    await writeJson(latestPath, record(generatedAt));

    const status = await loadDashboardStatus({
      latestPath,
      examplePath: join(tempDir, "missing-example.json"),
      nowMs: Date.parse(generatedAt) + 15_000,
      staleThresholdMs: 10_000,
    });

    expect(status.botStatus).toBe("stale");
    expect(status.dataAgeMs).toBe(15000);
  });

  it("reports no_data without latest or snapshot data", async () => {
    const status = await loadDashboardStatus({
      latestPath: join(tempDir, "missing-latest.json"),
      examplePath: join(tempDir, "missing-example.json"),
      nowMs: Date.parse("2026-06-05T00:00:00.000Z"),
    });

    expect(status).toMatchObject({
      botStatus: "no_data",
      dataSource: "empty_fallback",
      lastUpdated: null,
      dataAgeMs: null,
      readOnly: true,
      liveTradingEnabled: false,
    });
  });

  it("treats example snapshots as no live bot data", () => {
    const status = buildDashboardStatus(
      envelope("example_snapshot", "2026-06-05T00:00:00.000Z"),
      {
        nowMs: Date.parse("2026-06-05T00:00:01.000Z"),
        staleThresholdMs: 10_000,
      },
    );

    expect(status.botStatus).toBe("no_data");
    expect(status.lastUpdated).toBeNull();
    expect(status.dataAgeMs).toBeNull();
  });

  it("loads stale threshold from env with a safe fallback", () => {
    expect(dashboardStaleThresholdFromEnv({ DASHBOARD_STALE_DATA_THRESHOLD_MS: "2500" })).toBe(2500);
    expect(dashboardStaleThresholdFromEnv({ DASHBOARD_STALE_DATA_THRESHOLD_MS: "bad" })).toBe(10000);
  });
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function record(generatedAt: string): unknown {
  return {
    schemaVersion: 1,
    generatedAt,
    source: "unit_test",
    mode: "dry_run",
    liveTradingEnabled: false,
    plans: [
      {
        predictMarketId: "predict-status",
        eventKey: "event-status",
        netExposureUsd: 42,
        executable: true,
        dryRun: false,
        risk: { approved: true, reasonCodes: [] },
      },
    ],
  };
}

function envelope(
  dataSource: DashboardHedgePlanEnvelope["dataSource"],
  generatedAt: string,
): DashboardHedgePlanEnvelope {
  return {
    schemaVersion: 1,
    generatedAt,
    source: "unit_test",
    mode: "dry_run",
    readOnly: true,
    liveTradingEnabled: false,
    dataSource,
    plans: [],
    summary: {
      totalPlans: 0,
      approvedCount: 0,
      rejectedCount: 0,
      maxAbsExposureUsd: 0,
    },
  };
}
