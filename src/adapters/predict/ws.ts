export interface PredictWsSubscription {
  close(): Promise<void>;
}

export const PREDICT_HEARTBEAT_INTERVAL_MS = 15_000;
export const PREDICT_HEARTBEAT_RESPONSE_TIMEOUT_MS = 15_000;

export type PredictWsTopic =
  | `predictOrderbook/${string}`
  | `assetPriceUpdate/${string}`
  | `predictWalletEvents/${string}`;

export type PredictWalletEventType =
  | "orderAccepted"
  | "orderNotAccepted"
  | "orderExpired"
  | "orderCancelled"
  | "orderTransactionSubmitted"
  | "orderTransactionSuccess"
  | "orderTransactionFailed";

export type PredictWsEvent =
  | {
      type: "M";
      topic: "heartbeat";
      data: number;
    }
  | {
      type: "M";
      topic: `predictOrderbook/${string}`;
      data: unknown;
    }
  | {
      type: "M";
      topic: `assetPriceUpdate/${string}`;
      data: {
        price: number;
        publishTime: number;
        timestamp: number;
      };
    }
  | {
      type: "M";
      topic: `predictWalletEvents/${string}`;
      data: {
        eventType: PredictWalletEventType;
        [key: string]: unknown;
      };
    };

export function predictHeartbeatResponse(event: PredictWsEvent): { method: "heartbeat"; data: number } | null {
  if (event.type === "M" && event.topic === "heartbeat") {
    return { method: "heartbeat", data: event.data };
  }
  return null;
}

export interface PredictWsClient {
  subscribeOrderbook(marketId: string, onMessage: (payload: PredictWsEvent) => void): Promise<PredictWsSubscription>;
  subscribeAssetPrice(priceFeedId: string, onMessage: (payload: PredictWsEvent) => void): Promise<PredictWsSubscription>;
  subscribeWalletEvents(jwt: string, onMessage: (payload: PredictWsEvent) => void): Promise<PredictWsSubscription>;
}
