import { describe, expect, it } from "vitest";
import {
  WalletManager,
  buildPaperSimulationStatus,
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

  it("builds read-only paper simulated wallets when real wallets are absent", () => {
    const response = buildWalletManagerDashboardResponse({
      PAPER_SIMULATE_WALLETS: "true",
      PAPER_SIM_PREDICT_WALLET_COUNT: "10",
      PAPER_SIM_PREDICT_WALLET_FUNDS_USD: "100",
      PAPER_SIM_POLYMARKET_HEDGE_FUNDS_USD: "100",
      PAPER_SIM_NET_EXPOSURE_USD: "20",
      PAPER_HEDGE_RATIO: "0.5",
      PAPER_MAX_ORDER_USD: "10",
    }, new Date("2026-06-05T00:00:00.000Z"));

    expect(response).toMatchObject({
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      canExecuteHedge: false,
      summary: {
        predictWalletCount: 10,
        maxPredictWallets: 10,
        polymarketHedgeWalletCount: 1,
        totalPredictBalanceUsd: 1000,
        totalPredictAvailableUsd: 1000,
        totalPredictNetExposureUsd: 20,
        polymarketBalanceUsd: 100,
        polymarketReservedUsd: 10,
        polymarketAvailableUsd: 90,
        currentPlannedHedgeUsd: 10,
      },
      paperSimulation: {
        enabled: true,
        predictWalletCount: 10,
        predictWalletFundsUsd: 100,
        polymarketHedgeFundsUsd: 100,
        simulatedNetExposureUsd: 20,
        plannedHedgeUsd: 10,
        polymarketHedgeWallet: {
          reservedUsd: 10,
          availableUsd: 90,
          currentPlannedHedgeUsd: 10,
        },
        realPredictWalletCount: 0,
        realPolymarketHedgeWalletConfigured: false,
      },
    });
    expect(response.predictWallets[0]).toMatchObject({
      id: "paper-predict-1",
      addressMasked: "paper-p01",
      netExposureUsd: 20,
      status: "paper_simulated",
      paperSimulated: true,
      dryRun: true,
      liveTradingEnabled: false,
      readOnly: true,
    });
    expect(response.polymarketHedgeWallet).toMatchObject({
      id: "paper-polymarket-hedge",
      addressMasked: "paper-poly",
      reservedUsd: 10,
      availableUsd: 90,
      currentPlannedHedgeUsd: 10,
      paperSimulated: true,
    });
    expect(response.warnings).toEqual(expect.arrayContaining([
      "paper_simulated_wallets_enabled",
      "real_predict_wallets_not_configured_using_paper_simulation",
      "real_polymarket_hedge_wallet_not_configured_using_paper_simulation",
    ]));
    expect(response.warnings).not.toContain("predict_wallets_not_configured");
    expect(response.warnings).not.toContain("polymarket_hedge_wallet_not_configured");
  });

  it("uses latest paper simulation metadata to show dynamic hedge reservations", () => {
    const response = buildWalletManagerDashboardResponse({
      PAPER_SIMULATE_WALLETS: "true",
      PAPER_SIM_PREDICT_WALLET_COUNT: "10",
      PAPER_SIM_PREDICT_WALLET_FUNDS_USD: "100",
      PAPER_SIM_POLYMARKET_HEDGE_FUNDS_USD: "8",
      PAPER_SIM_NET_EXPOSURE_USD: "20",
    }, new Date("2026-06-05T00:00:00.000Z"), {
      paperSimulation: buildPaperSimulationStatus({
        enabled: true,
        predictWalletCount: 10,
        predictWalletFundsUsd: 100,
        polymarketHedgeFundsUsd: 8,
        simulatedNetExposureUsd: 20,
        plannedHedgeUsd: 6,
        reservedHedgeUsd: 6,
      }),
    });

    expect(response.summary).toMatchObject({
      predictWalletCount: 10,
      totalPredictBalanceUsd: 1000,
      totalPredictAvailableUsd: 1000,
      totalPredictNetExposureUsd: 20,
      polymarketBalanceUsd: 8,
      polymarketReservedUsd: 6,
      polymarketAvailableUsd: 2,
      currentPlannedHedgeUsd: 6,
    });
    expect(response.paperSimulation).toMatchObject({
      plannedHedgeUsd: 6,
      polymarketHedgeWallet: {
        reservedUsd: 6,
        availableUsd: 2,
      },
    });
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
