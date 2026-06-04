import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAccountHealthResponse } from "../../src/server/account-health.js";
import {
  buildWalletStatusResponse,
  createDashboardServer,
} from "../../src/server/hedge-dashboard.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "hedge-dashboard-server-"));
});

afterEach(async () => {
  delete process.env.HEDGE_DASHBOARD_SNAPSHOT;
  delete process.env.HEDGE_DASHBOARD_LATEST_PATH;
  delete process.env.HEDGE_DASHBOARD_EXAMPLE_PATH;
  delete process.env.DASHBOARD_STALE_DATA_THRESHOLD_MS;
  delete process.env.POLYMARKET_PRIVATE_KEY;
  delete process.env.POLY_API_SECRET;
  delete process.env.POLY_API_KEY;
  delete process.env.POLY_PASSPHRASE;
  delete process.env.PREDICT_API_KEY;
  delete process.env.POLYMARKET_FUNDER_ADDRESS;
  delete process.env.BACKEND_TRADING_ADDRESS;
  delete process.env.PREDICT_USAGE_PCT;
  delete process.env.PREDICT_CURRENT_USAGE_PCT;
  delete process.env.PREDICT_ACCOUNT_COUNT;
  delete process.env.HEDGE_MAX_PREDICT_USAGE_PCT;
  delete process.env.HEDGE_ALLOWED_VENUES;
  await rm(tempDir, { recursive: true, force: true });
});

