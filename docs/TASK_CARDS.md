# TASK CARDS

## T00 - 初始化仓库

目标：创建 TypeScript Node.js 20 项目骨架、lint、test、Docker Compose。

Codex 指令：

- Create a TypeScript Node.js 20 project named `btc-predict-polymarket-hedger`.
- Use pnpm, tsx for dev runtime, vitest for tests, zod for config validation, pino for logging, decimal.js for money math.
- Create the folder structure exactly as described in docs.
- Add `docker-compose.yml` with PostgreSQL and Redis.
- Add `.env.example`.
- Do not implement real trading yet.

验收标准：

- `pnpm install`
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `docker compose up -d`

## T01 - 配置与密钥管理

目标：实现配置加载、schema 校验、密钥不落日志。

Codex 指令：

- Implement `src/config/schema.ts` and `src/config/load-config.ts`.
- Use zod to validate `default.yaml` plus environment variables.
- Support `mode=dry_run/live`.
- Reject startup if required live keys are missing.
- Mask all secrets in logs.
- Add tests for valid config, missing config, invalid numeric strings.

验收标准：

- `dry_run` 可无真实私钥启动。
- `live` 模式缺私钥直接失败。
- 日志中不出现 private key、jwt、api secret、api key。

## T02 - 通用 Decimal 金额库

目标：所有价格、份额、金额计算禁止使用 JS 浮点。

Codex 指令：

- Implement `src/core/decimal.ts`.
- Wrap `decimal.js` with Money, Price, Shares helper functions.
- Add helpers: `D(value)`, `minD/maxD`, `floorToTick(value, tick)`, `ceilToTick(value, tick)`, `bps(value, bps)`, `gtZeroAfterFees(value)`.
- Add unit tests for rounding, tick size, bps, min/max.

验收标准：

- `0.1 + 0.2` 不出现 JS 浮点误差。
- 所有 arb-engine 测试只使用 Decimal 类型。

## T03 - Predict Adapter：认证与账户

目标：支持最多 10 个 Predict 账户导入、JWT 获取/刷新、账户状态查询。

要点：EOA 与 Smart Wallet/Predict Account 路径、auth message 签名换 JWT、refresh-before-expiry、加密 `predict_accounts.enc.json` loader、每账户独立 session、单账户认证失败不影响其他账户、禁止日志输出私钥/JWT。

## T04 - Predict Adapter：市场、盘口、订单、仓位

目标：封装 Predict 市场发现、YES 基准 orderbook、下单、仓位、余额和费用估算。

要点：`listBtcMarkets()`、`getOrderbook()`、`subscribeOrderbook()`、`getPositions()`、`getFreeBalance()`、`createFokOrMarketableLimitOrder()`、`cancelOrder()`、`estimatePredictFee()`；核心层只看到标准化的买 YES/买 NO levels；dry-run 不发真实请求。

## T05 - Polymarket Adapter：认证、市场、盘口、订单、仓位

目标：封装 Polymarket Gamma/Data/CLOB、market/user WS、geoblock 与 heartbeat。

要点：Gamma market 映射 YES/NO token id；CLOB book 标准化 asks、`min_order_size`、`tick_size`；dry-run 不真实下单；geoblock blocked 时 live 模式拒绝启动。

## T06 - BTC Market Matcher

目标：只匹配完全等价的 BTC 二元市场，拒绝模糊匹配。

要点：资产 BTC、二元 YES/NO、start/end 完全一致、threshold/direction 一致、resolution source/oracle 一致或显式 allowlist、timezone 解释一致；输出 `EXACT` 或机器可读拒绝原因。

## T07 - Orderbook Depth 与套利计算

目标：按真实可成交深度计算 `COMBO_A` 与 `COMBO_B`，不只看 best ask。

要点：逐层吃盘口、计算加权均价、费用、slippage/latency/fixed cost/rounding buffer；扣完所有成本后 `profit_per_share > 0` 且 `net_profit_usd > min_net_profit_usd` 才返回机会。

## T08 - Predict Account Rotator

目标：实现最多 10 个 Predict 账户轮动。

要点：round-robin、跳过 HELD/SETTLING/AUTH_ERROR/DISABLED、选择前刷新余额和未结算仓位、单账户 30% 余额 cap、余额不足只标记该账户并继续、返回前获取 Redis 锁、并发不能选中同一账户。

