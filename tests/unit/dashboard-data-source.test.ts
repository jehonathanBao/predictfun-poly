import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadHedgePlansForDashboard } from "../../src/server/dashboard-data-source.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "dashboard-data-source-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("dashboard hedge plan data source", () => {
  it("prefers an explicit snapshot over the latest file", async () => {
    const snapshotPath = join(tempDir, "snapshot.json");
    const latestPath = join(tempDir, "latest.json");
    await writeJson(snapshotPath, record("snapshot", "snapshot-plan", true));
    await writeJson(latestPath, record("latest", "latest-plan", false));

    const envelope = await loadHedgePlansForDashboard({
      snapshotPath,
      latestPath,
      examplePath: join(tempDir, "missing-example.json"),
    });

    expect(envelope.dataSource).toBe("snapshot_env");
    expect(envelope.source).toBe("snapshot");
    expect(envelope.plans[0]?.marketId).toBe("snapshot-plan");
  });

  it("reads the latest dry-run file when no snapshot is configured", async () => {
    const latestPath = join(tempDir, "latest.json");
    await writeJson(latestPath, record("latest", "latest-plan", false));

    const envelope = await loadHedgePlansForDashboard({
      latestPath,
      examplePath: join(tempDir, "missing-example.json"),
    });

    expect(envelope.dataSource).toBe("latest_file");
    expect(envelope.summary).toMatchObject({
      totalPlans: 1,
      approvedCount: 0,
      rejectedCount: 1,
      maxAbsExposureUsd: 33,
    });
  });

  it("marks paper-live worker output as paper_live data source", async () => {
    const latestPath = join(tempDir, "paper-live.json");
    await writeJson(latestPath, {
      schemaVersion: 1,
      generatedAt: "2026-06-05T00:00:00.000Z",
      source: "paper_live_market_data",
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      plans: [],
      paperLive: {
        enabled: true,
        sourceType: "polymarket_token_id",
        sourceLabel: "token...1234",
        polymarketTokenIdMasked: "token...1234",
        maxSpread: 0.05,
        minDepthUsd: 1,
        maxMarketDataAgeMs: 10000,
      },
    });

    const envelope = await loadHedgePlansForDashboard({
      latestPath,
      examplePath: join(tempDir, "missing-example.json"),
    });

    expect(envelope.dataSource).toBe("paper_live");
    expect(envelope.paperLive).toMatchObject({
      enabled: true,
      sourceType: "polymarket_token_id",
      sourceLabel: "token...1234",
    });
  });


  it("falls back to an empty dry-run envelope when no files exist", async () => {
    const envelope = await loadHedgePlansForDashboard({
      latestPath: join(tempDir, "missing-latest.json"),
      examplePath: join(tempDir, "missing-example.json"),
    });

    expect(envelope).toMatchObject({
      dataSource: "empty_fallback",
      mode: "dry_run",
      liveTradingEnabled: false,
      plans: [],
      summary: {
        totalPlans: 0,
        approvedCount: 0,
        rejectedCount: 0,
        maxAbsExposureUsd: 0,
      },
    });
  });

  it("forces snapshot content back to read-only dry-run flags", async () => {
    const snapshotPath = join(tempDir, "snapshot.json");
    await writeJson(snapshotPath, record("snapshot", "malicious-plan", true));

    const envelope = await loadHedgePlansForDashboard({
      snapshotPath,
      latestPath: join(tempDir, "missing-latest.json"),
      examplePath: join(tempDir, "missing-example.json"),
    });

    expect(envelope.mode).toBe("dry_run");
    expect(envelope.liveTradingEnabled).toBe(false);
    expect(envelope.plans[0]).toMatchObject({
      executable: false,
      dryRun: true,
    });
  });
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function record(source: string, marketId: string, approved: boolean): unknown {
  return {
    schemaVersion: 1,
    generatedAt: "2026-06-05T00:00:00.000Z",
    source,
    mode: "dry_run",
    liveTradingEnabled: false,
    plans: [
      {
        predictMarketId: marketId,
        eventKey: "event-a",
        netExposureUsd: -33,
        executable: true,
        dryRun: false,
        risk: {
          approved,
          reasonCodes: approved ? [] : ["spread_too_wide"],
        },
        rejectReason: approved ? undefined : "spread_too_wide",
      },
    ],
  };
}
