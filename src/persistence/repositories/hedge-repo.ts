import { type D } from "../../domain/money.js";

export interface HedgeRecord {
  id?: string;
  marketPairId: string;
  predictAccountId: string;
  direction: string;
  requestedShares: D;
  filledShares?: D;
  expectedProfitUsd?: D;
  realizedProfitUsd?: D;
  status: string;
  error?: string;
}

export interface HedgeRepo {
  createHedge(input: HedgeRecord): Promise<string>;
  updateHedgeStatus(hedgeId: string, status: string): Promise<void>;
}
