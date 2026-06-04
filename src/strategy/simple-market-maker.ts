import { estimateDigitalCallProbability, type DigitalMonteCarloResult } from "../modeling/monte-carlo-digital.js";
import { d, minD, ZERO, type D } from "../domain/money.js";
import { type Outcome, type Venue } from "../domain/models.js";
import { type StrategyDecision } from "./types.js";

export interface SimpleMarketMakerMarketState {
  marketId: string;
  venue?: Venue | "predictfun" | "polymarket" | string;
  bestBidYes: number;
  bestAskYes: number;
  bestBidNo?: number;
  bestAskNo?: number;
  depthUsd: D;
  timestampMs: number;
  spotPrice: number;
  strikePrice: number;
  timeToExpirySec: number;
  annualizedVol?: number;
}

export interface SimpleMarketMakerInventory {
  yesUsd: D;
  noUsd: D;
}

export interface SimpleMarketMakerConfig {
  enabled: boolean;
  liveTradingEnabled: boolean;
  nPaths: number;
  annualizedVol: number;
  modelWeight: number;
  baseSpread: number;
  minQuoteSpread: number;
  maxQuoteSpread: number;
  uncertaintySpreadMultiplier: number;
  feeBuffer: number;
  slippageBuffer: number;
  inventorySkewFactor: number;
  maxOrderUsd: D;
  maxInventoryUsd: D;
  minDepthUsd: D;
  maxMarketDataAgeMs: number;
  minSecondsToExpiry: number;
  minLockedEdge: number;
  quoteTtlMs: number;
  postOnly: boolean;
  rng?: () => number;
}

export interface SimpleMarketMakerOrderPlan {
  venue?: string;
  outcome: Outcome;
  side: "BUY";
  limitPrice: number;
  sizeUsd: D;
  postOnly: boolean;
  ttlMs: number;
  syntheticRole: "YES_BID" | "YES_ASK_VIA_BUY_NO";
}

export interface SimpleMarketMakerPlan {
  executable: boolean;
  marketId: string;
  fairProbability: number;
  probabilityLower95: number;
  probabilityUpper95: number;
  observedMidYes: number;
  quoteCenter: number;
  skewedQuoteCenter: number;
  inventorySkew: number;
  quoteSpread: number;
  bidYes: number;
  askYes: number;
  bidNo: number;
  lockedEdgeIfBothFilled: number;
  orders: readonly SimpleMarketMakerOrderPlan[];
  risk: {
    reasonCodes: readonly string[];
    brierScore?: number;
    pnlUsd?: D;
    drawdownUsd?: D;
    modelDrift?: number;
  };
  rejectReason?: string;
  diagnostics: {
    model: "monte_carlo_digital";
    paths: number;
    probabilityStandardError: number;
    observedSpreadYes: number;
    netYesUsd: D;
    maxInventoryUsd: D;
  };
}

export interface SimpleMarketMakerInput {
  market?: SimpleMarketMakerMarketState;
  inventory?: SimpleMarketMakerInventory;
  config?: SimpleMarketMakerConfig;
  nowMs?: number;
}

const EMPTY_INVENTORY: SimpleMarketMakerInventory = {
  yesUsd: ZERO,
  noUsd: ZERO
};

