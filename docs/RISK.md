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
- `simple_market_maker` is frozen as experimental dry-run only, defaults to disabled, and must not submit orders through the arbitrage execution coordinator,
- `exposure_hedge` is implemented as a dry-run hedge-only core; it emits `EXPOSURE_HEDGE` plans with `dryRun=true` and must not submit orders in v0.2,
- `hedge_arbitrage` and `rebalance_only` are reserved interfaces until separately implemented and tested,
- `min_profit_after_hedge_fee` must pass after the arb engine's fee/buffer checks,
- `max_predict_usage_pct` is a strategy-level guard in addition to the Predict 30% account cap,
- `max_net_exposure_usd` caps aggregate strategy exposure before future hedge modes can open more risk.

Exposure hedge risk:

- `hedge.live_trading_enabled=true` is rejected because v0.2 is dry-run only,
- same-event hedging is required by default through `require_same_event_key=true`,
- correlated hedge candidates are rejected while `allow_correlated_hedge=false`,
- net exposure is calculated as `totalYES - totalNO`,
- positive net exposure can only plan a `NO` hedge; negative net exposure can only plan a `YES` hedge,
- exposure within `hedge.max_net_exposure_usd` is rejected with `exposure_within_limit`,
- missing same-event hedge candidates are rejected with `no_matching_hedge_market`,
- stale market data, spread above `hedge.max_spread`, depth below `hedge.min_depth_usd`, disallowed venues, and hedge sizes outside configured min/max bounds are rejected before a plan is emitted,
- `EXPOSURE_HEDGE` signals are blocked by the execution coordinator even if a malformed caller sets `executable=true`.

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
## Exposure Hedge Risk Checks

`EXPOSURE_HEDGE` is a dry-run planning strategy for reducing Predict net
exposure. It only considers hedge candidates with the same `eventKey` when
`hedge.require_same_event_key` is enabled, and correlated hedge candidates are
disabled by default.

Each plan records `risk.reasonCodes` and a first `rejectReason`. Plans are
rejected when any of the following are true:

- no matching hedge market exists
- candidate `eventKey` does not match the Predict exposure
- market data age exceeds `hedge.max_market_data_age_ms`
- spread exceeds `hedge.max_spread`
- available depth is below `hedge.min_depth_usd`
- requested hedge size exceeds `hedge.max_hedge_order_usd`
- Predict net exposure exceeds `hedge.max_net_exposure_usd`
- calculated hedge size is below `hedge.min_hedge_order_usd`

The hedge size is capped by the smallest of net exposure times
`hedge.hedge_ratio`, `hedge.max_hedge_order_usd`, and available depth times
`hedge.max_depth_usage_pct`.

Execution safety boundary: `EXPOSURE_HEDGE` plans are always dry-run and
non-executable, even if live trading flags are accidentally enabled.
