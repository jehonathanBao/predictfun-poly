import { type PredictAccountState, type PredictAccountRotator } from "../core/account-rotator.js";
import { type PredictAdapter, type PolymarketAdapter } from "../adapters/contracts.js";
import { type PolymarketAccountState } from "../accounts/rotator.js";

export interface RefreshBalancesResult {
  predictUpdated: number;
  polymarketUpdated: boolean;
}

export async function refreshBalancesJob(input: {
  predictAccounts: readonly PredictAccountState[];
  predictAdapter: PredictAdapter;
  predictRotator?: PredictAccountRotator;
  polymarketAdapter: PolymarketAdapter;
  polymarketAccount: PolymarketAccountState;
}): Promise<RefreshBalancesResult> {
  let predictUpdated = 0;
  for (const account of input.predictAccounts) {
    const balance = await input.predictAdapter.getAvailableBalance(account.accountId);
    input.predictRotator?.updateBalance(account.accountId, balance);
    predictUpdated += 1;
  }

  input.polymarketAccount.availableCollateral = await input.polymarketAdapter.getAvailableCollateral();

  return {
    predictUpdated,
    polymarketUpdated: true
  };
}
