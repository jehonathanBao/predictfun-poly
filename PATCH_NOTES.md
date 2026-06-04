# Simple Market Maker Patch Notes

This patch adds `simple_market_maker` as a signal-only strategy mode.

Included runtime files:

- `src/modeling/monte-carlo-digital.ts`
- `src/strategy/simple-market-maker.ts`
- `tests/unit/simple-market-maker.test.ts`

Safety defaults:

- `strategy.strategy_mode` remains `pure_arbitrage`.
- `simple_market_maker.live_trading_enabled` defaults to `false`.
- The existing execution coordinator only submits `OPEN_PURE_ARBITRAGE`; `SIMPLE_MARKET_MAKER_QUOTES` is treated as signal-only.

The strategy emits post-only quote plans:

- `BUY YES` as the YES bid.
- `BUY NO` as the synthetic YES ask.

Risk gates currently cover stale market data, minimum depth, expiry proximity, observed spread width, locked edge, and YES/NO inventory caps.
