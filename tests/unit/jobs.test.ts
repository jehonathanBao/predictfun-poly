import { describe, expect, it } from "vitest";
import { PredictAccountRotator, predictAccount, type PredictAccountAuditor } from "../../src/core/account-rotator.js";
import { d } from "../../src/core/decimal.js";
import { auditPositionsJob } from "../../src/jobs/audit-positions.js";
import { isReleaseReady, redeemSettledJob, type RedeemSettledAdapter } from "../../src/jobs/redeem-settled.js";
import { reconcileOpenOrdersJob } from "../../src/jobs/reconcile-orders.js";
import { type TradingClient } from "../../src/adapters/contracts.js";
import { type OrderRecord, type OrderRepo } from "../../src/persistence/repositories/order-repo.js";

describe("position and settlement jobs", () => {
  it("restores Predict HELD state from unsettled venue positions after restart", async () => {
    const account = predictAccount({ accountId: "p1", address: "0x1", availableBalance: "100" });
    const rotator = new PredictAccountRotator([account]);
    const auditor: PredictAccountAuditor = {
      async refreshBalance() {
        return d("100");
      },
      async listUnsettledPositions() {
        return [
          {
            amount: d("5"),
            valueUsd: d("2"),
            avgBuyPrice: d("0.40"),
            outcome: "YES",
            market: { id: "m1", status: "open" }
          }
        ];
      }
    };

    const result = await auditPositionsJob({ accounts: [account], auditor, predictRotator: rotator });

    expect(result[0]?.restoredHeld).toBe(true);
    expect(rotator.snapshot()[0]?.status).toBe("HELD_OPEN");
  });

  it("releases Predict account only for release-ready settled candidates", async () => {
    const rotator = new PredictAccountRotator([
      predictAccount({ accountId: "p1", address: "0x1", availableBalance: "100", status: "HELD_REDEEMABLE" })
    ]);
    const adapter: RedeemSettledAdapter = {
      async findRedeemablePredictAccounts() {
        return [{ accountId: "p1", marketPairId: "pair1", redeemable: false, flat: true, reconciledBalanceUsdt: "101" }];
      },
      async redeemAndReconcile() {
        throw new Error("should not redeem flat candidates");
      }
    };

    const released = await redeemSettledJob({ adapter, predictRotator: rotator });

    expect(released).toBe(1);
    expect(rotator.snapshot()[0]?.status).toBe("READY");
    expect(isReleaseReady({ accountId: "p2", marketPairId: "pair2", redeemable: false })).toBe(false);
    expect(isReleaseReady({ accountId: "p3", marketPairId: "pair3", redeemable: false, resolved: true })).toBe(false);
  });
});

describe("order reconcile job", () => {
  it("updates open order state from venue REST status", async () => {
    const orders: OrderRecord[] = [
      {
        id: "o1",
        hedgeId: "h1",
        venue: "PREDICT",
        accountRef: "p1",
        externalOrderId: "ex1",
        outcome: "YES",
        side: "BUY",
        orderType: "FOK",
        limitPrice: d("0.45"),
        requestedShares: d("10"),
        filledShares: d("0"),
        status: "live"
      }
    ];
    const repo: OrderRepo = {
      async createOrder() {
        return "o";
      },
      async updateOrder(order) {
        orders[0] = order;
      },
      async findOpenOrders() {
        return orders;
      }
    };
    const predictClient: TradingClient = {
      async placeOrder() {
        throw new Error("not used");
      },
      async getOrder() {
        return {
          venue: "PREDICT",
          clientOrderId: "c1",
          status: "matched",
          filledShares: d("10"),
          averagePrice: d("0.44")
        };
      },
      async cancelOrder() {
        throw new Error("not used");
      }
    };

    const result = await reconcileOpenOrdersJob({ orderRepo: repo, predictClient, polymarketClient: predictClient });

    expect(result.updated).toBe(1);
    expect(orders[0]?.status).toBe("matched");
    expect(orders[0]?.filledShares?.toFixed()).toBe("10");
  });
});
