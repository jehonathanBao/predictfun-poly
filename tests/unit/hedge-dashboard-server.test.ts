import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildWalletStatusResponse,
  createDashboardServer,
} from "../../src/server/hedge-dashboard.js";

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

describe("dashboard frontend safety copy", () => {
  it("does not expose live execution controls", async () => {
    const files = [
      "frontend/src/App.tsx",
      "frontend/src/components/HedgePlanTable.tsx",
      "frontend/src/components/WalletPanel.tsx",
    ];
    const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");

    expect(source).not.toMatch(/Place hedge/i);
    expect(source).not.toMatch(/Execute hedge/i);
    expect(source).not.toMatch(/Place Order/i);
    expect(source).not.toMatch(/Enable Live/i);
  });
});
