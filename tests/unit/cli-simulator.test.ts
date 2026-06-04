import { describe, expect, it } from "vitest";
import { parsePredictAccountsCsv } from "../../src/cli/import-predict-accounts.js";
import { runDryRun } from "../../src/cli/dry-run.js";
import { reconcileCli } from "../../src/cli/reconcile.js";
import { runDeterministicSimulator } from "../../src/sim/simulator.js";

describe("CLI helpers", () => {
  it("parses Predict account CSV imports", () => {
    const accounts = parsePredictAccountsCsv("account_id,address,label\np1,0x1,one\np2,0x2,two\n");

    expect(accounts).toHaveLength(2);
    expect(accounts[0]?.accountId).toBe("p1");
    expect(accounts[1]?.label).toBe("two");
  });

  it("rejects more than 10 Predict accounts", () => {
    const rows = Array.from({ length: 11 }, (_, index) => `p${index},0x${index}`).join("\n");

    expect(() => parsePredictAccountsCsv(`account_id,address\n${rows}`)).toThrow(/at most 10/);
  });

  it("returns safe dry-run and reconcile command results", async () => {
    await expect(runDryRun("BTC")).resolves.toMatchObject({ market: "BTC", simulated: true });
    await expect(reconcileCli()).resolves.toMatchObject({ scheduled: true });
  });
});

describe("deterministic simulator", () => {
  it("runs 1000 random book updates without core invariant failures", () => {
    const result = runDeterministicSimulator(1000, 42);

    expect(result.iterations).toBe(1000);
    expect(result.failures).toEqual([]);
  });
});
