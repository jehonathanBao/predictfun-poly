import { type D } from "../../domain/money.js";

export interface PredictAccountRecord {
  id: string;
  label: string;
  walletAddress: string;
  predictAccountAddress?: string;
  encryptedPrivateKey: string;
  status: string;
  balanceUsdt: D;
  heldMarketPairId?: string;
  lastUsedAt?: Date;
  lastError?: string;
}

export interface AccountRepo {
  upsertPredictAccount(account: PredictAccountRecord): Promise<void>;
  findAvailablePredictAccounts(): Promise<readonly PredictAccountRecord[]>;
  markPredictAccountHeld(accountId: string, marketPairId: string): Promise<void>;
  releasePredictAccount(accountId: string, balanceUsdt: D): Promise<void>;
}
