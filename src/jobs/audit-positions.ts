import {
  type HeldPosition,
  type PredictAccountAuditor,
  type PredictAccountState,
  type PredictAccountRotator,
  type PredictPositionSnapshot
} from "../core/account-rotator.js";
import { type AuditRepo } from "../persistence/repositories/audit-repo.js";

export interface PositionAuditResult {
  accountId: string;
  unsettledPositions: number;
  restoredHeld: boolean;
}

export async function auditPositionsJob(input: {
  accounts: readonly PredictAccountState[];
  auditor: PredictAccountAuditor;
  predictRotator?: PredictAccountRotator;
  auditRepo?: AuditRepo;
}): Promise<readonly PositionAuditResult[]> {
  const results: PositionAuditResult[] = [];
  for (const account of input.accounts) {
    const positions = await input.auditor.listUnsettledPositions(account);
    const restoredHeld = positions.length > 0;
    if (restoredHeld && input.predictRotator) {
      input.predictRotator.markHeld(account.accountId, heldFromPosition(positions[0]!));
      await input.auditRepo?.record({
        eventType: "predict_account_held_restored",
        severity: "warning",
        entityType: "predict_account",
        entityId: account.accountId,
        message: "Predict account HELD state restored from venue positions",
        rawJson: {
          marketId: positions[0]!.market.id,
          amount: positions[0]!.amount.toFixed(),
          outcome: positions[0]!.outcome
        }
      });
    }
    results.push({
      accountId: account.accountId,
      unsettledPositions: positions.length,
      restoredHeld
    });
  }
  return results;
}

function heldFromPosition(position: PredictPositionSnapshot): HeldPosition {
  return {
    marketId: position.market.id,
    conditionId: position.market.conditionId,
    outcome: position.outcome,
    shares: position.amount,
    costBasis: position.amount.mul(position.avgBuyPrice),
    oracleStatus: position.market.status === "resolved" || position.market.resolved || position.market.redeemable ? "FINALIZED" : "PENDING_UMA_FINALITY",
    redeemed: false,
    eventEndTs: position.market.eventEndTs,
    heldSince: new Date(),
    heldReason: "restored from Predict positions audit"
  };
}
