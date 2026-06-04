import { d, ZERO, type D, type Decimalish } from "../domain/money.js";

export type PositionSide = "YES" | "NO";

export interface PredictExposure {
  marketId: string;
  eventKey: string;
  side: PositionSide;
  sizeUsd: D;
  avgPrice: number;
  currentPrice: number;
  maxLossUsd: D;
  accountId?: string;
}

export interface EventExposure {
  eventKey: string;
  totalYesUsd: D;
  totalNoUsd: D;
  netExposureUsd: D;
  exposures: readonly PredictExposure[];
}

export interface SourceExposure {
  venue: "predictfun";
  marketId: string;
  side: PositionSide;
  sizeUsd: D;
  netExposureUsd: D;
}

export function predictExposure(input: {
  marketId: string;
  eventKey: string;
  side: PositionSide;
  sizeUsd: Decimalish;
  avgPrice: number;
  currentPrice: number;
  maxLossUsd?: Decimalish;
  accountId?: string;
}): PredictExposure {
  return {
    marketId: input.marketId,
    eventKey: input.eventKey,
    side: input.side,
    sizeUsd: d(input.sizeUsd),
    avgPrice: input.avgPrice,
    currentPrice: input.currentPrice,
    maxLossUsd: d(input.maxLossUsd ?? input.sizeUsd),
    accountId: input.accountId
  };
}

export function calculateExposureByEvent(exposures: readonly PredictExposure[]): readonly EventExposure[] {
  const grouped = new Map<string, PredictExposure[]>();
  for (const exposure of exposures) {
    const bucket = grouped.get(exposure.eventKey) ?? [];
    bucket.push(exposure);
    grouped.set(exposure.eventKey, bucket);
  }

  return [...grouped.entries()].map(([eventKey, bucket]) => {
    const totalYesUsd = bucket.filter((item) => item.side === "YES").reduce((total, item) => total.plus(item.sizeUsd), ZERO);
    const totalNoUsd = bucket.filter((item) => item.side === "NO").reduce((total, item) => total.plus(item.sizeUsd), ZERO);
    return {
      eventKey,
      totalYesUsd,
      totalNoUsd,
      netExposureUsd: totalYesUsd.minus(totalNoUsd),
      exposures: bucket
    };
  });
}

export function calculateNetPredictExposure(exposures: readonly PredictExposure[]): D {
  return exposures.reduce((net, exposure) => (exposure.side === "YES" ? net.plus(exposure.sizeUsd) : net.minus(exposure.sizeUsd)), ZERO);
}

export function largestAbsoluteEventExposure(exposures: readonly EventExposure[]): EventExposure | undefined {
  return exposures.reduce<EventExposure | undefined>((best, exposure) => {
    if (!best) return exposure;
    return exposure.netExposureUsd.abs().gt(best.netExposureUsd.abs()) ? exposure : best;
  }, undefined);
}

export function hedgeSideForNetExposure(netExposureUsd: D): PositionSide {
  if (netExposureUsd.gt(0)) return "NO";
  if (netExposureUsd.lt(0)) return "YES";
  throw new Error("net exposure is zero");
}

export function sourceExposureFor(eventExposure: EventExposure): SourceExposure {
  const side: PositionSide = eventExposure.netExposureUsd.gte(0) ? "YES" : "NO";
  const source = eventExposure.exposures
    .filter((exposure) => exposure.side === side)
    .reduce<PredictExposure | undefined>((best, exposure) => {
      if (!best) return exposure;
      return exposure.sizeUsd.gt(best.sizeUsd) ? exposure : best;
    }, undefined);

  return {
    venue: "predictfun",
    marketId: source?.marketId ?? eventExposure.eventKey,
    side,
    sizeUsd: source?.sizeUsd ?? eventExposure.netExposureUsd.abs(),
    netExposureUsd: eventExposure.netExposureUsd
  };
}
