# RISK

The bot only trades strictly equivalent short-window BTC Up/Down binary markets and only the two buy/buy hedge combinations.

Market eligibility risk:

- default scope is exact 1H `BTC_UP_DOWN`,
- resolution source must be allowlisted, default `BINANCE_BTC_USDT`,
- 4H, daily, weekly, target, range, monthly, and yearly BTC markets are rejected,
- markets too close to close are rejected before execution,
- stale books cannot trigger a trade,
- matching requires identical start/end, provider, symbol, and Up/Down rule.

Strategy risk:

- live trading currently supports only `pure_arbitrage`,
- `simulation_edge` is dry-run signal-only and must not submit orders,
- `simple_market_maker` is dry-run signal-only by default and must not submit orders through the arbitrage execution coordinator,
- `hedge_arbitrage`, `exposure_hedge`, and `rebalance_only` are reserved interfaces until separately implemented and tested,
- `min_profit_after_hedge_fee` must pass after the arb engine's fee/buffer checks,
- `max_predict_usage_pct` is a strategy-level guard in addition to the Predict 30% account cap,
- `max_net_exposure_usd` caps aggregate strategy exposure before future hedge modes can open more risk.

Every quote must be rejected unless both are true:

- `profit_per_share > 0` after all fees, slippage, latency, gas/fixed, and rounding buffers
- `net_profit_usd > min_net_profit_usd`

Predict account risk:

- at most 10 accounts,
- one held position per account across `HELD_OPEN`, `HELD_AWAITING_RESOLUTION`, `HELD_REDEEMABLE`, and `REDEEMING`,
- 1H event end does not release the account; actual resolved/redeemed/flat state is required,
- per-trade notional capped at 30% of available balance,
- insufficient Predict balance marks the account `INSUFFICIENT` and rotates to the next account,
- auth/signing/config failures mark `AUTH_ERROR` for manual handling,
- Redis account locks use `predict_account:{id}`.

Polymarket account risk:

- one hedge account,
- insufficient collateral pauses all new openings.

Execution risk:

- orders must be FOK/FAK or bounded marketable limits,
- limit prices cannot exceed the opportunity quote's worst acceptable price,
- naked market orders with unlimited slippage are rejected,
- filled shares must be confirmed by REST and WS before final `HEDGED`,
- mismatched shares trigger immediate residual rescue on the less-filled side,
- rescue failure or `max_unhedged_seconds` breach pauses new openings and alerts,
- both failed legs release the Predict account lock,
- delayed orders are treated as exposure until resolved,
- stale Polymarket CLOB heartbeat or WS liveness pauses new openings,
- no region-bypass logic is permitted.