## T09 - Risk Manager

目标：统一执行所有资金、持仓、合规、盘口和利润风控。

要点：market pair active、市场未临近关闭、orderbook 未过期、Predict 30% cap 和 1 USDT minimum、Polymarket collateral sufficient、无 unhedged residual、无 global pause、无 geoblock/compliance failure、净利润扣 buffer 后仍为正；返回 APPROVED 或机器可读 REJECTED。

## T10 - Execution Coordinator

目标：两边下单、确认、补救、暂停、重启恢复对账。

要点：获取 `market_pair:{id}`、`predict_account:{id}`、`polymarket_wallet` 锁；重读盘口并重跑 engine/risk；创建 hedge/orders 审计记录；按 `parallel_submit` 下单；等待 `max_fill_wait_ms`；REST+WS reconcile；完全对冲标记 HEDGED 并让 Predict 账户 HELD；单边/部分成交进入 rescue/pause；异常不能丢订单状态。

## T11 - Rescue 残差补救

目标：避免裸露仓位扩大。

要点：`rescueResidual(hedge)` 处理 Predict filled/Polymarket missing、Polymarket filled/Predict missing、partial mismatch；只补 residual shares；尊重 `rescue_max_loss_usd`、`max_unhedged_seconds`、`pause_on_unhedged_residual`；补救失败后全局暂停新开仓。

验收标准：

- 残差不被忽略。
- 超过 `rescue_max_loss_usd` 不继续扩大亏损。
- 补救失败后全局暂停新开仓。

## T12 - Reconcile、Settlement、释放 Predict 账户

目标：持续核对仓位，结算后释放 Predict 账户。

要点：实现 `audit-positions.ts`、`reconcile-orders.ts`、`redeem-settled.ts`、`refresh-balances.ts`；定时查询 Predict/Polymarket positions，比对 DB expected state 与 venue actual state；更新 hedge/order 状态；Predict position resolved/redeemed/flat 后释放账户；mismatch 写 audit event 并报警。

验收标准：

- Bot 重启后能恢复账户 HELD 状态。
- Predict 持仓结算前不会重复使用该账户。
- 结算后账户可重新进入轮动。

## T13 - WebSocket Manager

目标：实时接收盘口与私有订单事件。

要点：subscribe/unsubscribe、heartbeat/pong、reconnect with backoff、stale data detection、event deduplication、sequence/timestamp checks、WS disconnected 时 fallback REST polling。

验收标准：

- WS 断开后自动重连。
- stale book 不触发交易。
- 私有成交事件能更新 orders 表。

## T14 - CLI 工具

目标：方便导入账户、检查环境、模拟运行。

要点：`pnpm cli import-predict-accounts --file accounts.csv`、`pnpm cli import-polymarket-account`、`pnpm cli doctor`、`pnpm cli dry-run --market BTC`、`pnpm cli reconcile`；doctor 输出 DB/Redis/API/geoblock/account/balance/unresolved/live readiness。

## T15 - 测试与模拟器

目标：不靠真金白银测试套利逻辑。

要点：fixtures 和 deterministic simulator 覆盖 market matching、YES/NO book conversion、CLOB parsing、fee、depth walking、account rotation、risk rejection、partial fill、rescue failure、restart reconciliation；模拟 1000 次随机盘口更新不违反 HELD 账户、30% cap、正利润、Polymarket 资金约束。

## T16 - 监控、报警、Runbook

目标：实盘时能知道 Bot 为什么停、哪里裸露、哪个账户占用。

要点：structured logs、metrics counters、telegram/webhook alerts、`docs/RUNBOOK.md`；告警覆盖 `UNHEDGED_RESIDUAL`、`RESCUE_FAILED`、`ALL_PREDICT_ACCOUNTS_UNAVAILABLE`、`POLYMARKET_INSUFFICIENT_BALANCE`、`GEOBLOCK_COMPLIANCE_FAIL`、`WS_STALE`、`RECONCILIATION_MISMATCH`、`AUTH_ERROR`。

验收标准：

- 每次拒绝交易都有 reason code。
- 每次下单有 `hedge_id/order_id`。
- 每次暂停有明确 `pause_reason`。
- Runbook 写明如何恢复。

