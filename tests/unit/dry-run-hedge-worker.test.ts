import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDashboardStatus } from "../../src/server/dashboard-status.js";
import {
  buildEmptyDryRunHedgePayload,
  parseDryRunHedgeWorkerOptions,
  writeDryRunHedgeSnapshot,
} from "../../src/workers/dry-run-hedge-worker.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "dry-run-hedge-worker-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("dry-run hedge worker", () => {
  it("writes latest and history empty dry-run payloads", async () => {
    const latestPath = join(tempDir, "data", "hedge-plans.latest.json");
    const historyPath = join(tempDir, "data", "hedge-plans.history.jsonl");
    const now = new Date("2026-06-05T00:00:00.000Z");

    const written = await writeDryRunHedgeSnapshot({ latestPath, historyPath, now });
    const latest = JSON.parse(await readFile(latestPath, "utf8")) as Record<string, unknown>;
    const historyLines = (await readFile(historyPath, "utf8")).trim().split("\n");
    const history = JSON.parse(historyLines[0]!) as Record<string, unknown>;

    expect(written).toMatchObject({
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      source: "dry_run_worker",
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      plans: [],
      summary: {
        totalPlans: 0,
        approvedCount: 0,
        rejectedCount: 0,
        maxAbsExposureUsd: 0,
      },
    });
    expect(latest).toEqual(written);
    expect(history).toMatchObject({
      source: "dry_run_worker",
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      plans: [],
      summary: { totalPlans: 0 },
    });
    expect((latest.plans as Record<string, unknown>[]).every((plan) => plan.executable === false)).toBe(true);
    expect((latest.plans as Record<string, unknown>[]).every((plan) => plan.dryRun === true)).toBe(true);
  });

  it("makes dashboard status fresh via latest_file without configured wallets", async () => {
    const latestPath = join(tempDir, "hedge-plans.latest.json");
    const historyPath = join(tempDir, "hedge-plans.history.jsonl");
    const generatedAt = new Date("2026-06-05T00:00:00.000Z");

    await writeDryRunHedgeSnapshot({ latestPath, historyPath, now: generatedAt });
    const status = await loadDashboardStatus({
      latestPath,
      examplePath: join(tempDir, "missing-example.json"),
      nowMs: generatedAt.getTime() + 500,
      staleThresholdMs: 10_000,
    });

    expect(status).toMatchObject({
      apiStatus: "ok",
      botStatus: "fresh",
      dataSource: "latest_file",
      lastUpdated: generatedAt.toISOString(),
      readOnly: true,
      liveTradingEnabled: false,
      planCount: 0,
    });
  });

  it("parses safe once and interval options", () => {
    const options = parseDryRunHedgeWorkerOptions(
      ["--once", "--interval-ms", "2500", "--latest-path", "tmp/latest.json", "--history-path=tmp/history.jsonl"],
      {},
    );

    expect(options).toEqual({
      intervalMs: 2500,
      once: true,
      latestPath: "tmp/latest.json",
      historyPath: "tmp/history.jsonl",
    });
  });

  it("does not include execution or wallet signing calls", async () => {
    const source = await readFile("src/workers/dry-run-hedge-worker.ts", "utf8");

    expect(source).not.toContain("placeOrder");
    expect(source).not.toContain("sendTransaction");
    expect(source).not.toContain("writeContract");
    expect(source).not.toContain("signMessage");
    expect(source).not.toContain("signTypedData");
    expect(source).not.toContain("OPEN_HEDGE_ORDER");
  });

  it("builds only read-only dry-run payloads", () => {
    expect(buildEmptyDryRunHedgePayload(new Date("2026-06-05T00:00:00.000Z"))).toEqual({
      schemaVersion: 1,
      generatedAt: "2026-06-05T00:00:00.000Z",
      source: "dry_run_worker",
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      plans: [],
    });
  });
});
