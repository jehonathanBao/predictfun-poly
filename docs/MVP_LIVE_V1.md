# MVP Live v1 Scope

This document defines the smallest live-trading loop allowed for the first production version. Anything outside this scope should stay behind explicit future task cards.

## In Scope

MVP Live v1 includes only this closed loop:

- Read short-window BTC Up/Down markets from Predict and Polymarket.
- Strictly match only equivalent exact 1H BTC Up/Down markets by start/end, source, symbol, and rule.
- Subscribe to orderbooks and fall back to polling when WebSockets are disconnected.
- Compute the two complementary directions:
  - Predict YES + Polymarket NO
  - Predict NO + Polymarket YES
- Rotate up to 10 Predict accounts.
- Enforce the 30% Predict free-balance cap per selected account.
- Use bounded FOK/FAK or marketable limit orders on both venues.
- Persist every hedge and order leg before and after execution.
- Reconcile orders and positions after execution and after restart.
- Pause new openings on execution exceptions, residual mismatch, stale books, compliance failure, or insufficient Polymarket collateral.

## Out Of Scope

Do not implement these in MVP Live v1:

- Multiple Polymarket accounts.
- Maker/order-posting strategies.
- Statistical arbitrage.
- Fuzzy or "looks similar" market matching.
- Automatic increases to `rescue_max_loss_usd`.
- VPN, proxy, region-routing, or any geoblock bypass logic.
- Trading from best price only; depth walking is mandatory.

## Non-Negotiable Gates

Even if an opportunity appears to make `0.001` USD, it must still pass every gate:

- Strategy mode for live execution is `pure_arbitrage` until hedge modes are explicitly implemented and tested; `simulation_edge` and `simple_market_maker` are dry-run signal-only.
- Market pair is strict-equivalent BTC only.
- Market pair passes the short-window BTC filter before entering the arb engine.
- Net profit remains strictly positive after fees, orderbook depth, slippage, latency, tick rounding, and fixed costs.
- Selected Predict account is not `HELD`, `SETTLING`, `AUTH_ERROR`, `DISABLED`, or locked by another execution.
- Predict notional is within 30% of that account's free USDT balance.
- Both Predict and Polymarket balances can fund their respective legs.
- Orderbooks are fresh under `profits.stale_book_ms`.
- Compliance/geoblock checks pass without bypass logic.
- Orders are bounded FOK/FAK or marketable limits; naked market orders are rejected.
- Residual share mismatches enter rescue or pause, never silent continuation.
- Predict accounts are not released merely because the 1H event ended; actual resolved/redeemed/flat state is required.

## Master Codex Prompt

Use this prompt when starting a fresh implementation thread:

```text
You are building a production-grade TypeScript trading bot named btc-predict-polymarket-hedger.

The bot hedges equivalent BTC binary prediction markets between Predict.fun and Polymarket.

Hard requirements:
1. Only short-window BTC Up/Down markets.
2. Default market window must be exact 1H: eventEndTs - eventStartTs = 3600 seconds.
3. Only trade exact equivalent markets: same asset, same start/end, same threshold/direction, same resolution source, same price feed provider/symbol, same Up/Down rule.
4. Resolution source must be allowlisted, default BINANCE_BTC_USDT.
5. Reject 4H, daily, weekly, price target, range, monthly, and yearly BTC markets.
6. Predict side has up to 10 accounts.
7. Polymarket side has exactly 1 account.
8. Each Predict account may have only one unresolved position at a time.
9. Each Predict account's max trade notional is 30% of its free USDT balance.
10. If a Predict account is held or insufficient, rotate to the next account.
11. If Polymarket account is insufficient, globally pause new trades.
12. Only trade if net profit is > 0 after fees, slippage, latency buffer, tick rounding, and fixed costs.
13. Use Decimal math only. Never use JS number for money.
14. Use dry_run mode by default.
15. Never log private keys, JWTs, API secrets, or signatures.
16. Do not release a Predict account when the 1H event ends. Release only after actual resolved/redeemable/redeemed/flat state.
17. Before submitting orders, reload books, recompute secondsToClose, rerun risk checks, and rerun arbitrage calculation.
18. Implement robust order reconciliation and residual rescue.
19. If one side fills and the other does not, pause or rescue according to config.
20. Add tests for market matching, account rotation, risk checks, orderbook depth, and partial fills.
21. Keep arbitrage execution behind StrategyEngine / HedgeEngine / RiskEngine layers. Current implementation may only execute pure_arbitrage; simulation_edge and simple_market_maker are dry-run signal-only, while hedge_arbitrage, exposure_hedge, and rebalance_only must remain explicit non-executing modes until implemented.

Use the project structure and task cards from docs/TASK_CARDS.md.
Implement S01, H01, H04, H05, H06, T07, T08, T09, and T15 before real venue adapters.
```

## Development Order

Phase 1: offline core

- T00 initialization
- T01 config
- T02 Decimal helpers
- S01 strategy / hedge / risk engine abstraction
- S02 simulation edge dry-run strategy
- H01 short-window BTC market filter
- H04 hourly BTC market matcher
- H05 time-aware risk manager
- H06 held until actual redemption
- T06 market matcher
- T07 arb engine
- T08 account rotator
- T09 risk manager
- T15 tests and simulator

Phase 2: read-only adapters

- H02 Polymarket hourly BTC discovery
- H03 Predict hourly BTC discovery
- T04 Predict read-only markets, orderbooks, positions, balances
- T05 Polymarket read-only markets, books, positions, balances
- T13 WebSocket manager
- T14 doctor and dry-run CLI

Phase 3: dry-run execution

- T10 Execution Coordinator in `dry_run`
- T12 reconcile jobs
- T16 monitoring, alerts, and runbook

Phase 4: small live trading

- H07 short-window execution guard
- T03 Predict auth
- T04 Predict live order submission
- T05 Polymarket auth and live order submission
- T11 residual rescue
- T12 settlement, redeem, and Predict account release