## Adapter Wiring

- Implement Predict REST market discovery and YES-based orderbook parsing.
- Implement Predict JWT account actions and SDK OrderBuilder integration.
- Implement Predict positions audit by wallet, including amount, valueUsd, avgBuyPrice, pnl, outcome, and market status.
- Implement Polymarket Gamma/Data/CLOB discovery, book reads, balances, and geoblock.
- Add WS market/user streams for both venues.

## Execution Hardening

- Add Redis account, market, and execution locks.
- Persist every planned order before submit.
- Reject naked market orders and cap all buy limits at the quote's worst acceptable price.
- Reconcile live/matched/delayed/unmatched states.
- Require REST + WS fill confirmation before final `HEDGED`.
- Rescue residual share mismatches by topping up the less-filled side.
- Pause and alert when rescue fails or `max_unhedged_seconds` is exceeded.
- Alert on any unhedged or delayed exposure.
- Wire Predict orderbook, asset price, and wallet-event WebSockets.
- Wire Polymarket market and user WebSockets with 10 second client PING heartbeats.
- Wire Polymarket CLOB heartbeat and pause openings if it becomes stale.

## Settlement

- Track Predict HELD positions through UMA finality.
- Keep challenged markets locked until final and redeemable.
- Release Predict accounts only after redeem/merge is confirmed.

## MVP Live v1 Scope

第一版 live 只做一个最小闭环：

- 只读短周期 BTC Up/Down markets。
- 严格匹配 Predict / Polymarket 等价市场。
- 订阅或轮询盘口。
- 只计算两个互补方向：Predict YES + Polymarket NO、Predict NO + Polymarket YES。
- Predict 账户轮动。
- Predict 单账户 30% 资金上限。
- 两边都用 FOK/FAK 或 bounded marketable limit。
- hedge/order 全量入库。
- 对账。
- 异常暂停新开仓。

暂时不要做：

- 多个 Polymarket 账户。
- 做市挂单。
- 统计套利。
- 模糊市场匹配。
- 自动提高亏损补救上限。
- VPN、代理或地区限制绕过逻辑。
- 只看 best price 不看深度。

关键验收线：即使发现 `0.001` USD 利润，也不能绕过净利润计算、账户 `HELD` 检查、30% 资金上限、两边余额检查、盘口时效检查和合规检查。

## Development Order

第 1 阶段：纯离线核心

- S01 Strategy / Hedge / Risk Engine 抽象
- S02 Simulation Edge Dry-Run Strategy
- S03 Simple Market Maker Dry-Run Strategy
- H01 Short Window BTC Market Filter
- H04 Hourly BTC Market Matcher
- H05 Time-Aware Risk Manager
- H06 Held Until Actual Redemption
- T00 初始化仓库
- T01 配置
- T02 Decimal
- T06 Market Matcher
- T07 Arb Engine
- T08 Account Rotator
- T09 Risk Manager
- T15 测试模拟器

第 2 阶段：只读接入

- H02 Polymarket Hourly BTC Discovery
- H03 Predict Hourly BTC Discovery
- T04 Predict 只读：markets/orderbook/positions/balances
- T05 Polymarket 只读：markets/books/positions/balances
- T13 WebSocket Manager
- T14 doctor/dry-run CLI

第 3 阶段：dry-run 执行

- T10 Execution Coordinator dry_run
- T12 Reconcile jobs
- T16 Monitoring

第 4 阶段：小额 live

- H07 Short-Window Execution Guard
- T03 Predict 真实认证
- T04 Predict 真实下单
- T05 Polymarket 真实认证/下单
- T11 Rescue
- T12 Settlement/redeem

## H01 - Short Window BTC Market Filter

目标：只允许 1 小时内 BTC Up/Down 市场进入系统。

要点：`src/core/short-window-market-filter.ts` 返回 `APPROVED` 或 `REJECTED`，拒绝非 BTC、非 `BTC_UP_DOWN`、缺少 start/end、非 exact 1H、窗口过长、太早、太接近结束、非 allowlisted resolution source、不可交易市场。

验收标准：

- 4H BTC Up/Down 被拒绝。
- Daily BTC Up/Down 被拒绝。
- BTC price target 被拒绝。
- 1H Binance BTC/USDT Up/Down 通过。
- 距离结束小于 90 秒被拒绝。
- 没有 start/end 字段被拒绝。

