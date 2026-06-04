import { type BinaryMarketSpec, norm } from "../domain/models.js";

export interface MarketMatch {
  predict: BinaryMarketSpec;
  polymarket: BinaryMarketSpec;
  matched: boolean;
  reasons: readonly string[];
}

export class StrictMarketMatcher {
  match(predict: BinaryMarketSpec, polymarket: BinaryMarketSpec): MarketMatch {
    const reasons: string[] = [];

    if (predict.venue !== "PREDICT") reasons.push("left market must be Predict");
    if (polymarket.venue !== "POLYMARKET") reasons.push("right market must be Polymarket");
    if (!predict.isBinary || !polymarket.isBinary) reasons.push("both markets must be binary");
    if (norm(predict.underlying) !== "btc" || norm(polymarket.underlying) !== "btc") {
      reasons.push("both markets must be BTC markets");
    }

    const directLink = Boolean(
      polymarket.conditionId &&
        predict.linkedPolymarketConditionIds?.map((id) => id.trim().toLowerCase()).includes(polymarket.conditionId.trim().toLowerCase())
    );

    const required: Record<string, [string, string]> = {
      contractKind: [norm(predict.contractKind), norm(polymarket.contractKind)],
      settlementSource: [norm(predict.settlementSource), norm(polymarket.settlementSource)],
      windowStartUtc: [norm(predict.windowStartUtc), norm(polymarket.windowStartUtc)],
      windowEndUtc: [norm(predict.windowEndUtc), norm(polymarket.windowEndUtc)],
      strike: [predict.strike?.toFixed() ?? "", polymarket.strike?.toFixed() ?? ""],
      direction: [norm(predict.direction), norm(polymarket.direction)],
      resolutionRuleHash: [norm(predict.resolutionRuleHash), norm(polymarket.resolutionRuleHash)]
    };

    for (const [field, [left, right]] of Object.entries(required)) {
      if (!left || !right) {
        reasons.push(`missing strict equivalence field: ${field}`);
      } else if (left !== right) {
        reasons.push(`strict equivalence mismatch: ${field}`);
      }
    }

    const predictResolution = predict.resolution?.equivalenceKey();
    const polymarketResolution = polymarket.resolution?.equivalenceKey();
    if (!predictResolution || !polymarketResolution) {
      reasons.push("missing strict equivalence field: resolution");
    } else if (JSON.stringify(predictResolution) !== JSON.stringify(polymarketResolution)) {
      reasons.push("strict equivalence mismatch: resolution");
    }

    if (directLink && reasons.length > 0) {
      reasons.push("direct market link does not override strict BTC/resolution checks");
    }

    return {
      predict,
      polymarket,
      matched: reasons.length === 0,
      reasons
    };
  }
}

