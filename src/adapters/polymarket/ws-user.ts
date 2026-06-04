export interface PolymarketUserWsSubscription {
  close(): Promise<void>;
}

export type PolymarketUserEventType = "order" | "trade";

export interface PolymarketUserEvent {
  event_type?: PolymarketUserEventType;
  type?: string;
  market?: string;
  asset_id?: string;
  id?: string;
  status?: string;
  [key: string]: unknown;
}

export interface PolymarketUserSubscriptionMessage {
  auth: {
    apiKey: string;
    secret: string;
    passphrase: string;
  };
  markets: readonly string[];
  type: "user";
}

export interface PolymarketUserWsClient {
  subscribeUserOrders(conditionIds: readonly string[], onMessage: (payload: PolymarketUserEvent) => void): Promise<PolymarketUserWsSubscription>;
}
