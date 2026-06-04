import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDashboardServer } from "../../src/server/hedge-dashboard.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "dashboard-alerts-"));
});

afterEach(async () => {
  delete process.env.DASHBOARD_HISTORY_PATH;
  delete process.env.DASHBOARD_REPORTS_DIR;
  delete process.env.DASHBOARD_MAX_EXPOSURE_ALERT_USD;
  delete process.env.DASHBOARD_REJECT_REASON_SPIKE_THRESHOLD;
  delete process.env.DASHBOARD_RISK_CODE_SPIKE_THRESHOLD;
  delete process.env.POLYMARKET_PRIVATE_KEY;
  delete process.env.POLY_API_SECRET;
  delete process.env.POLY_API_KEY;
  delete process.env.POLY_PASSPHRASE;
  delete process.env.PREDICT_API_KEY;
  await rm(tempDir, { recursive: true, force: true });
});

describe("dashboard dry-run alerts and report APIs", () => {
  it("serves dry-run alerts without secret material", async () => {
    const historyPath = join(tempDir, "history.jsonl");
    await writeFile(historyPath, `${JSON.stringify(record())}\nnot-json\n`, "utf8");
    process.env.DASHBOARD_HISTORY_PATH = historyPath;
    process.env.DASHBOARD_MAX_EXPOSURE_ALERT_USD = "25";
    process.env.DASHBOARD_REJECT_REASON_SPIKE_THRESHOLD = "1";
    process.env.DASHBOARD_RISK_CODE_SPIKE_THRESHOLD = "1";
    process.env.POLYMARKET_PRIVATE_KEY = "private-key-value";
    process.env.POLY_API_SECRET = "api-secret-value";
    process.env.POLY_API_KEY = "api-key-value";
    process.env.POLY_PASSPHRASE = "passphrase-value";
    process.env.PREDICT_API_KEY = "predict-key-value";

    const { body, status } = await fetchJson("/api/dry-run-alerts");
    const serialized = JSON.stringify(body);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      severity: "warning",
    });
    expect(serialized).toContain("max_exposure_high");
    expect(serialized).toContain("no_matching_hedge_market_spike");
    expect(serialized).toContain("depth_risk_code_spike");
    expect(serialized).not.toContain("private-key-value");
    expect(serialized).not.toContain("api-secret-value");
    expect(serialized).not.toContain("api-key-value");
    expect(serialized).not.toContain("passphrase-value");
    expect(serialized).not.toContain("predict-key-value");
    expect(serialized).not.toContain("mnemonic");
    expect(serialized).not.toContain("rawSigner");
  });

  it("serves dry-run report and writes ignored report files", async () => {
    const historyPath = join(tempDir, "history.jsonl");
    const reportsDir = join(tempDir, "reports");
    await writeFile(historyPath, `${JSON.stringify(record())}\n`, "utf8");
    process.env.DASHBOARD_HISTORY_PATH = historyPath;
    process.env.DASHBOARD_REPORTS_DIR = reportsDir;
    process.env.POLYMARKET_PRIVATE_KEY = "private-key-value";
    process.env.POLY_API_SECRET = "api-secret-value";
    process.env.PREDICT_API_KEY = "predict-key-value";

    const { body, status } = await fetchJson("/api/dry-run-report");
    const serialized = JSON.stringify(body);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      recordCount: 1,
      planCount: 2,
      rejectedCount: 1,
      maxAbsExposureUsd: 42,
    });
    expect(serialized).not.toContain("private-key-value");
    expect(serialized).not.toContain("api-secret-value");
    expect(serialized).not.toContain("predict-key-value");
    expect(JSON.parse(await readFile(join(reportsDir, "hedge-dry-run-summary.latest.json"), "utf8")) as unknown).toMatchObject({
      mode: "dry_run",
      readOnly: true,
    });
  });
});

async function fetchJson(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const server = createDashboardServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind to a TCP port");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function record() {
  return {
    schemaVersion: 1,
    generatedAt: "2026-06-05T00:00:00.000Z",
    source: "alerts_test",
    mode: "dry_run",
    liveTradingEnabled: false,
    plans: [
      {
        strategy: "EXPOSURE_HEDGE",
        predictMarketId: "predict-a",
        eventKey: "event-a",
        netExposureUsd: 42,
        executable: true,
        dryRun: false,
        riskApproved: true,
        riskCodes: [],
      },
      {
        strategy: "EXPOSURE_HEDGE",
        predictMarketId: "predict-b",
        eventKey: "event-b",
        netExposureUsd: -10,
        executable: true,
        dryRun: false,
        riskApproved: false,
        rejectReason: "no_matching_hedge_market",
        riskCodes: ["depth_insufficient"],
      },
    ],
  };
}
