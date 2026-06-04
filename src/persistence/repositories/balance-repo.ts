import { type D } from "../../domain/money.js";

export interface BalanceRepo {
  updatePredictBalance(accountId: string, balanceUsdt: D): Promise<void>;
}
