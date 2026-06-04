import { type PredictAccountRotator } from "../core/account-rotator.js";

export interface SettledRedeemCandidate {
  accountId: string;
  marketPairId: string;
  redeemable: boolean;
  resolved?: boolean;
  flat?: boolean;
  alreadyRedeemed?: boolean;
  reconciledBalanceUsdt?: string;
}

export interface RedeemSettledAdapter {
  findRedeemablePredictAccounts(): Promise<readonly SettledRedeemCandidate[]>;
  redeemAndReconcile(candidate: SettledRedeemCandidate): Promise<{ balanceUsdt: string }>;
}

export async function redeemSettledJob(input: {
  adapter: RedeemSettledAdapter;
  predictRotator: PredictAccountRotator;
}): Promise<number> {
  let released = 0;
  const candidates = await input.adapter.findRedeemablePredictAccounts();
  for (const candidate of candidates) {
    if (!isReleaseReady(candidate)) continue;
    input.predictRotator.markRedeeming(candidate.accountId);
    const result = candidate.redeemable
      ? await input.adapter.redeemAndReconcile(candidate)
      : { balanceUsdt: candidate.reconciledBalanceUsdt ?? "0" };
    input.predictRotator.release(candidate.accountId, result.balanceUsdt);
    released += 1;
  }
  return released;
}

export function isReleaseReady(candidate: SettledRedeemCandidate): boolean {
  return candidate.flat === true || candidate.alreadyRedeemed === true || candidate.redeemable === true;
}
