import { Decimal } from "decimal.js";
import { OrderBook, complementOutcome, type Outcome, type FillEstimate } from "../domain/models.js";
import { d, ONE, ZERO, type Decimalish } from "../domain/money.js";

export type ArbitrageCombo = "COMBO_A" | "COMBO_B";

export interface RiskConfig {
  minNetProfitUsd: Decimal;
  requirePositiveAfterAllBuffers: boolean;
  minPredictOrderUsdt: Decimal;
  predictSlippageBps: Decimal;
  polymarketSlippageBps: Decimal;
  latencyBufferBps: Decimal;
  predictMaxTradeFraction: Decimal;
  gasOrFixedCostPerShare: Decimal;
  roundingBufferPerShare: Decimal;
  fixedCostsUsd: Decimal;
  perTradeMaxUsd?: Decimal;
}

export interface FeeRates {
  predictFeeRateBps: Decimalish;
  polymarketFeeRateBps: Decimalish;
}

export interface LegQuote {
  outcome: Outcome;
  fill: FillEstimate;
  fee: Decimal;
  slippageReserve: Decimal;
  latencyReserve: Decimal;
  totalCost: Decimal;
  effectivePrice: Decimal;
}

export interface ArbitrageQuote {
  combo: ArbitrageCombo;
  shares: Decimal;
  predictLeg: LegQuote;
  polymarketLeg: LegQuote;
  netCostPerShare: Decimal;
  profitPerShare: Decimal;
  netProfitUsd: Decimal;
  executable: boolean;
  reasons: readonly string[];
}

export interface SizingLimits {
  selectedPredictFreeBalance: Decimal;
  polymarketAvailableCollateral: Decimal;
  perTradeMaxUsd?: Decimal;
  venueMaxShares?: Decimal;
}

export interface SizingResult {
  combo: ArbitrageCombo;
  shares: Decimal;
  profitableOrderbookDepth: Decimal;
  limitedBy: readonly string[];
  quote?: ArbitrageQuote;
  executable: boolean;
  reasons: readonly string[];
}

export const defaultRiskConfig: RiskConfig = {
  minNetProfitUsd: ZERO,
  requirePositiveAfterAllBuffers: true,
  minPredictOrderUsdt: d(1),
  predictSlippageBps: d(10),
  polymarketSlippageBps: d(10),
  latencyBufferBps: d(5),
  predictMaxTradeFraction: d("0.30"),
  gasOrFixedCostPerShare: ZERO,
  roundingBufferPerShare: ZERO,
  fixedCostsUsd: ZERO
};

export class ArbEngine {
  constructor(private readonly config: RiskConfig = defaultRiskConfig) {}

  evaluateCombo(input: {
    combo: ArbitrageCombo;
    shares: Decimalish;
    predictOutcome: Outcome;
    predictBook: OrderBook;
    polymarketBook: OrderBook;
    feeRates: FeeRates;
  }): ArbitrageQuote {
    const shares = d(input.shares);
    const predictFill = input.predictBook.estimateBuy(shares);
    const polymarketFill = input.polymarketBook.estimateBuy(shares);
    const predictLeg = this.legQuote(input.predictOutcome, predictFill, input.feeRates.predictFeeRateBps, this.config.predictSlippageBps);
    const polymarketLeg = this.legQuote(
      complementOutcome(input.predictOutcome),
      polymarketFill,
      input.feeRates.polymarketFeeRateBps,
      this.config.polymarketSlippageBps
    );
    const extraPerShare = this.config.gasOrFixedCostPerShare.plus(this.config.roundingBufferPerShare);
    const variableCost = predictLeg.totalCost.plus(polymarketLeg.totalCost).plus(extraPerShare.mul(shares));
    const netCostPerShare = variableCost.div(shares);
    const profitPerShare = ONE.minus(netCostPerShare);
    const netProfitUsd = shares.mul(profitPerShare).minus(this.config.fixedCostsUsd);

    const reasons: string[] = [];
    if (!predictFill.complete) reasons.push("insufficient Predict depth");
    if (!polymarketFill.complete) reasons.push("insufficient Polymarket depth");
    if (predictFill.grossCost.lt(this.config.minPredictOrderUsdt)) reasons.push("Predict leg is below minimum order amount");
    if (this.config.requirePositiveAfterAllBuffers && profitPerShare.lte(0)) {
      reasons.push("profit per share is not positive after fees and buffers");
    }
    if (netProfitUsd.lte(this.config.minNetProfitUsd)) {
      reasons.push("net profit is not strictly positive after fees and buffers");
    }

    return {
      combo: input.combo,
      shares,
      predictLeg,
      polymarketLeg,
      netCostPerShare,
      profitPerShare,
      netProfitUsd,
      executable: reasons.length === 0,
      reasons
    };
  }

  evaluateComboA(input: {
    shares: Decimalish;
    predictYesBook: OrderBook;
    polymarketNoBook: OrderBook;
    feeRates: FeeRates;
  }): ArbitrageQuote {
    return this.evaluateCombo({
      combo: "COMBO_A",
      shares: input.shares,
      predictOutcome: "YES",
      predictBook: input.predictYesBook,
      polymarketBook: input.polymarketNoBook,
      feeRates: input.feeRates
    });
  }

  evaluateComboB(input: {
    shares: Decimalish;
    predictNoBook: OrderBook;
    polymarketYesBook: OrderBook;
    feeRates: FeeRates;
  }): ArbitrageQuote {
    return this.evaluateCombo({
      combo: "COMBO_B",
      shares: input.shares,
      predictOutcome: "NO",
      predictBook: input.predictNoBook,
      polymarketBook: input.polymarketYesBook,
      feeRates: input.feeRates
    });
  }