export function buildSimpleMarketMakerSignal(input: Required<SimpleMarketMakerInput>): SimpleMarketMakerPlan {
  const { market, inventory, config, nowMs } = input;
  const validationRejection = validateInputs(market, inventory, config, nowMs);
  if (validationRejection) return rejectedPlan(market, inventory, config, validationRejection.reason, validationRejection.codes);

  const simulation = estimateDigitalCallProbability({
    spotPrice: market.spotPrice,
    strikePrice: market.strikePrice,
    annualizedVol: market.annualizedVol ?? config.annualizedVol,
    timeToExpirySec: market.timeToExpirySec,
    paths: config.nPaths,
    rng: config.rng
  });
  const observedMidYes = midpoint(market.bestBidYes, market.bestAskYes);
  const quoteCenter = clamp01(config.modelWeight * simulation.probability + (1 - config.modelWeight) * observedMidYes);
  const netYesUsd = inventory.yesUsd.minus(inventory.noUsd);
  const inventorySkew = netYesUsd.div(config.maxInventoryUsd).toNumber() * config.inventorySkewFactor;
  const skewedQuoteCenter = clamp01(quoteCenter - inventorySkew);
  const quoteSpread = clamp(
    config.baseSpread +
      config.uncertaintySpreadMultiplier * (simulation.upper95 - simulation.lower95) +
      config.feeBuffer +
      config.slippageBuffer,
    config.minQuoteSpread,
    config.maxQuoteSpread
  );
  const bidYes = clampPrice(skewedQuoteCenter - quoteSpread / 2);
  const askYes = clampPrice(Math.max(bidYes + config.minLockedEdge, skewedQuoteCenter + quoteSpread / 2));
  const bidNo = clampPrice(1 - askYes);
  const lockedEdgeIfBothFilled = 1 - bidYes - bidNo;
  const reasonCodes: string[] = [];

  if (lockedEdgeIfBothFilled < config.minLockedEdge) reasonCodes.push("LOCKED_EDGE_TOO_SMALL");
  if (!config.liveTradingEnabled) reasonCodes.push("DRY_RUN_ONLY");

  const sizeUsd = minD(config.maxOrderUsd, market.depthUsd);
  const orders: SimpleMarketMakerOrderPlan[] = [];
  const atYesInventoryCap = netYesUsd.gte(config.maxInventoryUsd);
  const atNoInventoryCap = netYesUsd.lte(config.maxInventoryUsd.negated());

  if (!atYesInventoryCap && lockedEdgeIfBothFilled >= config.minLockedEdge) {
    orders.push(buildOrder(market, "YES", bidYes, sizeUsd, config, "YES_BID"));
  }
  if (!atNoInventoryCap && lockedEdgeIfBothFilled >= config.minLockedEdge) {
    orders.push(buildOrder(market, "NO", bidNo, sizeUsd, config, "YES_ASK_VIA_BUY_NO"));
  }
  if (atYesInventoryCap) reasonCodes.push("YES_INVENTORY_AT_CAP");
  if (atNoInventoryCap) reasonCodes.push("NO_INVENTORY_AT_CAP");

  return {
    executable: config.liveTradingEnabled && orders.length > 0 && lockedEdgeIfBothFilled >= config.minLockedEdge,
    marketId: market.marketId,
    fairProbability: simulation.probability,
    probabilityLower95: simulation.lower95,
    probabilityUpper95: simulation.upper95,
    observedMidYes,
    quoteCenter,
    skewedQuoteCenter,
    inventorySkew,
    quoteSpread,
    bidYes,
    askYes,
    bidNo,
    lockedEdgeIfBothFilled,
    orders,
    risk: { reasonCodes },
    rejectReason: config.liveTradingEnabled ? undefined : "dry_run_only",
    diagnostics: diagnostics(market, inventory, config, simulation)
  };
}

export function buildSimpleMarketMakerPlan(input: SimpleMarketMakerInput): StrategyDecision {
  if (!input.market || !input.config) {
    return strategyRejected("SIMPLE_MARKET_MAKER_INVALID_INPUT", "missing simple market maker market/config");
  }

  try {
    const signal = buildSimpleMarketMakerSignal({
      market: input.market,
      inventory: input.inventory ?? EMPTY_INVENTORY,
      config: input.config,
      nowMs: input.nowMs ?? Date.now()
    });
    const hardReject = signal.orders.length === 0 || signal.risk.reasonCodes.some((code) => code.startsWith("REJECT_"));

    return {
      accepted: !hardReject,
      mode: "simple_market_maker",
      reasons: hardReject ? ["SIMPLE_MARKET_MAKER_REJECTED"] : [],
      plan: {
        mode: "simple_market_maker",
        action: "SIMPLE_MARKET_MAKER_QUOTES",
        legs: [],
        expectedNetExposureUsd: ZERO,
        expectedProfitAfterHedgeFee: ZERO,
        metadata: { simpleMarketMaker: signal }
      }
    };
  } catch (error) {
    return strategyRejected(
      "SIMPLE_MARKET_MAKER_INVALID_INPUT",
      error instanceof Error ? error.message : "invalid simple market maker input"
    );
  }
}

