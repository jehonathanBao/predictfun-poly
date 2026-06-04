import { PredictAccountRotator, predictAccount } from "../accounts/rotator.js";
import { ArbEngine, defaultRiskConfig } from "../arb/engine.js";
import { OrderBook } from "../domain/models.js";
import { d, ZERO, type D } from "../domain/money.js";

export interface SimulatorInvariantFailure {
  iteration: number;
  reason: string;
}

export interface SimulatorResult {
  iterations: number;
  tradesOpened: number;
  failures: readonly SimulatorInvariantFailure[];
}

export function runDeterministicSimulator(iterations = 1000, seed = 7): SimulatorResult {
  const rng = mulberry32(seed);
  const engine = new ArbEngine({
    ...defaultRiskConfig,
    predictSlippageBps: d(0),
    polymarketSlippageBps: d(0),
    latencyBufferBps: d(0)
  });
  const rotator = new PredictAccountRotator([
    predictAccount({ accountId: "p1", address: "0x1", availableBalance: "100" }),
    predictAccount({ accountId: "p2", address: "0x2", availableBalance: "100" }),
    predictAccount({ accountId: "p3", address: "0x3", availableBalance: "100" })
  ]);
  let polymarketCollateral = d("500");
  let tradesOpened = 0;
  const failures: SimulatorInvariantFailure[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const predictAsk = price(rng, "0.35", "0.60");
    const polyAsk = price(rng, "0.35", "0.60");
    const size = d(String(1 + Math.floor(rng() * 20)));
    const quote = engine.sizeComboA({
      predictYesBook: book(predictAsk, size),
      polymarketNoBook: book(polyAsk, size),
      feeRates: { predictFeeRateBps: 0, polymarketFeeRateBps: 0 },
      limits: {
        selectedPredictFreeBalance: d("100"),
        polymarketAvailableCollateral: polymarketCollateral
      }
    });

    if (!quote.executable || !quote.quote) continue;
    if (quote.quote.netProfitUsd.lte(0)) {
      failures.push({ iteration, reason: "net profit <= 0 still opened" });
      continue;
    }
    if (polymarketCollateral.lt(quote.quote.polymarketLeg.totalCost)) {
      failures.push({ iteration, reason: "Polymarket insufficient collateral still opened" });
      continue;
    }

    const account = rotator.candidatesFromNext().find((candidate) => candidate.status === "READY");
    if (!account) continue;
    const maxNotional = account.availableBalance.mul("0.30");
    if (quote.quote.predictLeg.totalCost.gt(maxNotional)) {
      failures.push({ iteration, reason: "Predict trade exceeded 30 percent cap" });
      continue;
    }
    const reserved = rotator.reserve(account.accountId);
    if (reserved.heldPosition) {
      failures.push({ iteration, reason: "HELD Predict account reused" });
      continue;
    }
    rotator.markHeld(reserved.accountId, {
      marketId: `sim-${iteration}`,
      outcome: "YES",
      shares: quote.shares,
      costBasis: quote.quote.predictLeg.totalCost,
      oracleStatus: "PENDING_UMA_FINALITY",
      redeemed: false
    });
    polymarketCollateral = polymarketCollateral.minus(quote.quote.polymarketLeg.totalCost);
    tradesOpened += 1;
    if (polymarketCollateral.lt(ZERO)) failures.push({ iteration, reason: "Polymarket collateral became negative" });
  }

  return { iterations, tradesOpened, failures };
}

function book(askPrice: D, size: D): OrderBook {
  return new OrderBook({
    bids: [{ price: d("0.01"), size }],
    asks: [{ price: askPrice, size }],
    decimalPrecision: 3,
    timestampMs: 1
  });
}

function price(rng: () => number, min: string, max: string): D {
  const minD = d(min);
  return minD.plus(d(max).minus(minD).mul(rng().toString())).toDecimalPlaces(3);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
