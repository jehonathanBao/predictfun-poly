import { describe, expect, it } from "vitest";
import {
  WalletManager,
  buildWalletManagerDashboardResponse,
  walletInfo,
} from "../../src/wallet/wallet-manager.js";

describe("read-only wallet manager", () => {
  it("manages up to ten Predict wallets and one Polymarket hedge wallet", () => {
    const response = buildWalletManagerDashboardResponse({
      PREDICT_WALLETS_JSON: JSON.stringify([
        {
          id: "predict-1",
          address: "0x1111111111111111111111111111111111111111",
          balanceUsd: 20,
          reservedUsd: 5,
          yesExposureUsd: 12,
          noExposureUsd: 2,
        },
        {
          id: "predict-2",
          address: "0x2222222222222222222222222222222222222222",
          balanceUsd: 30,
          netExposureUsd: -7,
        },
      ]),
      POLYMARKET_FUNDER_ADDRESS: "0x9999999999999999999999999999999999999999",
      POLYMARKET_BALANCE_USD: "100",
      POLYMARKET_RESERVED_USD: "12",
      POLYMARKET_CURRENT_PLANNED_HEDGE_USD: "8",
    }, new Date("2026-06-05T00:00:00.000Z"));

    expect(response).toMatchObject({
      schemaVersion: 1,
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      canExecuteHedge: false,
      generatedAt: "2026-06-05T00:00:00.000Z",
      walletPolicy: {
        maxPredictWallets: 10,
        polymarketHedgeWalletsAllowed: 1,
        frontendSigningAllowed: false,
        frontendTransactionsAllowed: false,
      },
      summary: {
        predictWalletCount: 2,
        maxPredictWallets: 10,
        polymarketHedgeWalletCount: 1,
        totalPredictBalanceUsd: 50,
        totalPredictReservedUsd: 5,
        totalPredictAvailableUsd: 45,
        totalPredictNetExposureUsd: 3,
        totalPredictAbsExposureUsd: 17,
        polymarketBalanceUsd: 100,
        polymarketReservedUsd: 12,
        polymarketAvailableUsd: 88,
        currentPlannedHedgeUsd: 8,
      },
    });
    expect(response.predictWallets).toHaveLength(2);
    expect(response.predictWallets[0]).toMatchObject({
      id: "predict-1",
      venue: "PREDICT",
      role: "predict_account",
      addressMasked: "0x1111...1111",
      availableUsd: 15,
      netExposureUsd: 10,
      dryRun: true,
      liveTradingEnabled: false,
      readOnly: true,
    });
    expect(response.predictWallets[0]).not.toHaveProperty("address");
    expect(response.polymarketHedgeWallet).toMatchObject({
      id: "polymarket-hedge",
      venue: "POLYMARKET",
      role: "polymarket_hedge",
      addressMasked: "0x9999...9999",
      availableUsd: 88,
    });
    expect(response.polymarketHedgeWallet).not.toHaveProperty("address");
    expect(JSON.stringify(response)).not.toContain("0x1111111111111111111111111111111111111111");
    expect(JSON.stringify(response)).not.toContain("0x9999999999999999999999999999999999999999");
    expect(response.warnings).toEqual([]);
  });

  it("caps Predict wallets at ten and reports warnings", () => {
    const response = buildWalletManagerDashboardResponse({
      PREDICT_ACCOUNT_COUNT: "12",
      POLYMARKET_HEDGE_WALLET_CONFIGURED: "true",
    });

    expect(response.summary.predictWalletCount).toBe(10);
    expect(response.summary.maxPredictWallets).toBe(10);
    expect(response.warnings).toContain("predict_wallet_count_exceeds_10");
  });

  it("supports in-memory reservations without enabling live execution", () => {
    const manager = new WalletManager([
      walletInfo({
        id: "poly",
        venue: "POLYMARKET",
        role: "polymarket_hedge",
        address: "0x9999999999999999999999999999999999999999",
        balanceUsd: 25,
      }),
    ]);

    manager.reserveForPlan("0x9999999999999999999999999999999999999999", "plan-1", 10);
    expect(manager.getAvailableFunds("0x9999999999999999999999999999999999999999")).toBe(15);
    expect(manager.snapshot()).toMatchObject({
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      canExecuteHedge: false,
    });

    manager.releaseReservation("0x9999999999999999999999999999999999999999", "plan-1", 4);
    expect(manager.getAvailableFunds("0x9999999999999999999999999999999999999999")).toBe(19);

    manager.releaseReservation("0x9999999999999999999999999999999999999999", "plan-1");
    expect(manager.getAvailableFunds("0x9999999999999999999999999999999999999999")).toBe(25);
  });

  it("never returns secret material in dashboard response", () => {
    const response = buildWalletManagerDashboardResponse({
      PREDICT_WALLET_ADDRESSES: "0x1111111111111111111111111111111111111111",
      POLYMARKET_FUNDER_ADDRESS: "0x9999999999999999999999999999999999999999",
      POLYMARKET_PRIVATE_KEY: "private-key-value",
      POLY_API_SECRET: "api-secret-value",
      PREDICT_API_KEY: "predict-key-value",
      HEDGE_LIVE_TRADING_ENABLED: "true",
    });
    const serialized = JSON.stringify(response);

    expect(response.mode).toBe("dry_run");
    expect(response.readOnly).toBe(true);
    expect(response.liveTradingEnabled).toBe(false);
    expect(response.canExecuteHedge).toBe(false);
    expect(response.warnings).toContain("live_trading_request_ignored_in_wallet_manager");
    expect(serialized).not.toContain("0x1111111111111111111111111111111111111111");
    expect(serialized).not.toContain("0x9999999999999999999999999999999999999999");
    expect(serialized).not.toContain("private-key-value");
    expect(serialized).not.toContain("api-secret-value");
    expect(serialized).not.toContain("predict-key-value");
    expect(serialized).not.toContain("mnemonic");
    expect(serialized).not.toContain("rawSigner");
    expect(serialized).not.toContain("rawToken");
  });
});
