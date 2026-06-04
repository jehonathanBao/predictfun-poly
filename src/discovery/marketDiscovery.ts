import { type PolymarketAdapter, type PredictAdapter } from "../adapters/contracts.js";
import { type BinaryMarketSpec } from "../domain/models.js";

export interface DiscoveredMarkets {
  predictMarkets: readonly BinaryMarketSpec[];
  polymarketMarkets: readonly BinaryMarketSpec[];
}

export class MarketDiscovery {
  constructor(
    private readonly predict: PredictAdapter,
    private readonly polymarket: PolymarketAdapter
  ) {}

  async discover(): Promise<DiscoveredMarkets> {
    const [predictMarkets, polymarketMarkets] = await Promise.all([
      this.predict.listBtcMarkets(),
      this.polymarket.listBtcMarkets()
    ]);
    return { predictMarkets, polymarketMarkets };
  }
}

