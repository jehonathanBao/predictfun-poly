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
      paperMaxSpread: 0.05,
      paperMinDepthUsd: 1,
      paperMaxMarketDataAgeMs: 10000,
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
      paperLive: {
        enabled: true,
        sourceType: "market_data_url",
        sourceLabel: "https://example.test/orderbook.json",
        marketDataUrlMasked: "https://example.test/orderbook.json",
      },
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
        source: "https://example.test/orderbook.json",
      },
    });
  });

  it("rejects malformed orderbooks without throwing", async () => {
    const latestPath = join(tempDir, "paper-malformed.latest.json");
    const historyPath = join(tempDir, "paper-malformed.history.jsonl");
    const fetchFn = async () => new Response("{not-json", { status: 200 });

    const written = await writeDryRunHedgeSnapshot({
      latestPath,
      historyPath,
      now: new Date("2026-06-05T00:00:00.000Z"),
      fetchFn,
      workerOptions: {
        paperLiveMarketData: true,
        paperMarketDataUrl: "https://example.test/bad.json",
      },
    });

    expect(written.plans[0]).toMatchObject({
      executable: false,
      dryRun: true,
      rejectReason: "paper_market_data_fetch_failed",
      riskApproved: false,
      riskCodes: ["paper_market_data_fetch_failed"],
    });
  });

  it("flags missing bids and asks as dry-run risk codes", async () => {
    const fetchFn = async () => new Response(JSON.stringify({ bids: [] }), { status: 200 });

    const written = await writeDryRunHedgeSnapshot({
      latestPath: join(tempDir, "missing-book.latest.json"),
      historyPath: join(tempDir, "missing-book.history.jsonl"),
      now: new Date("2026-06-05T00:00:00.000Z"),
      fetchFn,
      workerOptions: {
        paperLiveMarketData: true,
        paperMarketDataUrl: "https://example.test/missing.json",
      },
    });

    expect(written.plans[0]).toMatchObject({
      executable: false,
      dryRun: true,
      rejectReason: "paper_orderbook_asks_missing",
      riskApproved: false,
      riskCodes: expect.arrayContaining(["paper_orderbook_asks_missing", "paper_market_depth_too_low"]),
    });
  });

  it("flags malformed levels and price range violations", async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          bids: [{ price: "1.2", size: "100" }, { price: "bad", size: "10" }],
          asks: [{ price: "0.51", size: "100" }],
        }),
        { status: 200 },
      );

    const written = await writeDryRunHedgeSnapshot({
      latestPath: join(tempDir, "range.latest.json"),
      historyPath: join(tempDir, "range.history.jsonl"),
      now: new Date("2026-06-05T00:00:00.000Z"),
      fetchFn,
      workerOptions: {
        paperLiveMarketData: true,
        paperMarketDataUrl: "https://example.test/range.json",
      },
    });

    expect(written.plans[0]?.riskCodes).toEqual(
      expect.arrayContaining(["paper_orderbook_price_out_of_range", "paper_orderbook_level_malformed"]),
    );
    expect(written.plans[0]).toMatchObject({
      executable: false,
      dryRun: true,
      riskApproved: false,
    });
  });

  it("flags wide spread, low depth, and stale market data", async () => {
    const staleTimestamp = Date.parse("2020-01-01T00:00:00.000Z");
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          timestampMs: staleTimestamp,
          bids: [{ price: "0.1", size: "1" }],
          asks: [{ price: "0.9", size: "1" }],
        }),
        { status: 200 },
      );

    const written = await writeDryRunHedgeSnapshot({
      latestPath: join(tempDir, "stale.latest.json"),
      historyPath: join(tempDir, "stale.history.jsonl"),
      now: new Date("2026-06-05T00:00:00.000Z"),
      fetchFn,
      workerOptions: {
        paperLiveMarketData: true,
        paperMarketDataUrl: "https://example.test/stale.json",
        paperMaxSpread: 0.05,
        paperMinDepthUsd: 10,
        paperMaxMarketDataAgeMs: 1000,
      },
    });

    expect(written.plans[0]).toMatchObject({
      executable: false,
      dryRun: true,
      rejectReason: "paper_market_spread_too_wide",
      riskApproved: false,
      riskCodes: expect.arrayContaining([
        "paper_market_spread_too_wide",
        "paper_market_depth_too_low",
        "paper_orderbook_stale",
      ]),
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
      paperMaxSpread: 0.05,
      paperMinDepthUsd: 1,
      paperMaxMarketDataAgeMs: 10000,
      paperEventKey: "event-paper",
    });
  });

  it("masks token ids and market data URLs in paper-live status", async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          bids: [[0.48, 100]],
          asks: [[0.52, 100]],
        }),
        { status: 200 },
      );

    const written = await writeDryRunHedgeSnapshot({
      latestPath: join(tempDir, "masked.latest.json"),
      historyPath: join(tempDir, "masked.history.jsonl"),
      now: new Date("2026-06-05T00:00:00.000Z"),
      fetchFn,
      workerOptions: {
        paperLiveMarketData: true,
        paperMarketDataUrl: "https://example.test/book?api_secret=do-not-return",
        paperPolymarketTokenId: "1234567890abcdef",
      },
    });

    const serialized = JSON.stringify(written);
    expect(written.paperLive).toMatchObject({
      sourceType: "market_data_url",
      sourceLabel: "https://example.test/book?...",
      marketDataUrlMasked: "https://example.test/book?...",
      polymarketTokenIdMasked: "123456...cdef",
    });
    expect(serialized).not.toContain("do-not-return");
    expect(serialized).not.toContain("api_secret=do-not-return");
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
