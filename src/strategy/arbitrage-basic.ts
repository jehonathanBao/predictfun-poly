import { type SizingResult } from "../arb/engine.js";
import { type Decimalish } from "../domain/money.js";
import { HedgeEngine } from "./hedge-engine.js";
import { StrategyRiskEngine } from "./risk-hedge.js";
import { type NetExposureSnapshot, type StrategyConfig, type StrategyDecision } from "./types.js";

export interface PureArbitrageStrategyInput {
  config: StrategyConfig;
  sizing?: SizingResult;
  predictAccountId?: string;
  selectedPredictFreeBalance?: Decimalish;
  netExposure?: NetExposureSnapshot;
}

export class PureArbitrageStrategy {
  constructor(
    private readonly riskEngine = new StrategyRiskEngine(),
    private readonly hedgeEngine = new HedgeEngine()
  ) {}

  evaluate(input: PureArbitrageStrategyInput): StrategyDecision {
    const risk = this.riskEngine.evaluatePureArbitrage({
      config: input.config,
      sizing: input.sizing,
      selectedPredictFreeBalance: input.selectedPredictFreeBalance,
      netExposure: input.netExposure
    });
    return this.hedgeEngine.buildPureArbitragePlan({
      config: input.config,
      risk,
      sizing: input.sizing,
      predictAccountId: input.predictAccountId
    });
  }
}