## H02 - Polymarket Hourly BTC Discovery

目标：从 Polymarket 只提取 BTC hourly markets。

要点：Gamma/CLOB 原始字段标准化为 `NormalizedMarket`，读取 `condition_id`、`enable_order_book`、`active`、`closed`、`accepting_orders`、`end_date_iso`、`game_start_time`、`tokens`、`seconds_delay`、`minimum_order_size`、`minimum_tick_size`；优先结构化字段，title/rules 只做 fallback。

验收标准：

- 能识别 Bitcoin Up or Down Hourly。
- 能拒绝 BTC 4H Up/Down。
- 能拒绝 BTC price above/target 市场。
- 输出 `family = BTC_UP_DOWN`。
- 输出 `cadence = HOURLY`。
- 输出 `resolutionSource = BINANCE_BTC_USDT`。

## H03 - Predict Hourly BTC Discovery

目标：从 Predict 只提取 BTC 1H Up/Down markets。

要点：从 `GET /v1/markets` 响应解析 `id`、`title`、`question`、`description`、`tradingStatus`、`status`、`resolution`、`oracleQuestionId`、`conditionId`、`polymarketConditionIds`、`marketVariant`、`variantData`、`outcomes`；缺时间或 resolution source 时不得进入套利引擎。

## H04 - Hourly BTC Market Matcher

目标：只匹配完全相同的 1H BTC 市场。

要点：`src/core/hourly-btc-market-matcher.ts` 要求两边 `family = BTC_UP_DOWN`、`cadence = HOURLY`、start/end 完全一致、resolution source/provider/symbol 完全一致、Up/Down rule 完全一致；`polymarketConditionIds` 只能做候选 hint，不能替代严格校验。

## H05 - Time-Aware Risk Manager

目标：把剩余时间纳入风控。

要点：检查 `secondsToClose >= min_seconds_to_close`、`secondsToClose <= discovery_lookahead_seconds`、盘口时间戳不超过 `stale_book_ms`、市场仍接受订单、`seconds_delay` 相对剩余时间不过高。

## H06 - Held Until Actual Redemption

目标：1H 市场结束后，Predict 账户不能自动释放，要等真实结算/赎回。

状态：`READY`、`HELD_OPEN`、`HELD_AWAITING_RESOLUTION`、`HELD_REDEEMABLE`、`REDEEMING`、`INSUFFICIENT`、`AUTH_ERROR`、`DISABLED`。旧 `HELD`/`SETTLING` 仅保留兼容，不作为新流程目标状态。

验收标准：

- 1 小时结束后账户仍不自动 `READY`。
- resolved 前不会开第二单。
- redeem 成功且 position 归零后才 `READY`。
- bot 重启后能从 DB 恢复 HELD 状态。

## H07 - Short-Window Execution Guard

目标：1 小时盘执行前强制重新确认盘口和时间。

要点：锁后重新加载 market pair 和 orderbook，重新计算 `secondsToClose` 和套利利润，若剩余时间不足、盘口过期、利润不再为正、订单类型为裸 `MARKET`，立即拒绝并写 audit/order 状态。

## S01 - Strategy / Hedge / Risk Engine 抽象

目标：不要把套利执行逻辑硬编码在单个执行脚本里，为后续对冲策略预留接口。

配置字段：

- `strategy.strategy_mode`: `pure_arbitrage`、`simulation_edge`、`simple_market_maker`、`hedge_arbitrage`、`exposure_hedge`、`rebalance_only`
- `strategy.hedge_enabled`
- `strategy.max_net_exposure_usd`
- `strategy.max_predict_usage_pct`
- `strategy.min_profit_after_hedge_fee`

要点：

- `StrategyEngine` 负责模式分发。
- `HedgeEngine` 负责把策略结果转换为交易腿。
- `StrategyRiskEngine` 负责净敞口、Predict 使用率、hedge fee 后利润检查。
- 当前只允许 `pure_arbitrage` 返回可执行计划。
- `simulation_edge` 只返回 dry-run signal，`executable=false`。
- `simple_market_maker` 只返回 dry-run 做市报价 signal，默认 `live_trading_enabled=false`。
- `hedge_arbitrage`、`exposure_hedge`、`rebalance_only` 必须返回明确拒绝原因，不能静默执行。