export class SimpleMarketMakerStrategy {
  evaluate(input: SimpleMarketMakerInput): StrategyDecision {
    return buildSimpleMarketMakerPlan(input);
  }
}

function buildOrder(
  market: SimpleMarketMakerMarketState,
  outcome: Outcome,
  limitPrice: number,
  sizeUsd: D,
  config: SimpleMarketMakerConfig,
  syntheticRole: SimpleMarketMakerOrderPlan["syntheticRole"]
): SimpleMarketMakerOrderPlan {
  return {
    venue: market.venue,
    outcome,
    side: "BUY",
    limitPrice,
    sizeUsd,
    postOnly: config.postOnly,
    ttlMs: config.quoteTtlMs,
    syntheticRole
  };
}

function validateInputs(
  market: SimpleMarketMakerMarketState,
  inventory: SimpleMarketMakerInventory,
  config: SimpleMarketMakerConfig,
  nowMs: number
): { reason: string; codes: string[] } | undefined {
  if (!config.enabled) return { reason: "disabled", codes: ["REJECT_DISABLED"] };
  if (!market.marketId) return { reason: "missing_market_id", codes: ["REJECT_INVALID_MARKET"] };
  assertProbability("bestBidYes", market.bestBidYes);
  assertProbability("bestAskYes", market.bestAskYes);
  if (market.bestAskYes <= market.bestBidYes) return { reason: "invalid_yes_spread", codes: ["REJECT_INVALID_SPREAD"] };
  assertPositiveFinite("spotPrice", market.spotPrice);
  assertPositiveFinite("strikePrice", market.strikePrice);
  assertPositiveFinite("timeToExpirySec", market.timeToExpirySec);
  assertPositiveFinite("annualizedVol", market.annualizedVol ?? config.annualizedVol);
  assertPositiveInteger("nPaths", config.nPaths);
  assertUnitInterval("modelWeight", config.modelWeight);
  assertPositiveFinite("baseSpread", config.baseSpread);
  assertPositiveFinite("minQuoteSpread", config.minQuoteSpread);
  assertPositiveFinite("maxQuoteSpread", config.maxQuoteSpread);
  assertNonNegativeFinite("uncertaintySpreadMultiplier", config.uncertaintySpreadMultiplier);
  assertNonNegativeFinite("feeBuffer", config.feeBuffer);
  assertNonNegativeFinite("slippageBuffer", config.slippageBuffer);
  assertNonNegativeFinite("inventorySkewFactor", config.inventorySkewFactor);
  assertPositiveDecimal("maxOrderUsd", config.maxOrderUsd);
  assertPositiveDecimal("maxInventoryUsd", config.maxInventoryUsd);
  assertPositiveDecimal("minDepthUsd", config.minDepthUsd);
  assertPositiveInteger("maxMarketDataAgeMs", config.maxMarketDataAgeMs);
  assertPositiveInteger("minSecondsToExpiry", config.minSecondsToExpiry);
  assertNonNegativeFinite("minLockedEdge", config.minLockedEdge);
  assertPositiveInteger("quoteTtlMs", config.quoteTtlMs);
  assertNonNegativeDecimal("yesUsd", inventory.yesUsd);
  assertNonNegativeDecimal("noUsd", inventory.noUsd);
  assertPositiveDecimal("depthUsd", market.depthUsd);

  if (config.maxQuoteSpread < config.minQuoteSpread) {
    return { reason: "invalid_spread_bounds", codes: ["REJECT_INVALID_CONFIG"] };
  }
  if (nowMs - market.timestampMs > config.maxMarketDataAgeMs) {
    return { reason: "stale_market_data", codes: ["REJECT_STALE_MARKET_DATA"] };
  }
  if (market.depthUsd.lt(config.minDepthUsd)) {
    return { reason: "insufficient_depth", codes: ["REJECT_INSUFFICIENT_DEPTH"] };
  }
  if (market.timeToExpirySec < config.minSecondsToExpiry) {
    return { reason: "too_close_to_expiry", codes: ["REJECT_TOO_CLOSE_TO_EXPIRY"] };
  }
  if (market.bestAskYes - market.bestBidYes > config.maxQuoteSpread) {
    return { reason: "observed_spread_too_wide", codes: ["REJECT_OBSERVED_SPREAD_TOO_WIDE"] };
  }

  return undefined;
}

