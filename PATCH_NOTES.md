# v0.2 Strategy Patch Notes

This patch freezes `simple_market_maker` as an experimental dry-run-only strategy and adds the first `exposure_hedge` dry-run core.

Included runtime files:

- `src/modeling/monte-carlo-digital.ts`
- `src/strategy/simple-market-maker.ts`
- `src/strategy/exposure-hedge.ts`
- `src/hedge/exposure-calculator.ts`
- `src/hedge/hedge-market-matcher.ts`
- `src/hedge/hedge-planner.ts`
- `src/risk/hedge-risk.ts`
- `tests/unit/simple-market-maker.test.ts`
- `tests/unit/exposure-hedge.test.ts`
- `tests/unit/hedge-planner.test.ts`

Safety defaults:

- `strategy.strategy_mode` remains `pure_arbitrage`.
- `simple_market_maker.enabled` defaults to `false`.
- `simple_market_maker.live_trading_enabled` defaults to `false`.
- The existing execution coordinator only submits `OPEN_PURE_ARBITRAGE`; `SIMPLE_MARKET_MAKER_QUOTES` is treated as signal-only.
- `EXPOSURE_HEDGE` is also treated as signal-only, and the coordinator refuses to place orders for it even if malformed input sets `executable=true`.

The strategy emits post-only quote plans:

- `BUY YES` as the YES bid.
- `BUY NO` as the synthetic YES ask.

Risk gates currently cover stale market data, minimum depth, expiry proximity, observed spread width, locked edge, and YES/NO inventory caps.

Exposure hedge v0.2:

- Net exposure is `totalYES - totalNO`.
- Positive exposure plans a `NO` hedge; negative exposure plans a `YES` hedge.
- The first version only uses same-`eventKey` hedge markets and rejects correlated candidates.
- Hedge sizing uses the minimum of exposure ratio, configured order cap, and allowed depth usage.
- The plan is always `dryRun=true` and `executable=false`.
