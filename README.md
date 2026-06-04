# btc-predict-polymarket-hedger

Safety-first skeleton for a BTC binary-market cross-venue hedge bot.

The current implementation is intentionally conservative:

- Matches only strictly equivalent BTC binary markets.
- Builds only complementary buy/buy hedges, one leg on Predict and one leg on Polymarket.
- Accepts up to 10 Predict accounts, while Polymarket uses one unified hedge account.
- Rotates Predict accounts only when the account has no HELD position, no open orders, and enough balance for the trade.
- Caps each Predict account's per-trade notional at 30% of that account's available balance.
- Pauses new openings globally when the single Polymarket account cannot fund the hedge leg.
- Refuses a trade unless expected profit is still positive after taker fees, book impact, slippage reserves, and delay buffers.
- Rejects naked market orders; execution uses FOK/FAK or bounded marketable limits at the quote's worst acceptable price.
- Requires REST + WS fill reconciliation in live mode, rescues residual share mismatches, and pauses new openings when rescue fails or unhedged time exceeds the configured limit.
- Defaults to dry-run. Live trading requires explicit config and real signing/client adapters.
- Performs compliance checks before opening positions. It does not include proxy, VPN, or region-bypass logic.
- Treats Predict fills as `HELD_OPEN -> HELD_AWAITING_RESOLUTION -> HELD_REDEEMABLE -> REDEEMING` until UMA finality and redemption/merge release the account. A challenged resolution keeps the account unavailable longer.

## Recommended Stack

The main implementation path is TypeScript/Node.js:

- Runtime: Node.js 20+, TypeScript, pnpm
- DB: PostgreSQL for orders, positions, account state, market matches, and audit logs
- Cache/locks: Redis for account locks, market locks, execution locks, and short-lived book cache
- Logging: pino
- Money math: decimal.js; do not use JavaScript `number` for prices, sizes, balances, fees, or PnL
- Config/schema: zod
- Tests: vitest
- Local infra: Docker Compose with PostgreSQL and Redis

The Python package under `src/predictfun/` is retained as a reference implementation and regression safety net while the TypeScript version becomes the live-trading track.

## Project Shape

TypeScript live-track structure:

- `src/main.ts` - process entrypoint
- `src/config/` - zod schema, `default.yaml`, and config loader
- `src/strategy/` - StrategyEngine, HedgeEngine, StrategyRiskEngine, dry-run signal strategies, and future hedge/rebalance entrypoints
- `src/hedge/` - dry-run exposure calculation, hedge-market matching, and hedge planning helpers
- `src/risk/` - hedge-specific dry-run risk gates
- `src/core/` - core public modules: types, decimal, orderbook, fee, arb engine, matcher, risk manager, coordinator, rotator, state machine
- `src/adapters/predict/` - Predict client, auth, WS, OrderBuilder, orders, positions, balances, fees, and discovery boundaries
- `src/adapters/polymarket/` - Polymarket Gamma, CLOB, heartbeat, WS market/user, orders, positions, balances, geoblock, and discovery boundaries
- `src/persistence/` - DB pool, migrations, and repositories
- `src/jobs/` - discovery, audit, reconcile, redeem, and balance refresh jobs
- `src/monitoring/` - logger, metrics, and alerts
- `src/cli/` - import, dry-run, doctor, and reconcile commands
- `src/ws/` - WebSocket liveness manager and private order-event reconciliation helpers
- `src/sim/` - deterministic simulator for fixture-driven safety checks
- `tests/unit/` - Vitest unit tests
- `tests/integration/` - adapter integration test placeholders
- `tests/fixtures/` - orderbook and market fixtures
- `docs/` - MVP live scope, runbook, task cards, and risk notes

## MVP Live v1 Scope

The first live version is intentionally narrow. It reads only short-window BTC Up/Down markets, strictly matches equivalent pairs, subscribes or polls fresh orderbooks, computes only the two complementary buy/buy directions, rotates Predict accounts, applies the 30% Predict balance cap, submits bounded FOK/FAK or marketable limit orders, persists every order, reconciles fills, and pauses on exceptions.

Default market scope is exact 1H Binance BTC/USDT Up/Down. Out of scope for v1: multiple Polymarket accounts, maker strategies, statistical arbitrage, fuzzy matching, automatic rescue-loss increases, VPN/proxy/geoblock bypass logic, and trading from best price without walking depth.

The full guardrail checklist and reusable implementation prompt live in `docs/MVP_LIVE_V1.md`; short-window specifics live in `docs/SHORT_WINDOW_BTC.md`.

