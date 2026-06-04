import { type D } from "../../domain/money.js";

export interface PredictBalancesReader {
  getAvailableBalance(accountId: string): Promise<D>;
}

