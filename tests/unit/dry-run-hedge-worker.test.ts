import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDashboardStatus } from "../../src/server/dashboard-status.js";
import {
  buildEmptyDryRunHedgePayload,
  parseDryRunHedgeWorkerOptions,
  writeDryRunHedgeSnapshot,
} from "../../src/workers/dry-run-hedge-worker.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "dry-run-hedge-worker-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("dry-run hedge worker", () => {
  it("writes latest and history empty dry-run payloads", async () => {
    const latestPath = join(tempDir, "data", "hedge-plans.latest.json");
    const historyPath = join(tempDir, "data", "hedge-plans.history.jsonl");
    const now = new Date("2026-06-05T00:00:00.000Z");

    const written = await writeDryRunHedgeSnapshot({ latestPath, historyPath, now });
    const latest = JSON.parse(await readFile(latestPath, "utf8")) as Record<string, unknown>;
    const historyLines = (await readFile(historyPath, "utf8")).trim().split("\n");
    const history = JSON.parse(historyLines[0]!) as Record<string, unknown>;

    expect(written).toMatchObject({
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      source: "dry_run_worker",
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      plans: [],
      summary: {
        totalPlans: 0,
        approvedCount: 0,
        rejectedCount: 0,
        maxAbsExposureUsd: 0,
      },
    });
    expect(latest).toEqual(written);
    expect(history).toMatchObject({
      source: "dry_run_worker",
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      plans: [],
      summary: { totalPlans: 0 },
    });
    expect((latest.plans as Record<string, unknown>[]).every((plan) => plan.executable === false)).toBe(true);
    expect((latest.plans as Record<string, unknown>[]).every((plan) => plan.dryRun === true)).toBe(true);
  });

  it("makes dashboard status fresh via latest_file without configured wallets", async () => {
    const latestPath = join(tempDir, "hedge-plans.latest.json");
    const historyPath = join(tempDir, "hedge-plans.history.jsonl");
    const generatedAt = new Date("2026-06-05T00:00:00.000Z");

    await writeDryRunHedgeSnapshot({ latestPath, historyPath, now: generatedAt });
    const status = await loadDashboardStatus({
      latestPath,
      examplePath: join(tempDir, "missing-example.json"),
      nowMs: generatedAt.getTime() + 500,
      staleThresholdMs: 10_000,
    });

    expect(status).toMatchObject({
      apiStatus: "ok",
      botStatus: "fresh",
      dataSource: "latest_file",
      lastUpdated: generatedAt.toISOString(),
      readOnly: true,
      liveTradingEnabled: false,
      planCount: 0,
    });
  });

  it("parses safe once and interval options", () => {
    const options = parseDryRunHedgeWorkerOptions(
      ["--once", "--interval-ms", "2500", "--latest-path", "tmp/latest.json", "--history-path=tmp/history.jsonl"],
      {},
    );

    expect(options).toEqual({
      intervalMs: 2500,
      once: true,
      latestPath: "tmp/latest.json",
      historyPath: "tmp/history.jsonl",
      paperLiveMarketData: false,
      paperMarketDataUrl: undefined,
      paperPolymarketTokenId: undefined,
      paperPolymarketClobBase: "https://clob.polymarket.com",
      paperSimFundsUsd: 100,
      paperSimNetExposureUsd: 10,
      paperHedgeRatio: 0.5,
      paperMaxOrderUsd: 10,
      paperEventKey: "paper-live-market",
      paperPredictMarketId: "paper-predict",
      paperHedgeMarketId: "paper-polymarket",
    });
  });

  it("writes a paper live-market dry-run plan from a real-data shaped orderbook", async () => {
    const latestPath = join(tempDir, "paper-live.latest.json");
    const historyPath = join(tempDir, "paper-live.history.jsonl");
    const now = new Date("2026-06-05T00:00:00.000Z");
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          bids: [
            { price: "0.48", size: "100" },
            { price: "0.47", size: "50" },
          ],
          asks: [
            { price: "0.52", size: "80" },
            { price: "0.53", size: "40" },
          ],
        }),
        { status: 200 },
      );

    const written = await writeDryRunHedgeSnapshot({
      latestPath,
      historyPath,
      now,
      fetchFn,
      workerOptions: {
        paperLiveMarketData: true,
        paperMarketDataUrl: "https://example.test/orderbook.json",
        paperSimFundsUsd: 25,
        paperSimNetExposureUsd: 20,
        paperHedgeRatio: 0.5,
        paperMaxOrderUsd: 8,
        paperEventKey: "btc-paper-event",
        paperPredictMarketId: "predict-paper-btc",
        paperHedgeMarketId: "poly-paper-btc",
      },
    });

    expect(written).toMatchObject({
      source: "paper_live_market_data",
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      summary: {
        totalPlans: 1,
        approvedCount: 1,
        rejectedCount: 0,
        maxAbsExposureUsd: 20,
      },
    });
    expect(written.plans[0]).toMatchObject({
      strategy: "EXPOSURE_HEDGE",
      marketId: "predict-paper-btc",
      eventKey: "btc-paper-event",
      hedgeDirection: "SELL",
      netExposureUsd: 20,
      hedgeSizeUsd: 8,
      hedgeMarketId: "poly-paper-btc",
      executable: false,
      dryRun: true,
      riskApproved: true,
      riskCodes: [],
      hedgeOrder: {
        venue: "POLYMARKET",
        side: "SELL",
        limitPrice: 0.48,
        sizeUsd: "8",
        postOnly: true,
      },
      metadata: {
        paperTrading: true,
        marketData: "live",
        simulatedFundsUsd: 25,
        simulatedNetExposureUsd: 20,
        bestBid: 0.48,
        bestAsk: 0.52,
        spread: 0.04,
      },
    });
  });

  it("writes a rejected paper plan when live market data is enabled without a source", async () => {
    const latestPath = join(tempDir, "paper-missing.latest.json");
    const historyPath = join(tempDir, "paper-missing.history.jsonl");

    const written = await writeDryRunHedgeSnapshot({
      latestPath,
      historyPath,
      now: new Date("2026-06-05T00:00:00.000Z"),
      workerOptions: {
        paperLiveMarketData: true,
      },
    });

    expect(written.summary).toMatchObject({
      totalPlans: 1,
      approvedCount: 0,
      rejectedCount: 1,
      maxAbsExposureUsd: 10,
    });
    expect(written.plans[0]).toMatchObject({
      executable: false,
      dryRun: true,
      rejectReason: "paper_market_data_not_configured",
      riskCodes: ["paper_market_data_not_configured"],
      riskApproved: false,
    });
  });

  it("parses paper live-market options from flags and env", () => {
    const options = parseDryRunHedgeWorkerOptions(
      [
        "--paper-live-market-data",
        "--paper-polymarket-token-id",
        "token-1",
        "--paper-sim-net-exposure-usd=-15",
        "--paper-max-order-usd",
        "7",
      ],
      {
        PAPER_MARKET_DATA_URL: "https://example.test/book",
        PAPER_SIM_FUNDS_USD: "30",
        PAPER_HEDGE_RATIO: "0.25",
        PAPER_EVENT_KEY: "event-paper",
      },
    );

    expect(options).toMatchObject({
      paperLiveMarketData: true,
      paperMarketDataUrl: "https://example.test/book",
      paperPolymarketTokenId: "token-1",
      paperSimFundsUsd: 30,
      paperSimNetExposureUsd: -15,
      paperHedgeRatio: 0.25,
      paperMaxOrderUsd: 7,
      paperEventKey: "event-paper",
    });
  });

  it("does not include execution or wallet signing calls", async () => {
    const source = await readFile("src/workers/dry-run-hedge-worker.ts", "utf8");

    expect(source).not.toContain("placeOrder");
    expect(source).not.toContain("sendTransaction");
    expect(source).not.toContain("writeContract");
    expect(source).not.toContain("signMessage");
    expect(source).not.toContain("signTypedData");
    expect(source).not.toContain("OPEN_HEDGE_ORDER");
  });

  it("builds only read-only dry-run payloads", () => {
    expect(buildEmptyDryRunHedgePayload(new Date("2026-06-05T00:00:00.000Z"))).toEqual({
      schemaVersion: 1,
      generatedAt: "2026-06-05T00:00:00.000Z",
      source: "dry_run_worker",
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      plans: [],
    });
  });
});
