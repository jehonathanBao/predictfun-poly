import { type HeldPosition, type PredictPositionSnapshot } from "../../accounts/rotator.js";

export interface PredictPositionsReader {
  listUnsettledPositions(accountId: string): Promise<readonly PredictPositionSnapshot[]>;
  getHeldPosition(accountId: string): Promise<HeldPosition | undefined>;
}