Reference Python structure:

- `src/predictfun/discovery.py` - Market Discovery across Predict and Polymarket adapters.
- `src/predictfun/adapters.py` - Predict REST/WS/JWT and Polymarket Gamma/Data/CLOB/WS adapter contracts plus static test adapters.
- `src/predictfun/models.py` - common market, order, and book models.
- `src/predictfun/orderbook.py` - Predict YES-based orderbook conversion, including NO-side complements.
- `src/predictfun/matching.py` - strict market-equivalence checks, including oracle/resolution semantics.
- `src/predictfun/scanner.py` - BTC-only market scanner.
- `src/predictfun/fees.py` - binary-market fee estimation helpers.
- `src/predictfun/engine.py` - Arb Engine for the two allowed A/B combos.
- `src/predictfun/risk.py` - opportunity quoting, sizing, and profit gates.
- `src/predictfun/risk_manager.py` - balance-aware risk decisions and Predict account selection.
- `src/predictfun/accounts.py` - Predict account rotation, HELD state, 30% balance cap, and Polymarket funding guard.
- `src/predictfun/compliance.py` - Polymarket geoblock/compliance gate and proxy rejection.
- `src/predictfun/execution.py` - two-leg execution state machine with delayed-order rescue hooks.
- `src/predictfun/clients.py` - interfaces, dry-run clients, and REST read helpers.
- `src/predictfun/coordinator.py` - end-to-end Execution Coordinator.
- `src/predictfun/audit.py` - in-memory and SQLite audit sinks.
- `src/predictfun/alerts.py` - alert sink interfaces and in-memory/console implementations.

## System Architecture

```text
Market Discovery
  Predict Adapter + Polymarket Adapter
    -> Market Matcher
       BTC only, strict equivalence
    -> Arb Engine
       COMBO_A / COMBO_B pricing, fee, depth
    -> Strategy Engine
       pure_arbitrage executable now; dry-run exposure_hedge signal supported
    -> Hedge Engine
       accepted strategy plan into hedge legs
    -> Risk Manager
       balances, 30% Predict cap, Polymarket collateral
    -> Predict Rotator
       up to 10 accounts, one held lifecycle each
    -> Execution Coordinator
       bounded FOK/FAK/limit plan, REST+WS reconcile, rescue/pause
    -> DB + Audit + Alerts
```

`ExecutionCoordinator.run_once()` wires this pipeline together. The adapter contracts keep live REST/WS/JWT/CLOB signing out of the core logic, so the same matcher, engine, risk manager, and executor can be tested with static adapters before live SDK clients are attached.

## Execution Flow

The live-track flow is encoded in `src/execution/flow.ts`:

1. Load config, Predict accounts, Polymarket account, and secret references.
2. Run compliance, geoblock, and doctor checks.
3. Discover Predict and Polymarket BTC markets.
4. Strictly match BTC market pairs by direction, start/end time, resolution source, threshold, price source, and settlement rules.
5. Subscribe to Predict orderbook/asset-price/wallet events and Polymarket market/user WebSocket events.
6. Trigger the Arb Engine on each fresh orderbook update.
7. Evaluate `Predict YES + Polymarket NO` and `Predict NO + Polymarket YES`.
8. If net profit is positive, size shares, rotate Predict account, and preflight balance, allowance, JWT, and book staleness.
9. Lock and submit both venue orders using bounded FOK/FAK or marketable limit requests.
10. Confirm fills with REST and WS reports.
11. Reconcile order reports and compare filled shares.
12. Mark fully hedged trades as `HEDGED`.
13. Rescue the less-filled side on residual mismatches, or pause/alert on rescue failure.
14. Periodically audit positions, settlement, redeem, reconcile balances, and release Predict accounts.

WebSocket notes: Predict orderbook, asset price update, and authenticated wallet events are modeled in `src/adapters/predict/ws.ts`; Predict heartbeat replies echo the server timestamp. Polymarket market/user channel event types are modeled in `src/adapters/polymarket/ws-market.ts` and `src/adapters/polymarket/ws-user.ts`; per current official docs, market/user channels require client `PING` every 10 seconds. Polymarket CLOB order heartbeat is modeled separately in `src/adapters/polymarket/heartbeat.ts`; stale heartbeat is a pause condition because open orders may be cancelled server-side.

Rescue/reconcile notes: residual exposure is handled by `src/execution/rescue.ts`, which caps rescue loss, hedges only residual shares, and pauses new openings when the configured loss/time bounds are exceeded. Restart and settlement recovery live in `src/jobs/`, while `src/ws/order-events.ts` turns private fill/order events into order-record updates.

