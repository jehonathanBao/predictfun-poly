import { type BinaryMarketSpec } from "../../domain/models.js";

export interface PolymarketGammaClient {
  listBtcMarkets(): Promise<readonly BinaryMarketSpec[]>;
}

