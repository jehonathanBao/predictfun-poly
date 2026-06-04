import { type D } from "../domain/money.js";
import { type PositionSide } from "./exposure-calculator.js";

export type HedgeCandidateVenue = "polymarket" | "predictfun";

export interface HedgeCandidateMarket {
  venue: HedgeCandidateVenue;
  marketId: string;
  eventKey: string;
  yesAsk: number;
  noAsk: number;
  yesBid?: number;
  noBid?: number;
  depthUsd: D;
  spread: number;
  timestampMs: number;
}

export interface HedgeMarketMatchConfig {
  requireSameEventKey: boolean;
  allowCorrelatedHedge: boolean;
  allowedVenues: readonly HedgeCandidateVenue[];
}

export function askForSide(candidate: HedgeCandidateMarket, side: PositionSide): number {
  return side === "YES" ? candidate.yesAsk : candidate.noAsk;
}

export function findBestHedgeCandidate(input: {
  eventKey: string;
  side: PositionSide;
  candidates: readonly HedgeCandidateMarket[];
  config: HedgeMarketMatchConfig;
}): HedgeCandidateMarket | undefined {
  const candidates = input.candidates
    .filter((candidate) => input.config.allowedVenues.includes(candidate.venue))
    .filter((candidate) => {
      if (candidate.eventKey === input.eventKey) return true;
      return !input.config.requireSameEventKey && input.config.allowCorrelatedHedge;
    })
    .filter((candidate) => isFiniteProbability(askForSide(candidate, input.side)));

  return candidates.reduce<HedgeCandidateMarket | undefined>((best, candidate) => {
    if (!best) return candidate;
    const price = askForSide(candidate, input.side);
    const bestPrice = askForSide(best, input.side);
    if (price < bestPrice) return candidate;
    if (price === bestPrice && candidate.depthUsd.gt(best.depthUsd)) return candidate;
    return best;
  }, undefined);
}

function isFiniteProbability(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value < 1;
}