## Database

The canonical PostgreSQL migration is `src/persistence/migrations/001_init.sql`. It defines:

- `predict_accounts` for the 10-account Predict rotator, encrypted keys, balances, status, and HELD market pair
- `venue_markets` for Predict and Polymarket market snapshots
- `market_pairs` for strict equivalence results
- `hedges` for paired hedge lifecycle and expected/realized PnL
- `orders` for both venue legs, fills, fees, tx/order ids, and raw payloads
- `audit_events` for severity-tagged operational audit records

## Predict Account State Machine

Predict accounts use these live-track states:

- `READY`: tradable, no held position, refreshed balance can fund the order
- `HELD`: Predict position is open and awaiting settlement/redeem
- `INSUFFICIENT`: refreshed balance is below the configured minimum or requested notional
- `AUTH_ERROR`: JWT/signature/private-key/account configuration failed
- `COOLDOWN`: recently selected, filled, failed, or lock contention occurred; skip briefly
- `SETTLING`: market resolved and the account is waiting for confirm/redeem/reconcile
- `DISABLED`: manually disabled

Selection starts at `last_used_index + 1`, skips non-tradable states, refreshes balance, audits unsettled Predict positions, checks min order and required notional, then acquires `predict_account:{id}` in Redis before returning the account. Filled Predict legs move to `HELD`; only confirmed redeem/reconcile releases the account back to `READY`.

## Running Tests

TypeScript live-track checks:

```powershell
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

Use the bundled Python runtime if normal `python` is not on PATH:

```powershell
$PY="C:\Users\byhdo\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$env:PYTHONPATH="C:\Users\byhdo\Documents\predictfun\src"
& $PY -m unittest discover -s tests
```

## Config

The TypeScript app loads `src/config/default.yaml` through `src/config/load-config.ts` and validates it with zod in `src/config/schema.ts`. Secrets belong in environment variables or a secret manager, not in YAML or source code. The YAML stores environment variable names such as `PREDICT_API_KEY`, `POLYMARKET_PRIVATE_KEY`, `DATABASE_URL`, and `REDIS_URL`.

Important defaults:

- `mode` is `dry_run`; `live` must be explicit.
- `strategy.strategy_mode` is `pure_arbitrage`; `simulation_edge`, `simple_market_maker`, and `exposure_hedge` are dry-run signal modes, while `hedge_arbitrage` and `rebalance_only` remain interface-reserved and not live-enabled yet.
- `strategy.hedge_enabled` is `false`; it gates future non-arbitrage hedge modes.
- `strategy.max_net_exposure_usd`, `strategy.max_predict_usage_pct`, and `strategy.min_profit_after_hedge_fee` are strategy-level guards above venue/risk checks.
- `simulation_edge` uses basic Monte Carlo probability, 95% confidence intervals, and conservative edge checks; it emits plans with `executable=false`.
- `simple_market_maker` uses the same lightweight Monte Carlo digital model to produce post-only `BUY YES` and synthetic `YES ask` via `BUY NO` quotes, applies inventory skew and stale/depth/spread gates, and is frozen as experimental dry-run only. It defaults to `enabled=false` and `live_trading_enabled=false`; current Predict execution does not use it.
- `hedge` config enables the v0.2 dry-run exposure hedge core. It defaults to `enabled=true`, `dry_run=true`, `live_trading_enabled=false`, `require_same_event_key=true`, and `allow_correlated_hedge=false`.
- `dry_run` can boot without real trading keys.
- `live` rejects startup unless Predict API key plus Polymarket private key, funder, L2 API key, L2 API secret, and passphrase are present.
- The pino logger redacts private keys, JWTs, API keys, API secrets, tokens, passphrases, and authorization fields.
- `market.asset` is `BTC`, `market.allowed_market_family` is `BTC_UP_DOWN`, and start/end mismatch tolerances are `0`.
- `market.require_exact_1h_window` is `true`, so default discovery rejects 5m/15m/30m/4H/daily/target BTC markets.
- `market.allowed_resolution_sources` defaults to `BINANCE_BTC_USDT`.
- `profits.min_net_profit_usd` is `0.00`, and the comparison is strict: net profit must be greater than this value.
- `risk.predict_wallet_fraction_cap` is `0.30`.
- `profits.min_net_profit_usd` can be `0.00`, but the comparison remains strict: after every fee and buffer, `profit_per_share` and `net_profit_usd` must be positive.
- `risk.predict_min_order_usdt` is `1.00`.
- `risk.per_trade_max_usdt` is `300.00`.
- `execution.order_type` defaults to `FOK`, with parallel submit enabled.
- `execution.post_trade_reconcile_required` is `true`; live fills must be reconciled with REST and WS reports before final `HEDGED`.
- `jobs.market_discovery_interval_ms` is `15000`, and orderbook REST fallback is `1000` ms.
- `liveness.polymarket_clob_heartbeat_interval_ms` is `5000` and timeout is `15000`.
- Predict request throttling is set to `240` requests per minute.

## Arbitrage Logic

Only two buy/buy combinations are generated:

- `COMBO_A`: buy Predict YES and buy Polymarket NO.
- `COMBO_B`: buy Predict NO and buy Polymarket YES.

For a candidate size, the quote calculates:

```text
net_cost_per_share =
  predict_effective_price
