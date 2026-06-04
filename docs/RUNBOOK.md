# RUNBOOK

## Local Boot

1. Copy `.env.example` to `.env` and fill non-secret local values.
2. Start PostgreSQL and Redis with `docker compose up -d`.
3. Install dependencies with `pnpm install`.
4. Run checks with `pnpm typecheck` and `pnpm test`.

## Live Trading Gate

Live trading must remain disabled unless:

- compliance/geoblock checks pass,
- Predict JWT/account auth is present for every enabled Predict account,
- Polymarket L1/L2 credentials are loaded from secrets,
- Redis locks are available,
- PostgreSQL audit writes are succeeding,
- dry-run reconciliation has passed,
- Polymarket CLOB heartbeat and market/user WS heartbeats are healthy.

## Pause Conditions

Pause new openings when Polymarket collateral is insufficient, any hedge leg fails and rescue cannot fully repair it, order reconciliation is stale, heartbeat/liveness is stale, geoblock fails, or audit persistence is unavailable.

Every pause must include a machine-readable `reason_code` and human-readable `pause_reason`. Do not resume live trading from a generic or unknown pause without first reconciling orders and positions.

## Runtime Flow

1. Load config, account records, and secret references.
2. Run compliance/geoblock/doctor checks.
3. Discover short-window BTC Up/Down markets on both venues.
4. Reject non-1H, non-Binance BTC/USDT, 4H/daily/target/range, stale, or too-close-to-close markets before the arb engine.
5. Strictly match equivalent market pairs.
6. Subscribe to orderbook WebSockets.
7. Recompute both hedge directions on every fresh book update.
8. Route the executable arb quote through `StrategyEngine`, `HedgeEngine`, and `StrategyRiskEngine`.
9. Preflight balances, allowances, JWT, book freshness, and `secondsToClose`.
10. Lock Predict account and market/execution keys in Redis.
11. Reload books, recompute profit, and submit both orders with FOK/FAK or bounded marketable limits at the quote's worst acceptable prices.
12. Confirm `filled_shares` with REST and WS reports, then persist all raw payloads.
13. If shares differ, immediately rescue the less-filled side with the residual size.
14. Mark `HEDGED`, or enter `RESCUE` / `UNHEDGED` / `PAUSED`.
15. Run periodic position audit, settlement, redeem, reconcile, and Predict account release jobs.

## Execution Safety

- Reject naked `MARKET` orders without a limit-price/slippage cap.
- Cancel open or partial leftovers when configured.
- Release the Predict lock only when both legs fail or dry-run completes.
- Keep a filled Predict leg in `HELD_OPEN`, then `HELD_AWAITING_RESOLUTION`, then `HELD_REDEEMABLE`/`REDEEMING` until settlement/redeem reconciliation.
- Do not release a Predict account just because a 1H event ended.
- Alert and pause when residual rescue fails or `max_unhedged_seconds` is exceeded.

## Monitoring And Alerts

Structured logs must include:

- `event_type`
- `reason_code`
- `hedge_id` when a hedge exists
- `order_id` when an order exists
- `market_pair_id` when a market pair is involved
- `predict_account_id` when a Predict account is selected or blocked
- `pause_reason` whenever new openings are paused

Alert events:

- `UNHEDGED_RESIDUAL`
- `RESCUE_FAILED`
- `ALL_PREDICT_ACCOUNTS_UNAVAILABLE`
- `POLYMARKET_INSUFFICIENT_BALANCE`
- `GEOBLOCK_COMPLIANCE_FAIL`
- `WS_STALE`
- `RECONCILIATION_MISMATCH`
- `AUTH_ERROR`

Metrics to check first:

- `bot_events_total{event_type,reason_code,severity}`
- `orders_submitted_total{venue}`
- `bot_paused{reason_code}`

## Recovery

For `UNHEDGED_RESIDUAL` or `RESCUE_FAILED`:

1. Run `pnpm cli reconcile`.
2. Compare Predict and Polymarket filled shares for the affected `hedge_id`.
3. Confirm whether a residual rescue order exists and whether it filled.
4. If residual remains, keep new openings paused and handle the configured safe rescue method manually.
5. Resume only after DB and venue positions agree.

For `ALL_PREDICT_ACCOUNTS_UNAVAILABLE`:

1. Run `pnpm cli doctor`.
2. Check each Predict account status: `HELD`, `SETTLING`, `AUTH_ERROR`, `DISABLED`, or `INSUFFICIENT`.
3. Do not force-release `HELD` or `SETTLING` accounts before settlement/redeem reconciliation.
4. Fix auth or funding issues, then run balance/position refresh.

For `POLYMARKET_INSUFFICIENT_BALANCE`:

1. Confirm available collateral from the venue.
2. Stop opening new hedges until collateral can fund the Polymarket leg.
3. Run reconcile before resuming, because Polymarket is the single hedge account.

For `GEOBLOCK_COMPLIANCE_FAIL`:

1. Keep live trading disabled.
2. Do not use VPN/proxy/API routing to bypass restrictions.
3. Resume only after a valid compliance/geoblock check passes.

For `WS_STALE`:

1. Confirm market and user WebSocket liveness.
2. Ensure REST fallback polling is active.
3. Do not trade from stale books.
4. Resume only after fresh book timestamps are below `profits.stale_book_ms`.

For `RECONCILIATION_MISMATCH`:

1. Fetch the order from venue REST.
2. Compare venue `filled_shares`, average price, and status with DB.
3. Persist the corrected raw payload.
4. Recompute hedge state before opening new positions.

For `AUTH_ERROR`:

1. Disable only the affected Predict account.
2. Rotate other READY accounts if available.
3. Check JWT/session/private-key configuration without logging secrets.
4. Restore the account only after a successful auth and positions audit.
