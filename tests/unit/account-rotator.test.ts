import { describe, expect, it } from "vitest";
import {
  PredictAccountRotator,
  predictAccount,
  type PredictAccountAuditor,
  type PredictPositionSnapshot
} from "../../src/core/account-rotator.js";
import { d } from "../../src/core/decimal.js";
import { type LockHandle, type LockManager } from "../../src/locks/redisLocks.js";

class MemoryLockManager implements LockManager {
  readonly acquired: LockHandle[] = [];

  async acquire(key: string, token: string, _ttlMs: number): Promise<LockHandle | null> {
    const handle = { key, token };
    this.acquired.push(handle);
    return handle;
  }

  async release(): Promise<void> {}
}

describe("PredictAccountRotator", () => {
  it("skips accounts that cannot fund 30 percent cap", () => {
    const rotator = new PredictAccountRotator([
      predictAccount({ accountId: "p1", address: "0x1", availableBalance: "10" }),
      predictAccount({ accountId: "p2", address: "0x2", availableBalance: "100" })
    ]);

    const selected = rotator.select(d("20"));

    expect(selected.accountId).toBe("p2");
  });

  it("audits balance and positions before locking a READY account", async () => {
    const rotator = new PredictAccountRotator([
      predictAccount({ accountId: "p1", address: "0x1", availableBalance: "0" })
    ]);
    const auditor: PredictAccountAuditor = {
      async refreshBalance() {
        return d("100");
      },
      async listUnsettledPositions() {
        return [];
      }
    };
    const locks = new MemoryLockManager();

    const selected = await rotator.selectForTrade({
      requiredNotional: d("20"),
      minOrderUsdt: d("1"),
      auditor,
      lockManager: locks,
      lockToken: "token"
    });

    expect(selected.account.accountId).toBe("p1");
    expect(selected.lock?.key).toBe("predict_account:p1");
    expect(rotator.snapshot()[0]?.status).toBe("COOLDOWN");
  });

  it("marks an account HELD_OPEN when positions audit finds unsettled Predict exposure", async () => {
    const rotator = new PredictAccountRotator([
      predictAccount({ accountId: "p1", address: "0x1", availableBalance: "100" })
    ]);
    const position: PredictPositionSnapshot = {
      amount: d("10"),
      valueUsd: d("4"),
      avgBuyPrice: d("0.40"),
      outcome: "YES",
      market: {
        id: "m1",
        conditionId: "c1",
        status: "open"
      }
    };
    const auditor: PredictAccountAuditor = {
      async refreshBalance() {
        return d("100");
      },
      async listUnsettledPositions() {
        return [position];
      }
    };

    await expect(
      rotator.selectForTrade({
        requiredNotional: d("20"),
        minOrderUsdt: d("1"),
        auditor
      })
    ).rejects.toThrow("no Predict account can fund this hedge");

    expect(rotator.snapshot()[0]?.status).toBe("HELD_OPEN");
    expect(rotator.snapshot()[0]?.heldPosition?.marketId).toBe("m1");
  });

  it("does not release a 1H held account when the event window ends", () => {
    const rotator = new PredictAccountRotator([
      predictAccount({ accountId: "p1", address: "0x1", availableBalance: "100" })
    ]);
    rotator.markHeld("p1", {
      marketId: "m1",
      outcome: "YES",
      shares: d("5"),
      costBasis: d("2"),
      oracleStatus: "PENDING_UMA_FINALITY",
      redeemed: false,
      eventEndTs: new Date("2026-06-04T01:00:00Z")
    });

    rotator.advanceHeldStateByTime(new Date("2026-06-04T01:00:01Z"));

    expect(rotator.snapshot()[0]?.status).toBe("HELD_AWAITING_RESOLUTION");
  });

  it("marks an account INSUFFICIENT when refreshed balance cannot fund the order", async () => {
    const rotator = new PredictAccountRotator([
      predictAccount({ accountId: "p1", address: "0x1", availableBalance: "100" })
    ]);
    const auditor: PredictAccountAuditor = {
      async refreshBalance() {
        return d("0.50");
      },
      async listUnsettledPositions() {
        return [];
      }
    };

    await expect(
      rotator.selectForTrade({
        requiredNotional: d("20"),
        minOrderUsdt: d("1"),
        auditor
      })
    ).rejects.toThrow("no Predict account can fund this hedge");

    expect(rotator.snapshot()[0]?.status).toBe("INSUFFICIENT");
  });

  it("restores INSUFFICIENT to READY after balance refresh can fund the trade", async () => {
    const rotator = new PredictAccountRotator([
      predictAccount({ accountId: "p1", address: "0x1", availableBalance: "0.50", status: "INSUFFICIENT" })
    ]);
    const auditor: PredictAccountAuditor = {
      async refreshBalance() {
        return d("100");
      },
      async listUnsettledPositions() {
        return [];
      }
    };

    const selected = await rotator.selectForTrade({
      requiredNotional: d("20"),
      minOrderUsdt: d("1"),
      auditor
    });

    expect(selected.account.accountId).toBe("p1");
    expect(rotator.snapshot()[0]?.status).toBe("COOLDOWN");
  });
});