  sizeComboA(input: {
    predictYesBook: OrderBook;
    polymarketNoBook: OrderBook;
    feeRates: FeeRates;
    limits: SizingLimits;
  }): SizingResult {
    return this.sizeCombo({
      combo: "COMBO_A",
      predictOutcome: "YES",
      predictBook: input.predictYesBook,
      polymarketBook: input.polymarketNoBook,
      feeRates: input.feeRates,
      limits: input.limits
    });
  }

  sizeComboB(input: {
    predictNoBook: OrderBook;
    polymarketYesBook: OrderBook;
    feeRates: FeeRates;
    limits: SizingLimits;
  }): SizingResult {
    return this.sizeCombo({
      combo: "COMBO_B",
      predictOutcome: "NO",
      predictBook: input.predictNoBook,
      polymarketBook: input.polymarketYesBook,
      feeRates: input.feeRates,
      limits: input.limits
    });
  }

  private sizeCombo(input: {
    combo: ArbitrageCombo;
    predictOutcome: Outcome;
    predictBook: OrderBook;
    polymarketBook: OrderBook;
    feeRates: FeeRates;
    limits: SizingLimits;
  }): SizingResult {
    const depth = this.profitableDepth(input);
    if (depth.lte(0)) {
      return {
        combo: input.combo,
        shares: ZERO,
        profitableOrderbookDepth: depth,
        limitedBy: ["profitable_orderbook_depth"],
        executable: false,
        reasons: ["no profitable orderbook depth after fees and buffers"]
      };
    }

    const depthQuote = this.evaluateCombo({ ...input, shares: depth });
    const candidates: Array<[string, Decimal]> = [
      ["profitable_orderbook_depth", depth],
      ["predict_30_percent_balance", input.limits.selectedPredictFreeBalance.mul(this.config.predictMaxTradeFraction).div(depthQuote.predictLeg.effectivePrice)],
      ["polymarket_available_collateral", input.limits.polymarketAvailableCollateral.div(depthQuote.polymarketLeg.effectivePrice)]
    ];
    const tradeCap = input.limits.perTradeMaxUsd ?? this.config.perTradeMaxUsd;
    if (tradeCap) candidates.push(["per_trade_max_usd", tradeCap.div(depthQuote.netCostPerShare)]);
    if (input.limits.venueMaxShares) candidates.push(["venue_max_shares", input.limits.venueMaxShares]);

    const selected = candidates.reduce((best, value) => (value[1].lt(best[1]) ? value : best));
    const quote = this.evaluateCombo({ ...input, shares: selected[1] });
    const limitedBy = candidates.filter((candidate) => candidate[1].eq(selected[1])).map(([name]) => name);

    return {
      combo: input.combo,
      shares: selected[1],
      profitableOrderbookDepth: depth,
      limitedBy,
      quote,
      executable: quote.executable,
      reasons: quote.reasons
    };
  }

  private profitableDepth(input: {
    combo: ArbitrageCombo;
    predictOutcome: Outcome;
    predictBook: OrderBook;
    polymarketBook: OrderBook;
    feeRates: FeeRates;
  }): Decimal {
    let best = ZERO;
    for (const shares of pairedBreakpoints(input.predictBook, input.polymarketBook)) {
      const quote = this.evaluateCombo({ ...input, shares });
      if (quote.executable) best = shares;
    }
    return best;
  }

  private legQuote(outcome: Outcome, fill: FillEstimate, feeRateBps: Decimalish, slippageBps: Decimal): LegQuote {
    const fee = binaryTakerFee(fill.filledShares, fill.averagePrice, feeRateBps);
    const slippageReserve = reserveBps(fill.grossCost, slippageBps);
    const latencyReserve = reserveBps(fill.grossCost, this.config.latencyBufferBps);
    const totalCost = fill.grossCost.plus(fee).plus(slippageReserve).plus(latencyReserve);
    return {
      outcome,
      fill,
      fee,
      slippageReserve,
      latencyReserve,
      totalCost,
      effectivePrice: fill.filledShares.gt(0) ? totalCost.div(fill.filledShares) : ZERO
    };
  }
}

export function binaryTakerFee(shares: Decimal, price: Decimal, feeRateBps: Decimalish): Decimal {
  const bps = d(feeRateBps);
  const feeBasisPrice = Decimal.min(price, ONE.minus(price));
  return shares.mul(feeBasisPrice).mul(bps).div(10000);
}

export function reserveBps(amount: Decimal, reserveRateBps: Decimal): Decimal {
  return amount.mul(reserveRateBps).div(10000);
}

function pairedBreakpoints(predictBook: OrderBook, polymarketBook: OrderBook): Decimal[] {
  const breakpoints: Decimal[] = [];
  let predictIndex = 0;
  let polyIndex = 0;
  let predictRemaining = predictBook.asks[predictIndex]?.size ?? ZERO;
  let polyRemaining = polymarketBook.asks[polyIndex]?.size ?? ZERO;
  let cumulative = ZERO;

  while (predictIndex < predictBook.asks.length && polyIndex < polymarketBook.asks.length) {
    const take = Decimal.min(predictRemaining, polyRemaining);
    if (take.gt(0)) {
      cumulative = cumulative.plus(take);
      breakpoints.push(cumulative);
    }
    predictRemaining = predictRemaining.minus(take);
    polyRemaining = polyRemaining.minus(take);
    if (predictRemaining.lte(0)) {
      predictIndex += 1;
      predictRemaining = predictBook.asks[predictIndex]?.size ?? ZERO;
    }
    if (polyRemaining.lte(0)) {
      polyIndex += 1;
      polyRemaining = polymarketBook.asks[polyIndex]?.size ?? ZERO;
    }
  }
  return breakpoints;
}
