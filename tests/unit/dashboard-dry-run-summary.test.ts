import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDashboardServer } from "../../src/server/hedge-dashboard.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "dashboard-dry-run-summary-"));
});

afterEach(async () => {
  delete process.env.DASHBOARD_HISTORY_PATH;
  delete process.env.POLYMARKET_PRIVATE_KEY;
  delete process.env.POLY_API_SECRET;
  delete process.env.POLY_API_KEY;
  delete process.env.POLY_PASSPHRASE;
  delete process.env.PREDICT_API_KEY;
  await rm(tempDir, { recursive: true, force: true });
});

describe("dashboard dry-run summary API", () => {
  it("serves dry-run summary with read-only execution flags", async () => {
    const historyPath = join(tempDir, "history.jsonl");
    await writeFile(
      historyPath,
      [
        record("2026-06-05T00:00:00.000Z", [
          plan("event-a", 12, true),
          plan("event-b", -18, false, "no_matching_hedge_market", ["no_matching_hedge_market"]),
        ]),
        record("2026-06-05T00:01:00.000Z", [
          plan("event-a", 42, false, "spread_too_wide", ["spread_too_wide"]),
        ]),
      ].map((item) => JSON.stringify(item)).join("\n"),
      "utf8",
    );
    process.env.DASHBOARD_HISTORY_PATH = historyPath;
    process.env.POLYMARKET_PRIVATE_KEY = "private-key-value";
    process.env.POLY_API_SECRET = "api-secret-value";
    process.env.POLY_API_KEY = "api-key-value";
    process.env.POLY_PASSPHRASE = "passphrase-value";
    process.env.PREDICT_API_KEY = "predict-key-value";

    const server = createDashboardServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind to a TCP port");

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/dry-run-summary?limit=1`);
      const body = (await response.json()) as Record<string, unknown>;
      const serialized = JSON.stringify(body);

      expect(response.status).toBe(200);
      expect(body.mode).toBe("dry_run");
      expect(body.readOnly).toBe(true);
      expect(body.liveTradingEnabled).toBe(false);
      expect(body.recordCount).toBe(1);
      expect(body.planCount).toBe(1);
      expect(body.rejectedCount).toBe(1);
      expect(body.maxAbsExposureUsd).toBe(42);
      expect(body.rejectReasonCounts).toEqual({ spread_too_wide: 1 });
      expect(body.riskCodeCounts).toEqual({ spread_too_wide: 1 });
      expect(serialized).not.toContain("private-key-value");
      expect(serialized).not.toContain("api-secret-value");
      expect(serialized).not.toContain("api-key-value");
      expect(serialized).not.toContain("passphrase-value");
      expect(serialized).not.toContain("predict-key-value");
      expect(serialized).not.toContain("mnemonic");
      expect(serialized).not.toContain("rawSigner");
      expect(serialized).not.toContain("rawToken");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("does not crash on missing history", async () => {
    process.env.DASHBOARD_HISTORY_PATH = join(tempDir, "missing.jsonl");

    const server = createDashboardServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind to a TCP port");

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/dry-run-summary`);
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body.recordCount).toBe(0);
      expect(body.planCount).toBe(0);
      expect(body.readOnly).toBe(true);
      expect(body.liveTradingEnabled).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

function record(generatedAt: string, plans: unknown[]) {
  return {
    schemaVersion: 1,
    generatedAt,
    source: "api_test",
    mode: "dry_run",
    liveTradingEnabled: false,
    plans,
  };
}

function plan(
  eventKey: string,
  netExposureUsd: number,
  approved: boolean,
  rejectReason?: string,
  riskCodes: string[] = [],
) {
  return {
    strategy: "EXPOSURE_HEDGE",
    predictMarketId: `predict-${eventKey}`,
    eventKey,
    netExposureUsd,
    executable: true,
    dryRun: false,
    riskApproved: approved,
    riskCodes,
    rejectReason,
  };
}
