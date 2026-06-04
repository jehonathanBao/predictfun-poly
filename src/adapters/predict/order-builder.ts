import { type OrderRequest } from "../../domain/models.js";

export interface PredictOrderBuilder {
  buildSignedOrder(request: OrderRequest): Promise<Record<string, unknown>>;
}

export class MissingPredictOrderBuilder implements PredictOrderBuilder {
  async buildSignedOrder(): Promise<Record<string, unknown>> {
    throw new Error("Predict OrderBuilder SDK integration is not wired");
  }
}

