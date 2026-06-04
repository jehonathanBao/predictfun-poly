import { type OrderRequest, type OrderResult } from "../../domain/models.js";
import { type PredictJwtProvider } from "./auth.js";
import { type PredictOrderBuilder } from "./order-builder.js";

export class PredictOrdersAdapter {
  constructor(
    private readonly jwtProvider: PredictJwtProvider,
    private readonly orderBuilder: PredictOrderBuilder
  ) {}

  async createOrder(accountId: string, request: OrderRequest): Promise<Record<string, unknown>> {
    const jwt = await this.jwtProvider.jwtForAccount(accountId);
    const signedOrder = await this.orderBuilder.buildSignedOrder(request);
    return { jwt, signedOrder };
  }

  async normalizeOrderResult(raw: Record<string, unknown>, fallback: OrderResult): Promise<OrderResult> {
    return { ...fallback, raw };
  }
}

