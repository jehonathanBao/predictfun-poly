import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const launcherFiles = [
  "start-dashboard.bat",
  "start-frontend.ps1",
  "scripts/start-dashboard-full.ps1",
  "scripts/stop-dashboard.ps1",
  "scripts/restart-dashboard.ps1",
];

describe("dashboard launcher scripts", () => {
  it("keeps the cmd launcher ASCII-only", async () => {
    const bytes = await readFile("start-dashboard.bat");

    expect([...bytes].every((byte) => byte <= 0x7f)).toBe(true);
  });

  it("starts the dry-run worker before opening the dashboard", async () => {
    const startScript = await readFile("scripts/start-dashboard-full.ps1", "utf8");
    const bat = await readFile("start-dashboard.bat", "utf8");

    expect(bat).toContain("scripts\\start-dashboard-full.ps1");
    expect(startScript).toContain("pnpm bot:dry-run");
    expect(startScript).toContain(".env.paper.local");
    expect(startScript).toContain("PAPER_LIVE_MARKET_DATA");
    expect(startScript).toContain("PAPER_SIMULATE_WALLETS");
    expect(startScript).toContain("PAPER_SIM_PREDICT_WALLET_COUNT");
    expect(startScript).toContain("PAPER_SIM_PREDICT_WALLET_FUNDS_USD");
    expect(startScript).toContain("PAPER_SIM_POLYMARKET_HEDGE_FUNDS_USD");
    expect(startScript).toContain("PAPER_SIM_NET_EXPOSURE_USD");
    expect(startScript).toContain("DRY_RUN_WORKER_INTERVAL_MS");
    expect(startScript).toContain("/api/health");
    expect(startScript).toContain("/api/dashboard-status");
    expect(startScript).toContain("hedge-plans.latest.json");
    expect(startScript).toContain("latest_file");
    expect(startScript).toContain("paper_live");
    expect(startScript).toContain("http://127.0.0.1:5173");
    expect(startScript).not.toContain('PAPER_FIXTURE_SCENARIO" -Value "valid"');
  });

  it("tracks only local project service pid files", async () => {
    const startScript = await readFile("scripts/start-dashboard-full.ps1", "utf8");
    const stopScript = await readFile("scripts/stop-dashboard.ps1", "utf8");

    expect(startScript).toContain(".runtime");
    expect(startScript).toContain("dry-run-worker.pid");
    expect(startScript).toContain("dashboard-api.pid");
    expect(startScript).toContain("dashboard-frontend.pid");
    expect(stopScript).toContain("src/workers/dry-run-hedge-worker.ts");
    expect(stopScript).toContain("src/server/hedge-dashboard.ts");
    expect(stopScript).toContain("dashboard:frontend");
  });

  it("does not contain secret material or live hedge execution controls", async () => {
    const source = (await Promise.all(launcherFiles.map((file) => readFile(file, "utf8")))).join("\n");

    expect(source).not.toMatch(/private[_-]?key/i);
    expect(source).not.toMatch(/mnemonic/i);
    expect(source).not.toMatch(/api[_-]?secret/i);
    expect(source).not.toMatch(/rawSigner/i);
    expect(source).not.toContain("OPEN_HEDGE_ORDER");
    expect(source).not.toMatch(/Place hedge/i);
    expect(source).not.toMatch(/Execute hedge/i);
    expect(source).not.toMatch(/Place Order/i);
    expect(source).not.toMatch(/Enable Live/i);
    expect(source).not.toContain("sendTransaction");
    expect(source).not.toContain("writeContract");
    expect(source).not.toContain("signMessage");
    expect(source).not.toContain("signTypedData");
  });
});
