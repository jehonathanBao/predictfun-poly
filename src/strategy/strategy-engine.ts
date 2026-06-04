import { PureArbitrageStrategy, type PureArbitrageStrategyInput } from "./arbitrage-basic.js";
import { SimulationEdgeStrategy, type SimulationEdgeConfig } from "./simulation-edge.js";
import {
  SimpleMarketMakerStrategy,
  type SimpleMarketMakerConfig,
  type SimpleMarketMakerInventory,
  type SimpleMarketMakerMarketState
} from "./simple-market-maker.js";
import { ZERO } from "../domain/money.js";
import { type MarketState, type StrategyConfig, type StrategyDecision } from "./types.js";

export interface StrategyEngineInput {
  config: StrategyConfig;
  pureArbitrage?: Omit<PureArbitrageStrategyInput, "config">;
  simulationEdge?: {
    market?: MarketState;
    config?: SimulationEdgeConfig;
  };
  simpleMarketMaker?: {
    market?: SimpleMarketMakerMarketState;
    inventory?: SimpleMarketMakerInventory;
    config?: SimpleMarketMakerConfig;
    nowMs?: number;
  };
}

export class StrategyEngine {
  constructor(
    private readonly pureArbitrage = new PureArbitrageStrategy(),
    private readonly simulationEdge = new SimulationEdgeStrategy(),
    private readonly simpleMarketMaker = new SimpleMarketMakerStrategy()
  ) {}

  evaluate(input: StrategyEngineInput): StrategyDecision {
    switch (input.config.strategyMode) {
      case "pure_arbitrage":
        return this.pureArbitrage.evaluate({
          config: input.config,
          ...(input.pureArbitrage ?? {})
        });
      case "simulation_edge":
        return this.simulationEdge.evaluate(input.simulationEdge ?? {});
      case "simple_market_maker":
        return this.simpleMarketMaker.evaluate(input.simpleMarketMaker ?? {});
      case "hedge_arbitrage":
      case "exposure_hedge":
      case "rebalance_only":
        return {
          accepted: false,
          mode: input.config.strategyMode,
          reasons: [input.config.hedgeEnabled ? "STRATEGY_MODE_NOT_IMPLEMENTED" : "HEDGE_DISABLED"],
          plan: {
            mode: input.config.strategyMode,
            action: "PAUSE_NEW_OPENINGS",
            legs: [],
            expectedNetExposureUsd: ZERO,
            expectedProfitAfterHedgeFee: ZERO
          }
        };
    }
  }
}