验收标准：

- `pure_arbitrage` 能生成 Predict/Polymarket 两条互补买入腿。
- `min_profit_after_hedge_fee` 不通过时拒绝。
- 非 pure 模式未实现时拒绝且不下单。

## S02 - Simulation Edge Dry-Run Strategy

目标：实现简化版 `simulation_edge` 策略，只输出 Monte Carlo edge 信号，不真实下单。

要点：

- `src/strategy/simulation-edge.ts`
- 基础 GBM Monte Carlo。
- 输出 `fairProbability`、`ci95`、`conservativeEdge`。
- conservative edge 用 95% CI 下界/上界计算。
- 只在 `edge >= min_edge` 时给出 `YES` 或 `NO` signal。
- `executable=false`，不得进入真实下单流程。

验收标准：

- 有明显 conservative edge 时输出方向、限价、size。
- 无 edge 时输出 `No conservative edge`。
- `StrategyEngine` 能通过 `strategy_mode=simulation_edge` 注册并返回 dry-run signal。

## S04 - Exposure Hedge Dry-Run Core

Goal: keep `simple_market_maker` frozen and add a hedge-only dry-run core for existing Predict exposure.

Scope:

- Keep `simple_market_maker.enabled=false` and `simple_market_maker.live_trading_enabled=false` by default.
- Preserve execution-guard tests for `SIMPLE_MARKET_MAKER_QUOTES`.
- Use existing `strategy.strategy_mode=exposure_hedge`; do not introduce a new market-making strategy name.
- Implement `src/strategy/exposure-hedge.ts`, `src/hedge/exposure-calculator.ts`, `src/hedge/hedge-planner.ts`, `src/hedge/hedge-market-matcher.ts`, and `src/risk/hedge-risk.ts`.
- First version is dry-run only and returns action type `EXPOSURE_HEDGE`, `executable=false`, and `dryRun=true`.

Exposure rules:

- YES exposure is positive; NO exposure is negative.
- `netExposureUsd = totalYES - totalNO`.
- Reject exposure inside the configured limit with `rejectReason="exposure_within_limit"`.
- Positive net exposure hedges with `NO`; negative net exposure hedges with `YES`.
- Hedge size is `min(abs(netExposureUsd) * hedge_ratio, max_hedge_order_usd, candidate.depthUsd * max_depth_usage_pct)`.
- v0.2 requires the same `eventKey`; `allow_correlated_hedge=false`.
- Missing same-event candidates reject with `rejectReason="no_matching_hedge_market"`.

Risk gates:

- Reject when hedge mode is disabled.
- Reject `hedge.live_trading_enabled=true`; v0.2 is not live hedge.
- Reject stale data, too-wide spread, shallow depth, hedge size below min, hedge size above max, event-key mismatch, and venue not allowed.
- `ExecutionCoordinator` must not call `placeOrder` for `EXPOSURE_HEDGE`, even if the signal is malformed with `executable=true`.

Acceptance:

- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`

## S03 - Simple Market Maker Dry-Run Strategy

目标：实现简化版 `simple_market_maker` 策略，只输出双边做市报价计划，不真实下单。

要点：

- `src/modeling/monte-carlo-digital.ts`
- `src/strategy/simple-market-maker.ts`
- 用 Monte Carlo digital model 估算 YES fair probability 和 95% CI。
- 用盘口 YES mid 对模型 fair price 做轻微锚定。
- 根据 CI 宽度、fee/slippage buffer 放宽 spread。
- 根据 YES/NO 库存净敞口做 inventory skew。
- 生成 post-only `BUY YES` 和用 `BUY NO` 合成的 YES ask。
- stale market data、深度不足、临近到期、observed spread 过宽时拒绝。
- 默认 `live_trading_enabled=false`，不得进入真实下单流程。

验收标准：

- dry-run 默认输出 `orders: [BUY YES, BUY NO]` 且 `executable=false`。
- `live_trading_enabled=true` 时策略信号可标记 `executable=true`，但当前执行协调器仍不得提交订单。
- YES 库存到上限时只报价 NO。
- stale/过宽盘口能返回明确 reason code。
