export type PositionSide = "YES" | "NO";

export type PredictPositionSide =
  | PositionSide
  | "long"
  | "short"
  | "yes"
  | "no"
  | "buy"
  | "sell";

export interface PredictPosition {
  marketId: string;
  eventKey: string;
  side: PredictPositionSide;
  sizeUsd?: number;
  notionalUsd?: number;
  valueUsd?: number;
  usd?: number;
  quantity?: number;
  price?: number;
  avgPrice?: number;
  currentPrice?: number;
  accountId?: string;
}

export interface MarketExposure {
  marketId: string;
  eventKey: string;
  longUsd: number;
  shortUsd: number;
  netExposureUsd: number;
}

const LONG_SIDES = new Set<PredictPositionSide>(["YES", "long", "yes", "buy"]);
const SHORT_SIDES = new Set<PredictPositionSide>(["NO", "short", "no", "sell"]);

type DecimalLike = {
  toString(): string;
};

function toNumber(value: string | number | DecimalLike): number {
  return typeof value === "number" ? value : Number(value.toString());
}

export function predictExposure(input: {
  marketId: string;
  eventKey: string;
  side: PositionSide;
  sizeUsd: string | number | DecimalLike;
  avgPrice?: string | number | DecimalLike;
  currentPrice?: string | number | DecimalLike;
  accountId?: string;
}): PredictPosition & MarketExposure {
  const sizeUsd = toNumber(input.sizeUsd);
  const longUsd = input.side === "YES" ? sizeUsd : 0;
  const shortUsd = input.side === "NO" ? sizeUsd : 0;
  const position: PredictPosition & MarketExposure = {
    marketId: input.marketId,
    eventKey: input.eventKey,
    side: input.side,
    sizeUsd,
    avgPrice: toNumber(input.avgPrice ?? 0),
    currentPrice: toNumber(input.currentPrice ?? 0),
    longUsd,
    shortUsd,
    netExposureUsd: longUsd - shortUsd,
  };

  if (input.accountId) {
    position.accountId = input.accountId;
  }

  return position;
}

function positionUsd(position: PredictPosition): number {
  if (typeof position.sizeUsd === "number") return position.sizeUsd;
  if (typeof position.notionalUsd === "number") return position.notionalUsd;
  if (typeof position.valueUsd === "number") return position.valueUsd;
  if (typeof position.usd === "number") return position.usd;
  if (
    typeof position.quantity === "number" &&
    typeof position.price === "number"
  ) {
    return Math.abs(position.quantity * position.price);
  }

  return 0;
}

export function calculatePredictExposure(
  positions: PredictPosition[],
): MarketExposure[] {
  const exposures = new Map<string, MarketExposure>();

  for (const position of positions) {
    const key = `${position.eventKey}:${position.marketId}`;
    const current =
      exposures.get(key) ??
      {
        marketId: position.marketId,
        eventKey: position.eventKey,
        longUsd: 0,
        shortUsd: 0,
        netExposureUsd: 0,
      };

    const usd = Math.abs(positionUsd(position));
    if (LONG_SIDES.has(position.side)) {
      current.longUsd += usd;
    } else if (SHORT_SIDES.has(position.side)) {
      current.shortUsd += usd;
    }

    current.netExposureUsd = current.longUsd - current.shortUsd;
    exposures.set(key, current);
  }

  return [...exposures.values()];
}
