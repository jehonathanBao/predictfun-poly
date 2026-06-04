import { describe, expect, it, vi } from "vitest";
import { PredictAccountRotator, predictAccount, type PolymarketAccountState } from "../../src/accounts/rotator.js";
import { type PolymarketAdapter, type PredictAdapter } from "../../src/adapters/contracts.js";
import { ArbEngine, defaultRiskConfig } from "../../src/arb/engine.js";
import { OrderBook, ResolutionSpec, type BinaryMarketSpec, type OrderRequest, type OrderResult } from "../../src/domain/models.js";
import { d, ZERO } from "../../src/domain/money.js";
import { ExecutionCoordinator } from "../../src/execution/coordinator.js";
import { StrategyEngine } from "../../src/strategy/strategy-engine.js";
import { type StrategyConfig, type StrategyDecision } from "../../src/strategy/types.js";

describe("ExecutionCoordinator strategy action guard", () => {
  it("does not submit simple market maker quote signals as real orders", async () => {
    const { coordinator, predictPlaceOrder, polymarketPlaceOrder } = coordinatorFixture({
      strategyDecision: simpleMarketMakerDecision(true)
    });

    const result = await coordinator.runOnce();

    expect(result.executed).toBe(0);
    expect(predictPlaceOrder).not.toHaveBeenCalled();
    expect(polymarketPlaceOrder).not.toHaveBeenCalled();
  });

  it("does not submit exposure hedge signals as real orders", async () => {
    const { coordinator, predictPlaceOrder, polymarketPlaceOrder } = coordinatorFixture({
      strategyDecision: exposureHedgeDecision(true)
    });

    const result = await coordinator.runOnce();

    expect(result.executed).toBe(0);
    expect(predictPlaceOrder).not.toHaveBeenCalled();
    expect(polymarketPlaceOrder).not.toHaveBeenCalled();
  });

  it("submits orders only when the strategy action is OPEN_PURE_ARBITRAGE", async () => {
    const { coordinator, predictPlaceOrder, polymarketPlaceOrder } = coordinatorFixture({
      strategyDecision: openPureArbitrageDecision()
    });

    const result = await coordinator.runOnce();

    expect(result.executed).toBe(1);
    expect(predictPlaceOrder).toHaveBeenCalledTimes(1);
    expect(polymarketPlaceOrder).toHaveBeenCalledTimes(1);
  });
});

function coordinatorFixture(input: { strategyDecision: StrategyDecision }): {
  coordinator: ExecutionCoordinator;
  predictPlaceOrder: ReturnType<typeof vi.fn>;
  polymarketPlaceOrder: ReturnType<typeof vi.fn>;
} {
  const predictMarket = market("PREDICT", "predict-btc-1h");
  const polymarketMarket = market("POLYMARKET", "poly-btc-1h");
  const predictOrderbook = book("0.20");
  const polymarketOrderbook = book("0.50");
  const predictPlaceOrder = vi.fn(async (request: OrderRequest) => filledResult(request));
  const polymarketPlaceOrder = vi.fn(async (request: OrderRequest) => filledResult(request));
  const predict: PredictAdapter = {
    listBtcMarkets: vi.fn(async () => [predictMarket]),
    getOrderbook: vi.fn(async () => predictOrderbook),
    getAvailableBalance: vi.fn(async () => d("100")),
    getOpenOrderCount: vi.fn(async () => 0),
    getHeldPosition: vi.fn(async () => undefined),
    placeOrder: predictPlaceOrder,
    getOrder: vi.fn(async (exchangeOrderId: string) => orderResult("PREDICT", exchangeOrderId, "matched", "10", "0.20")),
    cancelOrder: vi.fn(async (exchangeOrderId: string) => orderResult("PREDICT", exchangeOrderId, "cancelled", "0", "0"))
  };
  const polymarket: PolymarketAdapter = {
    listBtcMarkets: vi.fn(async () => [polymarketMarket]),
    getOrderbook: vi.fn(async () => polymarketOrderbook),
    getAvailableCollateral: vi.fn(async () => d("100")),
    placeOrder: polymarketPlaceOrder,
    getOrder: vi.fn(async (exchangeOrderId: string) => orderResult("POLYMARKET", exchangeOrderId, "matched", "10", "0.50")),
    cancelOrder: vi.fn(async (exchangeOrderId: string) => orderResult("POLYMARKET", exchangeOrderId, "cancelled", "0", "0"))
  };
  const polymarketAccount: PolymarketAccountState = {
    accountId: "poly-main",
    address: "0xpoly",
    availableCollateral: d("100"),
    paused: false
  };
  const strategyEngine = new StrategyEngine();
  vi.spyOn(strategyEngine, "evaluate").mockReturnValue(input.strategyDecision);

  return {
    coordinator: new ExecutionCoordinator({
      predict,
      polymarket,
      predictRotator: new PredictAccountRotator([
        predictAccount({
          accountId: "predict-1",
          address: "0xpredict",
          availableBalance: "100",
          status: "READY"
        })
      ]),
      polymarketAccount,
      engine: new ArbEngine({
        ...defaultRiskConfig,
        predictSlippageBps: ZERO,
        polymarketSlippageBps: ZERO,
        latencyBufferBps: ZERO
      }),
      feeRates: { predictFeeRateBps: 0, polymarketFeeRateBps: 0 },
      dryRun: false,
      liveTradingEnabled: true,
      strategyConfig: strategyConfig(),
      strategyEngine
    }),
    predictPlaceOrder,
    polymarketPlaceOrder
  };
}

