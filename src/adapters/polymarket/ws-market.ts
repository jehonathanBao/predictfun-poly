export interface PolymarketMarketWsSubscription {
  close(): Promise<void>;
}

export const POLYMARKET_WS_PING_INTERVAL_MS = 10_000;
export const POLYMARKET_WS_PONG_GRACE_MS = 5_000;

export type PolymarketMarketEventType =
  | "book"
  | "price_change"
  | "tick_size_change"
  | "last_trade_price"
  | "best_bid_ask"
  | "new_market"
  | "market_resolved";

export interface PolymarketMarketEvent {
  event_type: PolymarketMarketEventType;
  market?: string;
  asset_id?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface PolymarketMarketSubscriptionMessage {
  assets_ids: readonly string[];
  type: "market";
  custom_feature_enabled: boolean;
}

export function polymarketMarketSubscribeMessage(assetIds: readonly string[]): PolymarketMarketSubscriptionMessage {
  return {
    assets_ids: assetIds,
    type: "market",
    custom_feature_enabled: true
  };
}

export interface PolymarketMarketWsClient {
  subscribeTokenBook(tokenId: string, onMessage: (payload: PolymarketMarketEvent) => void): Promise<PolymarketMarketWsSubscription>;
  subscribeAssetIds(assetIds: readonly string[], onMessage: (payload: PolymarketMarketEvent) => void): Promise<PolymarketMarketWsSubscription>;
}