+ polymarket_effective_price
+ gas_or_fixed_cost_per_share
+ rounding_buffer_per_share

profit_per_share = 1 - net_cost_per_share
net_profit_usd = shares * profit_per_share - fixed_costs_usd
```

`predict_effective_price` and `polymarket_effective_price` already include taker fee estimates, consumed orderbook depth, slippage reserve, and latency reserve. The trade is rejected unless both `profit_per_share > 0` and `net_profit_usd > min_net_profit_usd`.

The strategy layer then treats the result as `pure_arbitrage`. `simulation_edge` and `simple_market_maker` are registered as dry-run signal-only strategies, and future executable hedge modes are routed through `StrategyEngine` / `HedgeEngine` / `StrategyRiskEngine` instead of being hard-coded into the execution coordinator.

## Exposure Hedge v0.2

`exposure_hedge` is the current hedge-only core and remains dry-run only. It measures Predict inventory by event:

```text
netExposureUsd = totalYES - totalNO
```

Positive net exposure plans a Polymarket `NO` hedge; negative net exposure plans a `YES` hedge. The first version only matches candidate hedge markets with the same `eventKey`; correlated hedge markets are rejected.

The dry-run hedge size is:

```text
min(
  abs(netExposureUsd) * hedge_ratio,
  max_hedge_order_usd,
  candidate.depthUsd * max_depth_usage_pct
)
```

The planner rejects disabled hedge mode, live hedge mode, stale market data, wide spread, shallow depth, too-small or too-large hedge size, event-key mismatch, and disallowed venues. Even if a caller marks an `EXPOSURE_HEDGE` signal as executable, the execution coordinator refuses to place an order for it in v0.2.

## Order Sizing

The sizing helper first finds profitable orderbook depth, then chooses the minimum of:

- profitable depth available on both books
- selected Predict account free balance times `0.30`, divided by Predict effective price
- Polymarket available collateral divided by Polymarket effective price
- `per_trade_max_usd` divided by combined per-share cost
- venue min/max constraints such as Polymarket `min_order_size`, `tick_size`-derived limits, or configured notional caps

Predict insufficiency only skips that Predict account and rotates to the next one. Polymarket insufficiency pauses new openings because there is only one hedge account.

## Matching Rules

The scanner filters to short-window BTC Up/Down markets before the arb engine. The hourly matcher then requires exact 1H cadence, identical start/end time, `BINANCE_BTC_USDT` or another explicit allowlisted source, matching price-feed provider/symbol, matching Up/Down rule, binary payout semantics, and open/tradable status on both venues. A condition-id link can help identify a candidate pair, but it does not override these checks.

## Account States

Predict accounts move through `READY`, `HELD_OPEN`, `HELD_AWAITING_RESOLUTION`, `HELD_REDEEMABLE`, `REDEEMING`, `INSUFFICIENT`, `AUTH_ERROR`, `COOLDOWN`, and `DISABLED`. Legacy `HELD` and `SETTLING` are still treated as unavailable for compatibility. A filled Predict leg enters `HELD_OPEN`, moves to `HELD_AWAITING_RESOLUTION` after event end, and returns to `READY` only after actual resolved/redeemed/flat reconciliation. This models UMA optimistic-oracle challenges: an unchallenged market may release after the challenge window, while a disputed market remains unavailable longer.

## Live Trading Boundary

This repository does not sign orders directly. Predict order creation requires JWT plus signed SDK order payloads, and Polymarket CLOB trading requires wallet signing and L2 HMAC headers. Wire those through the client interfaces in `src/predictfun/clients.py` after validating the official SDK versions you run in production.