function market(venue: BinaryMarketSpec["venue"], venueMarketId: string): BinaryMarketSpec {
  const now = Date.now();
  const start = new Date(now - 1_000_000);
  const end = new Date(start.getTime() + 3_600_000);

  return {
    venue,
    venueMarketId,
    question: "Will BTC close up this hour?",
    title: "Bitcoin Up or Down - hourly",
    description: "BTC/USDT Binance hourly up/down market",
    underlying: "BTC",
    contractKind: "BTC_UP_DOWN",
    settlementSource: "BINANCE_BTC_USDT",
    windowStartUtc: start.toISOString(),
    windowEndUtc: end.toISOString(),
    decimalPrecision: 3,
    isBinary: true,
    strike: d("100000"),
    direction: "UP",
    resolutionRuleHash: "same-rule",
    resolution: new ResolutionSpec({
      oracleSystem: "UMA",
      dataSource: "BINANCE_BTC_USDT",
      rulesHash: "same-rule",
      challengePeriodSeconds: 7200,
      finalityRule: "CLOSE_GTE_OPEN_IS_UP"
    }),
    family: "BTC_UP_DOWN",
    cadence: "HOURLY",
    priceFeedProvider: "BINANCE",
    priceFeedSymbol: "BTC_USDT",
    resolutionSource: "BINANCE_BTC_USDT",
    upDownRule: "CLOSE_GTE_OPEN_IS_UP",
    isTradable: true,
    acceptingOrders: true,
    conditionId: venue === "POLYMARKET" ? "condition-1" : undefined,
    yesTokenId: `${venueMarketId}-yes`,
    noTokenId: `${venueMarketId}-no`,
    metadata: {}
  };
}

function book(askPrice: string): OrderBook {
  return new OrderBook({
    bids: [{ price: d("0.01"), size: d("30") }],
    asks: [{ price: d(askPrice), size: d("30") }],
    decimalPrecision: 3,
    timestampMs: Date.now()
  });
}

function filledResult(request: OrderRequest): OrderResult {
  return {
    venue: request.venue,
    clientOrderId: request.clientOrderId,
    exchangeOrderId: `${request.clientOrderId}-exchange`,
    status: "matched",
    filledShares: request.shares,
    averagePrice: request.limitPrice
  };
}

function orderResult(
  venue: OrderResult["venue"],
  clientOrderId: string,
  status: OrderResult["status"],
  filledShares: string,
  averagePrice: string
): OrderResult {
  return {
    venue,
    clientOrderId,
    status,
    filledShares: d(filledShares),
    averagePrice: d(averagePrice)
  };
}

function strategyConfig(): StrategyConfig {
  return {
    strategyMode: "pure_arbitrage",
    hedgeEnabled: false,
    maxNetExposureUsd: ZERO,
    maxPredictUsagePct: d("0.30"),
    minProfitAfterHedgeFee: ZERO
  };
}

function simpleMarketMakerDecision(executable: boolean): StrategyDecision {
  return {
    accepted: true,
    mode: "simple_market_maker",
    reasons: [],
    plan: {
      mode: "simple_market_maker",
      action: "SIMPLE_MARKET_MAKER_QUOTES",
      legs: [],
      expectedNetExposureUsd: ZERO,
      expectedProfitAfterHedgeFee: ZERO,
      metadata: {
        simpleMarketMaker: {
          executable,
          orders: [
            { side: "BUY", outcome: "YES", limitPrice: 0.49, sizeUsd: d("5") },
            { side: "BUY", outcome: "NO", limitPrice: 0.49, sizeUsd: d("5") }
          ]
        }
      }
    }
  };
}

function exposureHedgeDecision(executable: boolean): StrategyDecision {
  return {
    accepted: true,
    mode: "exposure_hedge",
    reasons: [],
    plan: {
      mode: "exposure_hedge",
      action: "EXPOSURE_HEDGE",
      legs: [],
      expectedNetExposureUsd: d("90"),
      expectedProfitAfterHedgeFee: ZERO,
      metadata: {
        exposureHedge: {
          type: "EXPOSURE_HEDGE",
          executable,
          dryRun: true,
          hedgeOrder: {
            venue: "polymarket",
            marketId: "poly-btc-1h",
            side: "NO",
            action: "BUY",
            limitPrice: 0.42,
            sizeUsd: d("10"),
            postOnly: true
          }
        }
      }
    }
  };
}

function openPureArbitrageDecision(): StrategyDecision {
  return {
    accepted: true,
    mode: "pure_arbitrage",
    reasons: [],
    plan: {
      mode: "pure_arbitrage",
      action: "OPEN_PURE_ARBITRAGE",
      legs: [
        { venue: "PREDICT", outcome: "YES", action: "BUY" },
        { venue: "POLYMARKET", outcome: "NO", action: "BUY" }
      ],
      expectedNetExposureUsd: ZERO,
      expectedProfitAfterHedgeFee: d("1")
    }
  };
}