describe("hedge dashboard wallet status", () => {
  it("does not return private keys, mnemonics, or API secrets", () => {
    const status = buildWalletStatusResponse({
      POLYMARKET_PRIVATE_KEY: "private-key-value",
      POLY_API_SECRET: "poly-secret-value",
      POLY_API_KEY: "poly-key-value",
      POLY_PASSPHRASE: "poly-passphrase-value",
      PREDICT_API_KEY: "predict-key-value",
      POLYMARKET_FUNDER_ADDRESS: "0x1234567890abcdef1234567890abcdef12345678",
    });
    const serialized = JSON.stringify(status);

    expect(serialized).not.toContain("private-key-value");
    expect(serialized).not.toContain("poly-secret-value");
    expect(serialized).not.toContain("poly-key-value");
    expect(serialized).not.toContain("poly-passphrase-value");
    expect(serialized).not.toContain("predict-key-value");
    expect(serialized).not.toContain("mnemonic");
    expect(status.backendTradingAddressMasked).toBe("0x1234...5678");
    expect(status.secretsLoaded).toBe(true);
  });

  it("forces read-only wallet and hedge execution flags", () => {
    const status = buildWalletStatusResponse({
      WALLET_EXPECTED_CHAIN_ID: "137",
      WALLET_EXPECTED_CHAIN_NAME: "Polygon",
      WALLET_ALLOW_FRONTEND_SIGNING: "true",
      WALLET_ALLOW_FRONTEND_TRANSACTIONS: "true",
      HEDGE_LIVE_TRADING_ENABLED: "true",
    });

    expect(status.mode).toBe("dry_run");
    expect(status.readOnly).toBe(true);
    expect(status.liveTradingEnabled).toBe(false);
    expect(status.canExecuteHedge).toBe(false);
    expect(status.allowFrontendSigning).toBe(false);
    expect(status.allowFrontendTransactions).toBe(false);
    expect(status.allowedActions).toEqual(["OPEN_PURE_ARBITRAGE"]);
    expect(status.blockedActions).toEqual(["EXPOSURE_HEDGE", "SIMPLE_MARKET_MAKER_QUOTES"]);
  });

  it("serves GET /api/wallet-status without secret material", async () => {
    const server = createDashboardServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind to a TCP port");

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/wallet-status`);
      const body = (await response.json()) as Record<string, unknown>;
      const serialized = JSON.stringify(body);

      expect(response.status).toBe(200);
      expect(body.readOnly).toBe(true);
      expect(body.canExecuteHedge).toBe(false);
      expect(serialized).not.toContain("mnemonic");
      expect(serialized).not.toContain("privateKey");
      expect(serialized).not.toContain("apiSecret");
      expect(serialized).not.toContain("rawSigner");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

describe("hedge dashboard plan API", () => {
  it("serves a dry-run envelope from the configured snapshot", async () => {
    const snapshotPath = join(tempDir, "snapshot.json");
    await writeFile(
      snapshotPath,
      JSON.stringify([
        {
          strategy: "EXPOSURE_HEDGE",
          predictMarketId: "predict-api",
          eventKey: "event-api",
          netExposureUsd: 17,
          hedgeSizeUsd: 8.5,
          executable: true,
          dryRun: false,
          risk: { approved: false, reasonCodes: ["stale_market_data"] },
          rejectReason: "stale_market_data",
        },
      ]),
      "utf8",
    );
    process.env.HEDGE_DASHBOARD_SNAPSHOT = snapshotPath;

    const server = createDashboardServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind to a TCP port");

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/hedge-plans`);
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body.dataSource).toBe("snapshot_env");
      expect(body.mode).toBe("dry_run");
      expect(body.liveTradingEnabled).toBe(false);
      expect(body.summary).toMatchObject({
        totalPlans: 1,
        approvedCount: 0,
        rejectedCount: 1,
        maxAbsExposureUsd: 17,
      });
      expect(body.plans).toMatchObject([
        {
          marketId: "predict-api",
          executable: false,
          dryRun: true,
          riskCodes: ["stale_market_data"],
          riskApproved: false,
        },
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

describe("hedge dashboard status API", () => {
  it("serves read-only fresh status without secret material", async () => {
    const latestPath = join(tempDir, "latest.json");
    const generatedAt = new Date().toISOString();
    await writeFile(
      latestPath,
      JSON.stringify({
        schemaVersion: 1,
        generatedAt,
        source: "server_test",
        mode: "dry_run",
        liveTradingEnabled: false,
        plans: [
          {
            strategy: "EXPOSURE_HEDGE",
            predictMarketId: "predict-status-api",
            eventKey: "event-status-api",
            netExposureUsd: 29,
            executable: true,
            dryRun: false,
            risk: { approved: true, reasonCodes: [] },
          },
        ],
      }),
      "utf8",
    );
    process.env.HEDGE_DASHBOARD_LATEST_PATH = latestPath;
    process.env.HEDGE_DASHBOARD_EXAMPLE_PATH = join(tempDir, "missing-example.json");
    process.env.DASHBOARD_STALE_DATA_THRESHOLD_MS = "60000";
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
      const response = await fetch(`http://127.0.0.1:${address.port}/api/dashboard-status`);
      const body = (await response.json()) as Record<string, unknown>;
      const serialized = JSON.stringify(body);

      expect(response.status).toBe(200);
      expect(body.apiStatus).toBe("ok");
      expect(body.botStatus).toBe("fresh");
      expect(body.readOnly).toBe(true);
      expect(body.liveTradingEnabled).toBe(false);
      expect(body.dataSource).toBe("latest_file");
      expect(body.planCount).toBe(1);
      expect(body.approvedCount).toBe(1);
      expect(serialized).not.toContain("private-key-value");
      expect(serialized).not.toContain("api-secret-value");
      expect(serialized).not.toContain("api-key-value");
      expect(serialized).not.toContain("passphrase-value");
      expect(serialized).not.toContain("predict-key-value");
      expect(serialized).not.toContain("mnemonic");
      expect(serialized).not.toContain("rawSigner");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

describe("hedge dashboard account health API", () => {
  it("builds read-only account health without secret material", () => {
    const health = buildAccountHealthResponse({
      POLYMARKET_PRIVATE_KEY: "private-key-value",
      POLY_API_SECRET: "poly-secret-value",
      POLY_API_KEY: "poly-key-value",
      POLY_PASSPHRASE: "poly-passphrase-value",
      PREDICT_API_KEY: "predict-key-value",
      POLYMARKET_FUNDER_ADDRESS: "0x1234567890abcdef1234567890abcdef12345678",
      PREDICT_USAGE_PCT: "0.18",
      HEDGE_MAX_PREDICT_USAGE_PCT: "0.30",
      PREDICT_ACCOUNT_COUNT: "3",
      HEDGE_ALLOWED_VENUES: "polymarket",
      HEDGE_LIVE_TRADING_ENABLED: "true",
    });
    const serialized = JSON.stringify(health);

    expect(health.mode).toBe("dry_run");
    expect(health.readOnly).toBe(true);
    expect(health.liveTradingEnabled).toBe(false);
    expect(health.wallet.backendAddressMasked).toBe("0x1234...5678");
    expect(health.predict).toMatchObject({
      configured: true,
      usagePct: 0.18,
      maxUsagePct: 0.3,
      accountCount: 3,
    });
    expect(health.polymarket).toMatchObject({
      configured: true,
      allowedVenues: ["polymarket"],
    });
    expect(health.warnings).toContain("live_trading_request_ignored_in_dashboard");
    expect(serialized).not.toContain("private-key-value");
    expect(serialized).not.toContain("poly-secret-value");
    expect(serialized).not.toContain("poly-key-value");
    expect(serialized).not.toContain("poly-passphrase-value");
    expect(serialized).not.toContain("predict-key-value");
    expect(serialized).not.toContain("mnemonic");
    expect(serialized).not.toContain("rawSigner");
    expect(serialized).not.toContain("rawToken");
  });

  it("serves GET /api/account-health as dry-run read-only status", async () => {
    process.env.POLYMARKET_PRIVATE_KEY = "private-key-value";
    process.env.POLY_API_SECRET = "api-secret-value";
    process.env.POLY_API_KEY = "api-key-value";
    process.env.POLY_PASSPHRASE = "passphrase-value";
    process.env.PREDICT_API_KEY = "predict-key-value";
    process.env.POLYMARKET_FUNDER_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
    process.env.PREDICT_USAGE_PCT = "0.12";
    process.env.PREDICT_ACCOUNT_COUNT = "2";

    const server = createDashboardServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind to a TCP port");

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/account-health`);
      const body = (await response.json()) as Record<string, unknown>;
      const serialized = JSON.stringify(body);

      expect(response.status).toBe(200);
      expect(body.mode).toBe("dry_run");
      expect(body.readOnly).toBe(true);
      expect(body.liveTradingEnabled).toBe(false);
      expect(serialized).toContain("0x1234...5678");
      expect(serialized).not.toContain("private-key-value");
      expect(serialized).not.toContain("api-secret-value");
      expect(serialized).not.toContain("api-key-value");
      expect(serialized).not.toContain("passphrase-value");
      expect(serialized).not.toContain("predict-key-value");
      expect(serialized).not.toContain("mnemonic");
      expect(serialized).not.toContain("rawSigner");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

describe("dashboard frontend safety copy", () => {
  it("does not expose live execution controls", async () => {
    const files = [
      "frontend/src/App.tsx",
      "frontend/src/components/AccountHealthPanel.tsx",
      "frontend/src/components/DryRunSummaryPanel.tsx",
      "frontend/src/components/ExposureTrendPanel.tsx",
      "frontend/src/components/HedgePlanTable.tsx",
      "frontend/src/components/RuntimeStatusPanel.tsx",
      "frontend/src/wallet/WalletPanel.tsx",
      "frontend/src/wallet/Web3Provider.tsx",
      "frontend/src/wallet/chains.ts",
      "frontend/src/wallet/readOnlyWalletGuard.ts",
      "frontend/src/wallet/useReadOnlyWalletStatus.ts",
    ];
    const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");

    expect(source).not.toMatch(/Place hedge/i);
    expect(source).not.toMatch(/Execute hedge/i);
    expect(source).not.toMatch(/Place Order/i);
    expect(source).not.toMatch(/Enable Live/i);
  });

  it("does not include wallet write or signing calls", async () => {
    const files = [
      "frontend/src/App.tsx",
      "frontend/src/components/AccountHealthPanel.tsx",
      "frontend/src/components/DryRunSummaryPanel.tsx",
      "frontend/src/components/ExposureTrendPanel.tsx",
      "frontend/src/wallet/WalletPanel.tsx",
      "frontend/src/wallet/Web3Provider.tsx",
      "frontend/src/wallet/readOnlyWalletGuard.ts",
      "frontend/src/wallet/useReadOnlyWalletStatus.ts",
    ];
    const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");

    expect(source).not.toContain("sendTransaction");
    expect(source).not.toContain("writeContract");
    expect(source).not.toContain("signMessage");
    expect(source).not.toContain("signTypedData");
  });

  it("renders account health dry-run and live disabled copy", async () => {
    const source = await readFile("frontend/src/components/AccountHealthPanel.tsx", "utf8");

    expect(source).toContain("dry-run");
    expect(source).toContain("Live trading");
    expect(source).toContain("disabled");
  });
});
