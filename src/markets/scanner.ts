import { StrictMarketMatcher, type MarketMatch } from "../matching/strictMatcher.js";
import { type BinaryMarketSpec, norm } from "../domain/models.js";
import { HourlyBtcUpDownMatcher, type HourlyBtcMatcherConfig } from "../core/hourly-btc-market-matcher.js";
import { DEFAULT_SHORT_WINDOW_FILTER_CONFIG } from "../core/short-window-market-filter.js";
import { normalizeBinaryMarketSpec } from "./normalize.js";

export interface ScanResult {
  accepted: readonly MarketMatch[];
  rejected: readonly MarketMatch[];
}

export interface BtcMarketScannerOptions {
  enforceShortWindow?: boolean;
  nowMs?: number;
  shortWindow?: HourlyBtcMatcherConfig;
}

export class BtcMarketScanner {
  private readonly shortWindowMatcher: HourlyBtcUpDownMatcher;

  constructor(
    private readonly matcher = new StrictMarketMatcher(),
    private readonly options: BtcMarketScannerOptions = {}
  ) {
    this.shortWindowMatcher = new HourlyBtcUpDownMatcher({
      ...DEFAULT_SHORT_WINDOW_FILTER_CONFIG,
      maxStartTimeMismatchSec: 0,
      maxEndTimeMismatchSec: 0,
      ...options.shortWindow
    });
  }

  scan(input: {
    predictMarkets: readonly BinaryMarketSpec[];
    polymarketMarkets: readonly BinaryMarketSpec[];
  }): ScanResult {
    const predictBtc = input.predictMarkets.filter((market) => norm(market.underlying) === "btc");
    const polymarketBtc = input.polymarketMarkets.filter((market) => norm(market.underlying) === "btc");
    const accepted: MarketMatch[] = [];
    const rejected: MarketMatch[] = [];

    for (const predict of predictBtc) {
      for (const polymarket of polymarketBtc) {
        if (this.options.enforceShortWindow !== false) {
          const shortWindow = this.shortWindowMatcher.match(
            normalizeBinaryMarketSpec(predict),
            normalizeBinaryMarketSpec(polymarket),
            this.options.nowMs ?? Date.now()
          );
          if (!shortWindow.matched) {
            rejected.push({
              predict,
              polymarket,
              matched: false,
              reasons: shortWindow.reasons.map((reason) => `REJECT_${reason}`)
            });
            continue;
          }
        }

        const match = this.matcher.match(predict, polymarket);
        if (match.matched) accepted.push(match);
        else rejected.push(match);
      }
    }

    return { accepted, rejected };
  }
}
