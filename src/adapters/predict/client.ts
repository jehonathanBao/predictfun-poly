import { type PredictAdapter } from "../contracts.js";

export interface PredictClientConfig {
  apiBaseUrl: string;
  apiKey?: string;
}

export abstract class PredictClient implements PredictAdapter {
  protected constructor(readonly config: PredictClientConfig) {}

  abstract listBtcMarkets: PredictAdapter["listBtcMarkets"];
  abstract getOrderbook: PredictAdapter["getOrderbook"];
  abstract getAvailableBalance: PredictAdapter["getAvailableBalance"];
  abstract getOpenOrderCount: PredictAdapter["getOpenOrderCount"];
  abstract getHeldPosition: PredictAdapter["getHeldPosition"];
  abstract placeOrder: PredictAdapter["placeOrder"];
  abstract getOrder: PredictAdapter["getOrder"];
  abstract cancelOrder: PredictAdapter["cancelOrder"];
}