function rejectedPlan(
  market: SimpleMarketMakerMarketState,
  inventory: SimpleMarketMakerInventory,
  config: SimpleMarketMakerConfig,
  rejectReason: string,
  reasonCodes: string[]
): SimpleMarketMakerPlan {
  return {
    executable: false,
    marketId: market.marketId,
    fairProbability: 0,
    probabilityLower95: 0,
    probabilityUpper95: 0,
    observedMidYes: midpointOrZero(market.bestBidYes, market.bestAskYes),
    quoteCenter: 0,
    skewedQuoteCenter: 0,
    inventorySkew: 0,
    quoteSpread: 0,
    bidYes: 0,
    askYes: 0,
    bidNo: 0,
    lockedEdgeIfBothFilled: 0,
    orders: [],
    risk: { reasonCodes },
    rejectReason,
    diagnostics: {
      model: "monte_carlo_digital",
      paths: config.nPaths,
      probabilityStandardError: 0,
      observedSpreadYes: Math.max(0, market.bestAskYes - market.bestBidYes),
      netYesUsd: inventory.yesUsd.minus(inventory.noUsd),
      maxInventoryUsd: config.maxInventoryUsd
    }
  };
}

function diagnostics(
  market: SimpleMarketMakerMarketState,
  inventory: SimpleMarketMakerInventory,
  config: SimpleMarketMakerConfig,
  simulation: DigitalMonteCarloResult
): SimpleMarketMakerPlan["diagnostics"] {
  return {
    model: "monte_carlo_digital",
    paths: simulation.paths,
    probabilityStandardError: simulation.standardError,
    observedSpreadYes: market.bestAskYes - market.bestBidYes,
    netYesUsd: inventory.yesUsd.minus(inventory.noUsd),
    maxInventoryUsd: config.maxInventoryUsd
  };
}

function strategyRejected(reason: "SIMPLE_MARKET_MAKER_INVALID_INPUT", message: string): StrategyDecision {
  return {
    accepted: false,
    mode: "simple_market_maker",
    reasons: [reason],
    plan: {
      mode: "simple_market_maker",
      action: "PAUSE_NEW_OPENINGS",
      legs: [],
      expectedNetExposureUsd: ZERO,
      expectedProfitAfterHedgeFee: ZERO,
      metadata: { rejectReason: message }
    }
  };
}

function midpoint(bid: number, ask: number): number {
  return (bid + ask) / 2;
}

function midpointOrZero(bid: number, ask: number): number {
  return Number.isFinite(bid) && Number.isFinite(ask) ? midpoint(bid, ask) : 0;
}

function clampPrice(value: number): number {
  return clamp(value, 0.001, 0.999);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function assertProbability(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be in [0, 1]`);
}

function assertUnitInterval(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be in [0, 1]`);
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive and finite`);
}

function assertNonNegativeFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative and finite`);
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertPositiveDecimal(name: string, value: D): void {
  if (!value.isFinite() || value.lte(0)) throw new Error(`${name} must be positive and finite`);
}

function assertNonNegativeDecimal(name: string, value: D): void {
  if (!value.isFinite() || value.lt(0)) throw new Error(`${name} must be non-negative and finite`);
}

export function defaultSimpleMarketMakerConfig(): SimpleMarketMakerConfig {
  return {
    enabled: true,
    liveTradingEnabled: false,
    nPaths: 20_000,
    annualizedVol: 0.65,
    modelWeight: 0.7,
    baseSpread: 0.018,
    minQuoteSpread: 0.012,
    maxQuoteSpread: 0.08,
    uncertaintySpreadMultiplier: 0.4,
    feeBuffer: 0,
    slippageBuffer: 0,
    inventorySkewFactor: 0.03,
    maxOrderUsd: d("5"),
    maxInventoryUsd: d("25"),
    minDepthUsd: d("20"),
    maxMarketDataAgeMs: 2000,
    minSecondsToExpiry: 60,
    minLockedEdge: 0.004,
    quoteTtlMs: 1500,
    postOnly: true
  };
}
