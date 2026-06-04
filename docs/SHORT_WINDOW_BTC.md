# Short-Window BTC Up/Down Strategy

The bot is now scoped to short-window BTC Up/Down markets only. MVP live trading should not scan or trade all BTC markets.

## Definition

Eligible markets must satisfy every rule:

- asset is `BTC`
- family is `BTC_UP_DOWN`
- default cadence is exact `HOURLY`
- `eventEndTs - eventStartTs = 3600` seconds when `require_exact_1h_window=true`
- market ends within `discovery_lookahead_seconds`
- order submission still has at least `min_seconds_to_close`
- resolution source is allowlisted, default `BINANCE_BTC_USDT`
- price feed provider, symbol, start/end, and Up/Down rule match exactly across venues
- both venues are tradable and accepting orders

Rejected families:

- `BTC_4H_UP_DOWN`
- `BTC_DAILY_UP_DOWN`
- `BTC_PRICE_TARGET`
- `BTC_RANGE`
- `BTC_MONTHLY`
- `BTC_YEARLY`

## Settlement Boundary

The 1H window means the market event ends within one hour. It does not mean Predict funds unlock within one hour.

Predict accounts remain unavailable until venue state confirms resolved/redeemable/redeemed/flat. The account lifecycle is:

- `READY`
- `HELD_OPEN`
- `HELD_AWAITING_RESOLUTION`
- `HELD_REDEEMABLE`
- `REDEEMING`
- `READY`

Do not release an account just because `eventEndTs` has passed.

## Runtime Cadence

Recommended first pass:

- market discovery every `15000` ms
- orderbook REST fallback every `1000` ms when WS is disconnected
- account refresh every `10000` ms
- order reconciliation every `5000` ms
- settlement/redeem checks every `30000` ms

## Execution Guard

Before submitting orders:

1. Acquire locks.
2. Reload the market pair.
3. Reload latest orderbooks.
4. Recompute `secondsToClose`.
5. Reject if `secondsToClose < min_seconds_to_close`.
6. Recompute arbitrage and profit.
7. Reject if profit is no longer strictly positive.
8. Submit only FOK/FAK or bounded marketable limit orders.
9. Reconcile immediately.

## Strategy Boundary

Current short-window live trading runs as `pure_arbitrage` only. The strategy layer is split into:

- `StrategyEngine`: selects the active mode.
- `HedgeEngine`: converts accepted strategy output into hedge legs.
- `StrategyRiskEngine`: checks strategy-level exposure, Predict usage, and profit-after-hedge-fee guards.

`simulation_edge` is registered as a dry-run signal-only strategy. It runs basic Monte Carlo, computes a conservative edge from the 95% confidence interval, and returns `executable=false`.

`simple_market_maker` is also registered as a dry-run signal-only strategy. It runs a lightweight Monte Carlo digital model, blends model fair probability with observed YES mid, widens spread by uncertainty and buffers, applies inventory skew, and emits post-only `BUY YES` / `BUY NO` quote plans without submitting orders.

Reserved executable hedge modes are `hedge_arbitrage`, `exposure_hedge`, and `rebalance_only`. They must not execute live orders until their own task cards and tests are complete.

## First Live Parameters

Default config keeps the user-provided short-window settings. A more conservative first live override is:

```yaml
strategy:
  strategy_mode: "pure_arbitrage"
  hedge_enabled: false
  max_net_exposure_usd: "0.00"
  max_predict_usage_pct: "0.30"
  min_profit_after_hedge_fee: "0.00"

simulation_edge:
  sigma: 0.2
  min_edge: 0.01
  max_order_usd: 10
  paths: 100000

simple_market_maker:
  live_trading_enabled: false
  max_order_usd: 5
  max_inventory_usd: 25

market:
  require_exact_1h_window: true
  discovery_lookahead_seconds: 3600
  min_seconds_to_close: 120
  allowed_resolution_sources:
    - "BINANCE_BTC_USDT"

profits:
  slippage_buffer_bps: 10
  latency_buffer_bps: 10
  stale_book_ms: 400

risk:
  predict_wallet_fraction_cap: "0.30"
  per_trade_max_usdt: "100.00"
  max_unhedged_seconds: 2
  rescue_max_loss_usd: "2.00"
```
