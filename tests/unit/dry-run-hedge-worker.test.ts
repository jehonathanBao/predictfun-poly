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
  process.env.OPERATOR_LOG_PATH = join(tempDir, "operator-events.jsonl");
});

afterEach(async () => {
  delete process.env.OPERATOR_LOG_PATH;
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
      paperSimulateWallets: false,
      paperSimPredictWalletCount: 10,
      paperSimPredictWalletFundsUsd: 100,
      paperSimPolymarketHedgeFundsUsd: 100,
      paperFixtureScenario: undefined,
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
      operatorLogPath: "logs/operator-events.jsonl",
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
        marketDataSource: "market_data_url",
        marketDataUrlMasked: "https://example.test/orderbook.json",
        marketDataUrlHost: "example.test",
        lastFetchAt: now.toISOString(),
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
        marketDataSource: "market_data_url",
        simulatedFundsUsd: 25,
        simulatedNetExposureUsd: 20,
        bestBid: 0.48,
        bestAsk: 0.52,
        spread: 0.04,
        marketDataUrlHost: "example.test",
        lastFetchAt: now.toISOString(),
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
      rejectReason: "paper_orderbook_schema_invalid",
      riskApproved: false,
      riskCodes: ["paper_orderbook_schema_invalid"],
      metadata: {
        fetchErrorCode: "paper_orderbook_schema_invalid",
      },
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
      rejectReason: "paper_orderbook_schema_invalid",
      riskApproved: false,
      riskCodes: expect.arrayContaining([
        "paper_orderbook_schema_invalid",
        "paper_orderbook_asks_missing",
        "paper_orderbook_depth_insufficient",
      ]),
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
      rejectReason: "paper_orderbook_spread_too_wide",
      riskApproved: false,
      riskCodes: expect.arrayContaining([
        "paper_orderbook_spread_too_wide",
        "paper_orderbook_depth_insufficient",
        "paper_orderbook_stale",
      ]),
    });
  });

  it("writes a rejected paper plan when live market data is enabled without a token id or URL", async () => {
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
      rejectReason: "paper_market_token_id_missing",
      riskCodes: ["paper_market_token_id_missing"],
      riskApproved: false,
      metadata: {
        fetchErrorCode: "paper_market_token_id_missing",
      },
    });
    const operatorLog = await readFile(process.env.OPERATOR_LOG_PATH!, "utf8");
    expect(operatorLog).toContain("market_data_config_missing");
    expect(operatorLog).toContain("dry_run_plan_created");
    expect(operatorLog).not.toContain("placeOrder");
  });

  it("rejects placeholder Polymarket token ids before fetching", async () => {
    let fetchCalled = false;
    const fetchFn = async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ bids: [], asks: [] }), { status: 200 });
    };

    const written = await writeDryRunHedgeSnapshot({
      latestPath: join(tempDir, "placeholder.latest.json"),
      historyPath: join(tempDir, "placeholder.history.jsonl"),
      now: new Date("2026-06-05T00:00:00.000Z"),
      fetchFn,
      workerOptions: {
        paperLiveMarketData: true,
        paperPolymarketTokenId: "<readonly-token-id>",
      },
    });

    expect(fetchCalled).toBe(false);
    expect(written.plans[0]).toMatchObject({
      executable: false,
      dryRun: true,
      rejectReason: "paper_market_token_id_placeholder",
      riskCodes: ["paper_market_token_id_placeholder"],
      metadata: {
        fetchErrorCode: "paper_market_token_id_placeholder",
        marketDataSource: "polymarket_clob_book",
        tokenIdMasked: "<reado...-id>",
      },
    });
  });

  it("classifies missing, bad-status, and network orderbook fetch failures", async () => {
    const notFound = await writeDryRunHedgeSnapshot({
      latestPath: join(tempDir, "not-found.latest.json"),
      historyPath: join(tempDir, "not-found.history.jsonl"),
      now: new Date("2026-06-05T00:00:00.000Z"),
      fetchFn: async () => new Response("not found", { status: 404 }),
      workerOptions: {
        paperLiveMarketData: true,
        paperMarketDataUrl: "https://example.test/book",
      },
    });
    expect(notFound.plans[0]).toMatchObject({
      rejectReason: "paper_market_orderbook_not_found",
      riskCodes: ["paper_market_orderbook_not_found"],
    });

    const badStatus = await writeDryRunHedgeSnapshot({
      latestPath: join(tempDir, "bad-status.latest.json"),
      historyPath: join(tempDir, "bad-status.history.jsonl"),
      now: new Date("2026-06-05T00:00:00.000Z"),
      fetchFn: async () => new Response("busy", { status: 503 }),
      workerOptions: {
        paperLiveMarketData: true,
        paperMarketDataUrl: "https://example.test/book",
      },
    });
    expect(badStatus.plans[0]).toMatchObject({
      rejectReason: "paper_market_data_bad_status",
      riskCodes: ["paper_market_data_bad_status"],
    });

    const network = await writeDryRunHedgeSnapshot({
      latestPath: join(tempDir, "network.latest.json"),
      historyPath: join(tempDir, "network.history.jsonl"),
      now: new Date("2026-06-05T00:00:00.000Z"),
      fetchFn: async () => {
        throw new Error("connection reset");
      },
      workerOptions: {
        paperLiveMarketData: true,
        paperMarketDataUrl: "https://example.test/book",
      },
    });
    expect(network.plans[0]).toMatchObject({
      rejectReason: "paper_market_data_network_error",
      riskCodes: ["paper_market_data_network_error"],
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
      paperSimulateWallets: false,
      paperSimPredictWalletCount: 10,
      paperSimPredictWalletFundsUsd: 100,
      paperSimPolymarketHedgeFundsUsd: 100,
      paperFixtureScenario: undefined,
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
      operatorLogPath: "logs/operator-events.jsonl",
    });
  });

  it("parses paper simulation wallet defaults from env", () => {
    const options = parseDryRunHedgeWorkerOptions([], {
      PAPER_LIVE_MARKET_DATA: "true",
      PAPER_SIMULATE_WALLETS: "true",
      PAPER_SIM_PREDICT_WALLET_COUNT: "12",
      PAPER_SIM_PREDICT_WALLET_FUNDS_USD: "50",
      PAPER_SIM_POLYMARKET_HEDGE_FUNDS_USD: "75",
      PAPER_SIM_NET_EXPOSURE_USD: "20",
      DRY_RUN_WORKER_INTERVAL_MS: "5000",
      OPERATOR_LOG_PATH: "tmp/operator-events.jsonl",
    });

    expect(options).toMatchObject({
      intervalMs: 5000,
      paperLiveMarketData: true,
      paperSimulateWallets: true,
      paperSimPredictWalletCount: 10,
      paperSimPredictWalletFundsUsd: 50,
      paperSimPolymarketHedgeFundsUsd: 75,
      paperSimNetExposureUsd: 20,
      operatorLogPath: "tmp/operator-events.jsonl",
    });
  });

  it("writes a valid paper-live fixture scenario as an approved dry-run hedge plan", async () => {
    const now = new Date("2026-06-05T00:00:00.000Z");

    const written = await writeDryRunHedgeSnapshot({
      latestPath: join(tempDir, "fixture-valid.latest.json"),
      historyPath: join(tempDir, "fixture-valid.history.jsonl"),
      now,
      workerOptions: {
        paperLiveMarketData: true,
        paperFixtureScenario: "valid",
        paperSimFundsUsd: 100,
        paperSimNetExposureUsd: 20,
        paperHedgeRatio: 0.5,
        paperMaxOrderUsd: 10,
        paperMinDepthUsd: 10,
      },
    });

    expect(written).toMatchObject({
      source: "paper_live_market_data",
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      paperLive: {
        enabled: true,
        sourceType: "fixture",
        sourceLabel: "fixture:valid",
        marketDataSource: "fixture",
        fixtureScenario: "valid",
        lastFetchAt: now.toISOString(),
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
      hedgeDirection: "SELL",
      netExposureUsd: 20,
      hedgeSizeUsd: 10,
      executable: false,
      dryRun: true,
      riskApproved: true,
      riskCodes: [],
      metadata: {
        paperTrading: true,
        marketData: "live",
        marketDataSource: "fixture",
        bestBid: 0.48,
        bestAsk: 0.52,
        spread: 0.04,
        depthUsd: 71.5,
        lastFetchAt: now.toISOString(),
        source: "fixture:valid",
        paperSimulation: {
          enabled: false,
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
        },
        simulatedWallets: {
          predictWallets: 10,
          perWalletFundsUsd: 100,
          polymarketHedgeFundsUsd: 100,
          polymarketAvailableUsd: 90,
          polymarketReservedUsd: 10,
          plannedHedgeUsd: 10,
        },
      },
    });
  });

  it("caps hedge size and dynamic paper wallet reservation by Polymarket paper funds", async () => {
    const written = await writeDryRunHedgeSnapshot({
      latestPath: join(tempDir, "dynamic-funds.latest.json"),
      historyPath: join(tempDir, "dynamic-funds.history.jsonl"),
      now: new Date("2026-06-05T00:00:00.000Z"),
      workerOptions: {
        paperLiveMarketData: true,
        paperSimulateWallets: true,
        paperFixtureScenario: "valid",
        paperSimPredictWalletCount: 10,
        paperSimPredictWalletFundsUsd: 100,
        paperSimPolymarketHedgeFundsUsd: 6,
        paperSimNetExposureUsd: 20,
        paperHedgeRatio: 0.5,
        paperMaxOrderUsd: 10,
      },
    });

    expect(written.plans[0]).toMatchObject({
      executable: false,
      dryRun: true,
      riskApproved: true,
      hedgeSizeUsd: 6,
      metadata: {
        paperSimulation: {
          enabled: true,
          predictWalletCount: 10,
          predictWalletFundsUsd: 100,
          polymarketHedgeFundsUsd: 6,
          simulatedNetExposureUsd: 20,
          plannedHedgeUsd: 6,
          predictWallets: expect.arrayContaining([
            expect.objectContaining({
              id: "paper-predict-1",
              balanceUsd: 100,
              availableUsd: 100,
              reservedUsd: 0,
              netExposureUsd: 20,
            }),
          ]),
          polymarketHedgeWallet: {
            id: "paper-polymarket-hedge",
            balanceUsd: 6,
            reservedUsd: 6,
            availableUsd: 0,
            currentPlannedHedgeUsd: 6,
          },
        },
        simulatedWallets: {
          availableUsd: expect.arrayContaining([100]),
          reservedUsd: expect.arrayContaining([0]),
          netExposureUsd: expect.arrayContaining([20]),
          polymarketAvailableUsd: 0,
          polymarketReservedUsd: 6,
          plannedHedgeUsd: 6,
        },
      },
    });
    const operatorLog = await readFile(process.env.OPERATOR_LOG_PATH!, "utf8");
    expect(operatorLog).toContain("paper_wallet_funds_updated");
    expect(operatorLog).toContain('"hedgeSizeUsd":6');
  });

  it("writes rejected dry-run plans for unsafe fixture scenarios without throwing", async () => {
    const scenarios = [
      ["empty", ["paper_market_depth_unavailable"]],
      ["malformed", ["paper_orderbook_schema_invalid"]],
      ["stale", ["paper_orderbook_stale"]],
      ["wide_spread", ["paper_orderbook_spread_too_wide"]],
      ["shallow_depth", ["paper_orderbook_depth_insufficient"]],
    ] as const;

    for (const [scenario, expectedCodes] of scenarios) {
      const written = await writeDryRunHedgeSnapshot({
        latestPath: join(tempDir, `${scenario}.latest.json`),
        historyPath: join(tempDir, `${scenario}.history.jsonl`),
        now: new Date("2026-06-05T00:00:00.000Z"),
        workerOptions: {
          paperLiveMarketData: true,
          paperFixtureScenario: scenario,
          paperMaxSpread: 0.05,
          paperMinDepthUsd: 10,
          paperMaxMarketDataAgeMs: 1000,
        },
      });

      expect(written).toMatchObject({
        mode: "dry_run",
        readOnly: true,
        liveTradingEnabled: false,
        summary: {
          totalPlans: 1,
          approvedCount: 0,
          rejectedCount: 1,
        },
      });
      expect(written.plans[0]).toMatchObject({
        executable: false,
        dryRun: true,
        riskApproved: false,
        riskCodes: expect.arrayContaining([...expectedCodes]),
      });
    }
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
      marketDataSource: "market_data_url",
      marketDataUrlMasked: "https://example.test/book?...",
      marketDataUrlHost: "example.test",
      polymarketTokenIdMasked: "123456...cdef",
      tokenIdMasked: "123456...cdef",
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
