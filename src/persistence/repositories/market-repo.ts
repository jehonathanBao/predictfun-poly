import { type BinaryMarketSpec } from "../../core/types.js";

export interface MarketPairRecord {
  id?: string;
  predictMarketId: string;
  polymarketMarketId: string;
  equivalenceStatus: string;
  mismatchReason?: string;
  active: boolean;
}

export interface MarketRepo {
  upsertVenueMarket(market: BinaryMarketSpec, rawJson: Record<string, unknown>): Promise<string>;
  upsertMarketPair(pair: MarketPairRecord): Promise<string>;
  findActiveMarketPairs(): Promise<readonly MarketPairRecord[]>;
}
