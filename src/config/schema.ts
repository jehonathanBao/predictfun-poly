import { z } from "zod";
import { d, type D } from "../domain/money.js";
import { redactSecrets } from "./secrets.js";

const decimalString = z
  .string()
  .min(1)
  .superRefine((value, context) => {
    try {
      const parsed = d(value);
      if (!parsed.isFinite()) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "must be a finite decimal string" });
      }
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "must be a valid decimal string" });
    }
  })
  .transform(d);

const decimalValue = z.union([z.string().min(1), z.number()]).superRefine((value, context) => {
  try {
    const parsed = d(value);
    if (!parsed.isFinite()) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "must be a finite decimal value" });
    }
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "must be a valid decimal value" });
  }
}).transform(d);

export const rawConfigSchema = z.object({
  mode: z.enum(["dry_run", "live"]).default("dry_run"),
  dashboard: z.object({
    enabled: z.boolean().default(true),
    port: z.number().int().positive().default(3070),
    frontend_port: z.number().int().positive().default(5173),
    read_only: z.literal(true).default(true),
    stale_data_threshold_ms: z.number().int().positive().default(10_000),
    dry_run_history_limit: z.number().int().positive().default(100),
    dry_run_summary_enabled: z.boolean().default(true),
    alerts_enabled: z.boolean().default(true),
    max_exposure_alert_usd: z.number().positive().default(25),
    reject_reason_spike_threshold: z.number().int().positive().default(10),
    risk_code_spike_threshold: z.number().int().positive().default(10),
    report_enabled: z.boolean().default(true)
  }).default({
    enabled: true,
    port: 3070,
    frontend_port: 5173,
    read_only: true,
    stale_data_threshold_ms: 10_000,
    dry_run_history_limit: 100,
    dry_run_summary_enabled: true,
    alerts_enabled: true,
    max_exposure_alert_usd: 25,
    reject_reason_spike_threshold: 10,
    risk_code_spike_threshold: 10,
    report_enabled: true
  }),
  wallet: z.object({
    enabled: z.boolean().default(true),
    read_only: z.literal(true).default(true),
    expected_chain_id: z.number().int().positive().nullable().default(137),
    expected_chain_name: z.string().min(1).nullable().default("Polygon"),
    expose_backend_address: z.boolean().default(true),
    mask_backend_address: z.boolean().default(true),
    allow_frontend_signing: z.literal(false).default(false),
    allow_frontend_transactions: z.literal(false).default(false)
  }).default({
    enabled: true,
    read_only: true,
    expected_chain_id: 137,
    expected_chain_name: "Polygon",
    expose_backend_address: true,
    mask_backend_address: true,
    allow_frontend_signing: false,
    allow_frontend_transactions: false
  }),
  strategy: z.object({
    strategy_mode: z
      .enum([
        "pure_arbitrage",
        "hedge_arbitrage",
        "exposure_hedge",
        "rebalance_only",
        "simulation_edge",
        "simple_market_maker"
      ])
      .default("pure_arbitrage"),
    hedge_enabled: z.boolean(),
    max_net_exposure_usd: decimalString,
    max_predict_usage_pct: decimalString,
    min_profit_after_hedge_fee: decimalString
  }),
  simulation_edge: z.object({
    sigma: z.number().positive(),
    min_edge: z.number().nonnegative(),
    max_order_usd: decimalValue.refine((value) => value.gt(0), "must be positive"),
    paths: z.number().int().positive().default(100_000)
  }),
  simple_market_maker: z.object({
    enabled: z.boolean(),
    live_trading_enabled: z.boolean(),
    n_paths: z.number().int().positive(),
    annualized_vol: z.number().positive(),
    model_weight: z.number().min(0).max(1),
    base_spread: z.number().positive(),
    min_quote_spread: z.number().positive(),
    max_quote_spread: z.number().positive(),
    uncertainty_spread_multiplier: z.number().nonnegative(),
    fee_buffer: z.number().nonnegative().default(0),
    slippage_buffer: z.number().nonnegative().default(0),
    inventory_skew_factor: z.number().nonnegative().default(0.03),
    max_order_usd: decimalValue.refine((value) => value.gt(0), "must be positive"),
    max_inventory_usd: decimalValue.refine((value) => value.gt(0), "must be positive"),
    min_depth_usd: decimalValue.refine((value) => value.gt(0), "must be positive"),
    max_market_data_age_ms: z.number().int().positive(),
    min_seconds_to_expiry: z.number().int().positive(),
    min_locked_edge: z.number().nonnegative(),
    quote_ttl_ms: z.number().int().positive(),
    post_only: z.boolean()
  }),
  hedge: z.object({
    enabled: z.boolean(),
    dry_run: z.boolean(),
    hedge_ratio: z.number().positive().max(1),
    max_hedge_order_usd: decimalValue.refine((value) => value.gt(0), "must be positive"),
    min_hedge_order_usd: decimalValue.refine((value) => value.gt(0), "must be positive"),
    max_net_exposure_usd: decimalValue.refine((value) => value.gte(0), "must be non-negative"),
    max_predict_usage_pct: decimalValue.refine((value) => value.gt(0) && value.lte(1), "must be in (0, 1]"),
    max_spread: z.number().positive(),
    min_depth_usd: decimalValue.refine((value) => value.gt(0), "must be positive"),
    max_depth_usage_pct: z.number().positive().max(1),
    max_market_data_age_ms: z.number().int().positive(),
    require_same_event_key: z.boolean(),
    allow_correlated_hedge: z.boolean(),
    allowed_venues: z.array(z.enum(["polymarket", "predictfun"])).min(1).default(["polymarket", "predictfun"]),
    live_trading_enabled: z.boolean(),
    post_only: z.boolean()
  }),
  market: z.object({
    asset: z.literal("BTC"),
    allowed_market_family: z.array(z.enum(["BTC_UP_DOWN"])).min(1),
    max_window_seconds: z.number().int().positive(),
    require_exact_1h_window: z.boolean(),
    min_seconds_to_close: z.number().int().nonnegative(),
    discovery_lookahead_seconds: z.number().int().positive(),
    max_start_time_mismatch_sec: z.number().int().nonnegative(),
    max_end_time_mismatch_sec: z.number().int().nonnegative(),
    require_same_resolution_source: z.boolean(),
    allowed_resolution_sources: z.array(z.enum(["BINANCE_BTC_USDT", "CHAINLINK_BTC_USD", "UNKNOWN"])).min(1),
    reject_market_families: z
      .array(
        z.enum([
          "BTC_4H_UP_DOWN",
          "BTC_DAILY_UP_DOWN",
          "BTC_PRICE_TARGET",
          "BTC_RANGE",
          "BTC_MONTHLY",
          "BTC_YEARLY"
        ])
      )
      .default([])
  }),
  profits: z.object({
    min_net_profit_usd: decimalString,
    require_positive_after_all_buffers: z.boolean(),
    slippage_buffer_bps: z.number().int().nonnegative(),
    latency_buffer_bps: z.number().int().nonnegative(),
    stale_book_ms: z.number().int().positive()
  }),
  risk: z.object({
    predict_wallet_fraction_cap: decimalString,
    predict_min_order_usdt: decimalString,
    per_trade_max_usdt: decimalString,
    max_unhedged_seconds: z.number().int().positive(),
    rescue_max_loss_usd: decimalString,
    pause_on_unhedged_residual: z.boolean(),
    pause_on_polymarket_insufficient_balance: z.boolean()
  }),
  execution: z.object({
    order_type: z.enum(["FOK", "FAK", "LIMIT", "MARKET"]).default("FOK"),
    parallel_submit: z.boolean(),
    max_fill_wait_ms: z.number().int().positive(),
    cancel_unfilled_orders: z.boolean(),
    post_trade_reconcile_required: z.boolean()
  }),
  jobs: z.object({
    market_discovery_interval_ms: z.number().int().positive(),
    orderbook_poll_fallback_ms: z.number().int().positive(),
    account_refresh_interval_ms: z.number().int().positive(),
    reconciliation_interval_ms: z.number().int().positive(),
    settlement_check_interval_ms: z.number().int().positive()
  }),
  liveness: z.object({
    polymarket_clob_heartbeat_interval_ms: z.number().int().positive(),
    polymarket_clob_heartbeat_timeout_ms: z.number().int().positive(),
    websocket_heartbeat_timeout_ms: z.number().int().positive()
  }),
  predict: z.object({
    api_base: z.string().url(),
    ws_base: z.string().url(),
    api_key_env: z.string().min(1),
    jwt_refresh_seconds_before_expiry: z.number().int().positive(),
    rate_limit_per_minute: z.number().int().positive()
  }),
  polymarket: z.object({
    gamma_base: z.string().url(),
    clob_base: z.string().url(),
    data_base: z.string().url(),
    market_ws_base: z.string().url(),
    user_ws_base: z.string().url(),
    geoblock_check: z.boolean(),
    heartbeat_enabled: z.boolean()
  }),
  accounts: z.object({
    predict_accounts_file: z.string().min(1),
    polymarket_private_key_env: z.string().min(1),
    polymarket_funder_env: z.string().min(1),
    polymarket_api_key_env: z.string().min(1).default("POLY_API_KEY"),
    polymarket_api_secret_env: z.string().min(1).default("POLY_API_SECRET"),
    polymarket_passphrase_env: z.string().min(1).default("POLY_PASSPHRASE")
  }),
  storage: z.object({
    postgres_url_env: z.string().min(1),
    redis_url_env: z.string().min(1)
  }),
  alerts: z.object({
    telegram_enabled: z.boolean(),
    telegram_bot_token_env: z.string().min(1),
    telegram_chat_id_env: z.string().min(1)
  })
});

export type RawAppConfig = z.infer<typeof rawConfigSchema>;

export interface AppConfig {
  mode: "dry_run" | "live";
  dryRun: boolean;
  enableLiveTrading: boolean;
  dashboard: {
    enabled: boolean;
    port: number;
    frontendPort: number;
    readOnly: true;
    staleDataThresholdMs: number;
    dryRunHistoryLimit: number;
    dryRunSummaryEnabled: boolean;
    alertsEnabled: boolean;
    maxExposureAlertUsd: number;
    rejectReasonSpikeThreshold: number;
    riskCodeSpikeThreshold: number;
    reportEnabled: boolean;
  };
  wallet: {
    enabled: boolean;
    readOnly: true;
    expectedChainId: number | null;
    expectedChainName: string | null;
    exposeBackendAddress: boolean;
    maskBackendAddress: boolean;
    allowFrontendSigning: false;
    allowFrontendTransactions: false;
  };
  strategy: {
    strategyMode:
      | "pure_arbitrage"
      | "hedge_arbitrage"
      | "exposure_hedge"
      | "rebalance_only"
      | "simulation_edge"
      | "simple_market_maker";
    hedgeEnabled: boolean;
    maxNetExposureUsd: D;
    maxPredictUsagePct: D;
    minProfitAfterHedgeFee: D;
  };
  simulationEdge: {
    sigma: number;
    minEdge: number;
    maxOrderUsd: D;
    paths: number;
  };
  simpleMarketMaker: {
    enabled: boolean;
    liveTradingEnabled: boolean;
    nPaths: number;
    annualizedVol: number;
    modelWeight: number;
    baseSpread: number;
    minQuoteSpread: number;
    maxQuoteSpread: number;
    uncertaintySpreadMultiplier: number;
    feeBuffer: number;
    slippageBuffer: number;
    inventorySkewFactor: number;
    maxOrderUsd: D;
    maxInventoryUsd: D;
    minDepthUsd: D;
    maxMarketDataAgeMs: number;
    minSecondsToExpiry: number;
    minLockedEdge: number;
    quoteTtlMs: number;
    postOnly: boolean;
  };
  hedge: {
    enabled: boolean;
    dryRun: boolean;
    hedgeRatio: number;
    maxHedgeOrderUsd: D;
    minHedgeOrderUsd: D;
    maxNetExposureUsd: D;
    maxPredictUsagePct: D;
    maxSpread: number;
    minDepthUsd: D;
    maxDepthUsagePct: number;
    maxMarketDataAgeMs: number;
    requireSameEventKey: boolean;
    allowCorrelatedHedge: boolean;
    allowedVenues: readonly ("polymarket" | "predictfun")[];
    liveTradingEnabled: boolean;
    postOnly: boolean;
  };
  market: {
    asset: "BTC";
    allowedMarketFamily: readonly "BTC_UP_DOWN"[];
    maxWindowSeconds: number;
    requireExact1hWindow: boolean;
    minSecondsToClose: number;
    discoveryLookaheadSeconds: number;
    maxStartTimeMismatchSec: number;
    maxEndTimeMismatchSec: number;
    requireSameResolutionSource: boolean;
    allowedResolutionSources: readonly ("BINANCE_BTC_USDT" | "CHAINLINK_BTC_USD" | "UNKNOWN")[];
    rejectMarketFamilies: readonly (
      | "BTC_4H_UP_DOWN"
      | "BTC_DAILY_UP_DOWN"
      | "BTC_PRICE_TARGET"
      | "BTC_RANGE"
      | "BTC_MONTHLY"
      | "BTC_YEARLY"
    )[];
  };
  profits: {
    minNetProfitUsd: D;
    requirePositiveAfterAllBuffers: boolean;
    slippageBufferBps: number;
    latencyBufferBps: number;
    staleBookMs: number;
  };
  risk: {
    predictWalletFractionCap: D;
    predictMinOrderUsdt: D;
    perTradeMaxUsdt: D;
    maxUnhedgedSeconds: number;
    rescueMaxLossUsd: D;
    pauseOnUnhedgedResidual: boolean;
    pauseOnPolymarketInsufficientBalance: boolean;
  };
  execution: {
    orderType: "FOK" | "FAK" | "LIMIT" | "MARKET";
    parallelSubmit: boolean;
    maxFillWaitMs: number;
    cancelUnfilledOrders: boolean;
    postTradeReconcileRequired: boolean;
  };
  jobs: {
    marketDiscoveryIntervalMs: number;
    orderbookPollFallbackMs: number;
    accountRefreshIntervalMs: number;
    reconciliationIntervalMs: number;
    settlementCheckIntervalMs: number;
  };
  liveness: {
    polymarketClobHeartbeatIntervalMs: number;
    polymarketClobHeartbeatTimeoutMs: number;
    websocketHeartbeatTimeoutMs: number;
  };
  predict: RawAppConfig["predict"] & { apiKey?: string };
  polymarket: RawAppConfig["polymarket"];
  accounts: RawAppConfig["accounts"] & {
    polymarketPrivateKey?: string;
    polymarketFunder?: string;
    polymarketApiKey?: string;
    polymarketApiSecret?: string;
    polymarketPassphrase?: string;
  };
  storage: RawAppConfig["storage"] & {
    postgresUrl?: string;
    redisUrl?: string;
  };
  alerts: RawAppConfig["alerts"] & {
    telegramBotToken?: string;
    telegramChatId?: string;
  };
}

export function normalizeConfig(rawInput: unknown, env: NodeJS.ProcessEnv = process.env): AppConfig {
  const raw = rawConfigSchema.parse(rawInput);
  const config: AppConfig = {
    mode: raw.mode,
    dryRun: raw.mode === "dry_run",
    enableLiveTrading: raw.mode === "live",
    dashboard: {
      enabled: raw.dashboard.enabled,
      port: raw.dashboard.port,
      frontendPort: raw.dashboard.frontend_port,
      readOnly: raw.dashboard.read_only,
      staleDataThresholdMs: raw.dashboard.stale_data_threshold_ms,
      dryRunHistoryLimit: raw.dashboard.dry_run_history_limit,
      dryRunSummaryEnabled: raw.dashboard.dry_run_summary_enabled,
      alertsEnabled: raw.dashboard.alerts_enabled,
      maxExposureAlertUsd: raw.dashboard.max_exposure_alert_usd,
      rejectReasonSpikeThreshold: raw.dashboard.reject_reason_spike_threshold,
      riskCodeSpikeThreshold: raw.dashboard.risk_code_spike_threshold,
      reportEnabled: raw.dashboard.report_enabled
    },
    wallet: {
      enabled: raw.wallet.enabled,
      readOnly: raw.wallet.read_only,
      expectedChainId: raw.wallet.expected_chain_id,
      expectedChainName: raw.wallet.expected_chain_name,
      exposeBackendAddress: raw.wallet.expose_backend_address,
      maskBackendAddress: raw.wallet.mask_backend_address,
      allowFrontendSigning: raw.wallet.allow_frontend_signing,
      allowFrontendTransactions: raw.wallet.allow_frontend_transactions
    },
    strategy: {
      strategyMode: raw.strategy.strategy_mode,
      hedgeEnabled: raw.strategy.hedge_enabled,
      maxNetExposureUsd: raw.strategy.max_net_exposure_usd,
      maxPredictUsagePct: raw.strategy.max_predict_usage_pct,
      minProfitAfterHedgeFee: raw.strategy.min_profit_after_hedge_fee
    },
    simulationEdge: {
      sigma: raw.simulation_edge.sigma,
      minEdge: raw.simulation_edge.min_edge,
      maxOrderUsd: raw.simulation_edge.max_order_usd,
      paths: raw.simulation_edge.paths
    },
    simpleMarketMaker: {
      enabled: raw.simple_market_maker.enabled,
      liveTradingEnabled: raw.simple_market_maker.live_trading_enabled,
      nPaths: raw.simple_market_maker.n_paths,
      annualizedVol: raw.simple_market_maker.annualized_vol,
      modelWeight: raw.simple_market_maker.model_weight,
      baseSpread: raw.simple_market_maker.base_spread,
      minQuoteSpread: raw.simple_market_maker.min_quote_spread,
      maxQuoteSpread: raw.simple_market_maker.max_quote_spread,
      uncertaintySpreadMultiplier: raw.simple_market_maker.uncertainty_spread_multiplier,
      feeBuffer: raw.simple_market_maker.fee_buffer,
      slippageBuffer: raw.simple_market_maker.slippage_buffer,
      inventorySkewFactor: raw.simple_market_maker.inventory_skew_factor,
      maxOrderUsd: raw.simple_market_maker.max_order_usd,
      maxInventoryUsd: raw.simple_market_maker.max_inventory_usd,
      minDepthUsd: raw.simple_market_maker.min_depth_usd,
      maxMarketDataAgeMs: raw.simple_market_maker.max_market_data_age_ms,
      minSecondsToExpiry: raw.simple_market_maker.min_seconds_to_expiry,
      minLockedEdge: raw.simple_market_maker.min_locked_edge,
      quoteTtlMs: raw.simple_market_maker.quote_ttl_ms,
      postOnly: raw.simple_market_maker.post_only
    },
    hedge: {
      enabled: raw.hedge.enabled,
      dryRun: raw.hedge.dry_run,
      hedgeRatio: raw.hedge.hedge_ratio,
      maxHedgeOrderUsd: raw.hedge.max_hedge_order_usd,
      minHedgeOrderUsd: raw.hedge.min_hedge_order_usd,
      maxNetExposureUsd: raw.hedge.max_net_exposure_usd,
      maxPredictUsagePct: raw.hedge.max_predict_usage_pct,
      maxSpread: raw.hedge.max_spread,
      minDepthUsd: raw.hedge.min_depth_usd,
      maxDepthUsagePct: raw.hedge.max_depth_usage_pct,
      maxMarketDataAgeMs: raw.hedge.max_market_data_age_ms,
      requireSameEventKey: raw.hedge.require_same_event_key,
      allowCorrelatedHedge: raw.hedge.allow_correlated_hedge,
      allowedVenues: raw.hedge.allowed_venues,
      liveTradingEnabled: raw.hedge.live_trading_enabled,
      postOnly: raw.hedge.post_only
    },
    market: {
      asset: raw.market.asset,
      allowedMarketFamily: raw.market.allowed_market_family,
      maxWindowSeconds: raw.market.max_window_seconds,
      requireExact1hWindow: raw.market.require_exact_1h_window,
      minSecondsToClose: raw.market.min_seconds_to_close,
      discoveryLookaheadSeconds: raw.market.discovery_lookahead_seconds,
      maxStartTimeMismatchSec: raw.market.max_start_time_mismatch_sec,
      maxEndTimeMismatchSec: raw.market.max_end_time_mismatch_sec,
      requireSameResolutionSource: raw.market.require_same_resolution_source,
      allowedResolutionSources: raw.market.allowed_resolution_sources,
      rejectMarketFamilies: raw.market.reject_market_families
    },
    profits: {
      minNetProfitUsd: raw.profits.min_net_profit_usd,
      requirePositiveAfterAllBuffers: raw.profits.require_positive_after_all_buffers,
      slippageBufferBps: raw.profits.slippage_buffer_bps,
      latencyBufferBps: raw.profits.latency_buffer_bps,
      staleBookMs: raw.profits.stale_book_ms
    },
    risk: {
      predictWalletFractionCap: raw.risk.predict_wallet_fraction_cap,
      predictMinOrderUsdt: raw.risk.predict_min_order_usdt,
      perTradeMaxUsdt: raw.risk.per_trade_max_usdt,
      maxUnhedgedSeconds: raw.risk.max_unhedged_seconds,
      rescueMaxLossUsd: raw.risk.rescue_max_loss_usd,
      pauseOnUnhedgedResidual: raw.risk.pause_on_unhedged_residual,
      pauseOnPolymarketInsufficientBalance: raw.risk.pause_on_polymarket_insufficient_balance
    },
    execution: {
      orderType: raw.execution.order_type,
      parallelSubmit: raw.execution.parallel_submit,
      maxFillWaitMs: raw.execution.max_fill_wait_ms,
      cancelUnfilledOrders: raw.execution.cancel_unfilled_orders,
      postTradeReconcileRequired: raw.execution.post_trade_reconcile_required
    },
    jobs: {
      marketDiscoveryIntervalMs: raw.jobs.market_discovery_interval_ms,
      orderbookPollFallbackMs: raw.jobs.orderbook_poll_fallback_ms,
      accountRefreshIntervalMs: raw.jobs.account_refresh_interval_ms,
      reconciliationIntervalMs: raw.jobs.reconciliation_interval_ms,
      settlementCheckIntervalMs: raw.jobs.settlement_check_interval_ms
    },
    liveness: {
      polymarketClobHeartbeatIntervalMs: raw.liveness.polymarket_clob_heartbeat_interval_ms,
      polymarketClobHeartbeatTimeoutMs: raw.liveness.polymarket_clob_heartbeat_timeout_ms,
      websocketHeartbeatTimeoutMs: raw.liveness.websocket_heartbeat_timeout_ms
    },
    predict: {
      ...raw.predict,
      apiKey: env[raw.predict.api_key_env]
    },
    polymarket: raw.polymarket,
    accounts: {
      ...raw.accounts,
      polymarketPrivateKey: env[raw.accounts.polymarket_private_key_env],
      polymarketFunder: env[raw.accounts.polymarket_funder_env],
      polymarketApiKey: env[raw.accounts.polymarket_api_key_env],
      polymarketApiSecret: env[raw.accounts.polymarket_api_secret_env],
      polymarketPassphrase: env[raw.accounts.polymarket_passphrase_env]
    },
    storage: {
      ...raw.storage,
      postgresUrl: env[raw.storage.postgres_url_env],
      redisUrl: env[raw.storage.redis_url_env]
    },
    alerts: {
      ...raw.alerts,
      telegramBotToken: env[raw.alerts.telegram_bot_token_env],
      telegramChatId: env[raw.alerts.telegram_chat_id_env]
    }
  };
  assertRuntimeConfig(config);
  return config;
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return normalizeConfig({
    mode: modeEnv(env),
    dashboard: {
      enabled: parseBool(env.DASHBOARD_ENABLED, true),
      port: numberEnv(env.DASHBOARD_PORT, 3070),
      frontend_port: numberEnv(env.DASHBOARD_FRONTEND_PORT, 5173),
      read_only: true,
      stale_data_threshold_ms: numberEnv(env.DASHBOARD_STALE_DATA_THRESHOLD_MS, 10000),
      dry_run_history_limit: numberEnv(env.DASHBOARD_DRY_RUN_HISTORY_LIMIT, 100),
      dry_run_summary_enabled: parseBool(env.DASHBOARD_DRY_RUN_SUMMARY_ENABLED, true),
      alerts_enabled: parseBool(env.DASHBOARD_ALERTS_ENABLED, true),
      max_exposure_alert_usd: floatEnv(env.DASHBOARD_MAX_EXPOSURE_ALERT_USD, 25),
      reject_reason_spike_threshold: numberEnv(env.DASHBOARD_REJECT_REASON_SPIKE_THRESHOLD, 10),
      risk_code_spike_threshold: numberEnv(env.DASHBOARD_RISK_CODE_SPIKE_THRESHOLD, 10),
      report_enabled: parseBool(env.DASHBOARD_REPORT_ENABLED, true)
    },
    wallet: {
      enabled: parseBool(env.WALLET_ENABLED, true),
      read_only: true,
      expected_chain_id: nullableNumberEnv(env.WALLET_EXPECTED_CHAIN_ID, 137),
      expected_chain_name: nullableStringEnv(env.WALLET_EXPECTED_CHAIN_NAME, "Polygon"),
      expose_backend_address: parseBool(env.WALLET_EXPOSE_BACKEND_ADDRESS, true),
      mask_backend_address: parseBool(env.WALLET_MASK_BACKEND_ADDRESS, true),
      allow_frontend_signing: false,
      allow_frontend_transactions: false
    },
    strategy: {
      strategy_mode: strategyModeEnv(env),
      hedge_enabled: parseBool(env.HEDGE_ENABLED, false),
      max_net_exposure_usd: env.MAX_NET_EXPOSURE_USD ?? "0.00",
      max_predict_usage_pct: env.MAX_PREDICT_USAGE_PCT ?? "0.30",
      min_profit_after_hedge_fee: env.MIN_PROFIT_AFTER_HEDGE_FEE ?? "0.00"
    },
    simulation_edge: {
      sigma: floatEnv(env.SIMULATION_EDGE_SIGMA, 0.2),
      min_edge: floatEnv(env.SIMULATION_EDGE_MIN_EDGE, 0.01),
      max_order_usd: env.SIMULATION_EDGE_MAX_ORDER_USD ?? "10.00",
      paths: numberEnv(env.SIMULATION_EDGE_PATHS, 100000)
    },
    simple_market_maker: {
      enabled: parseBool(env.SIMPLE_MARKET_MAKER_ENABLED, false),
      live_trading_enabled: parseBool(env.SIMPLE_MARKET_MAKER_LIVE_TRADING_ENABLED, false),
      n_paths: numberEnv(env.SIMPLE_MARKET_MAKER_N_PATHS, 20000),
      annualized_vol: floatEnv(env.SIMPLE_MARKET_MAKER_ANNUALIZED_VOL, 0.65),
      model_weight: floatEnv(env.SIMPLE_MARKET_MAKER_MODEL_WEIGHT, 0.7),
      base_spread: floatEnv(env.SIMPLE_MARKET_MAKER_BASE_SPREAD, 0.018),
      min_quote_spread: floatEnv(env.SIMPLE_MARKET_MAKER_MIN_QUOTE_SPREAD, 0.012),
      max_quote_spread: floatEnv(env.SIMPLE_MARKET_MAKER_MAX_QUOTE_SPREAD, 0.08),
      uncertainty_spread_multiplier: floatEnv(env.SIMPLE_MARKET_MAKER_UNCERTAINTY_SPREAD_MULTIPLIER, 0.4),
      fee_buffer: floatEnv(env.SIMPLE_MARKET_MAKER_FEE_BUFFER, 0),
      slippage_buffer: floatEnv(env.SIMPLE_MARKET_MAKER_SLIPPAGE_BUFFER, 0),
      inventory_skew_factor: floatEnv(env.SIMPLE_MARKET_MAKER_INVENTORY_SKEW_FACTOR, 0.03),
      max_order_usd: env.SIMPLE_MARKET_MAKER_MAX_ORDER_USD ?? "5.00",
      max_inventory_usd: env.SIMPLE_MARKET_MAKER_MAX_INVENTORY_USD ?? "25.00",
      min_depth_usd: env.SIMPLE_MARKET_MAKER_MIN_DEPTH_USD ?? "20.00",
      max_market_data_age_ms: numberEnv(env.SIMPLE_MARKET_MAKER_MAX_MARKET_DATA_AGE_MS, 2000),
      min_seconds_to_expiry: numberEnv(env.SIMPLE_MARKET_MAKER_MIN_SECONDS_TO_EXPIRY, 60),
      min_locked_edge: floatEnv(env.SIMPLE_MARKET_MAKER_MIN_LOCKED_EDGE, 0.004),
      quote_ttl_ms: numberEnv(env.SIMPLE_MARKET_MAKER_QUOTE_TTL_MS, 1500),
      post_only: parseBool(env.SIMPLE_MARKET_MAKER_POST_ONLY, true)
    },
    hedge: {
      enabled: parseBool(env.HEDGE_CORE_ENABLED ?? env.HEDGE_ENABLED, true),
      dry_run: parseBool(env.HEDGE_DRY_RUN, true),
      hedge_ratio: floatEnv(env.HEDGE_RATIO, 0.5),
      max_hedge_order_usd: env.HEDGE_MAX_ORDER_USD ?? "10.00",
      min_hedge_order_usd: env.HEDGE_MIN_ORDER_USD ?? "1.00",
      max_net_exposure_usd: env.HEDGE_MAX_NET_EXPOSURE_USD ?? "25.00",
      max_predict_usage_pct: env.HEDGE_MAX_PREDICT_USAGE_PCT ?? "0.30",
      max_spread: floatEnv(env.HEDGE_MAX_SPREAD, 0.035),
      min_depth_usd: env.HEDGE_MIN_DEPTH_USD ?? "20.00",
      max_depth_usage_pct: floatEnv(env.HEDGE_MAX_DEPTH_USAGE_PCT, 0.25),
      max_market_data_age_ms: numberEnv(env.HEDGE_MAX_MARKET_DATA_AGE_MS, 2000),
      require_same_event_key: parseBool(env.HEDGE_REQUIRE_SAME_EVENT_KEY, true),
      allow_correlated_hedge: parseBool(env.HEDGE_ALLOW_CORRELATED_HEDGE, false),
      allowed_venues: hedgeAllowedVenuesEnv(env.HEDGE_ALLOWED_VENUES),
      live_trading_enabled: parseBool(env.HEDGE_LIVE_TRADING_ENABLED, false),
      post_only: parseBool(env.HEDGE_POST_ONLY, true)
    },
    market: {
      asset: "BTC",
      allowed_market_family: ["BTC_UP_DOWN"],
      max_window_seconds: numberEnv(env.MARKET_MAX_WINDOW_SECONDS, 3600),
      require_exact_1h_window: parseBool(env.MARKET_REQUIRE_EXACT_1H_WINDOW, true),
      min_seconds_to_close: numberEnv(env.MARKET_MIN_SECONDS_TO_CLOSE ?? env.MIN_SECONDS_TO_CLOSE, 90),
      discovery_lookahead_seconds: numberEnv(env.MARKET_DISCOVERY_LOOKAHEAD_SECONDS, 3600),
      max_start_time_mismatch_sec: numberEnv(env.MARKET_MAX_START_TIME_MISMATCH_SEC, 0),
      max_end_time_mismatch_sec: numberEnv(env.MARKET_MAX_END_TIME_MISMATCH_SEC, 0),
      require_same_resolution_source: true,
      allowed_resolution_sources: [(env.MARKET_ALLOWED_RESOLUTION_SOURCE ?? "BINANCE_BTC_USDT") as "BINANCE_BTC_USDT"],
      reject_market_families: [
        "BTC_4H_UP_DOWN",
        "BTC_DAILY_UP_DOWN",
        "BTC_PRICE_TARGET",
        "BTC_RANGE",
        "BTC_MONTHLY",
        "BTC_YEARLY"
      ]
    },
    profits: {
      min_net_profit_usd: env.MIN_NET_PROFIT_USD ?? "0.00",
      require_positive_after_all_buffers: parseBool(env.REQUIRE_POSITIVE_AFTER_ALL_BUFFERS, true),
      slippage_buffer_bps: numberEnv(env.SLIPPAGE_BUFFER_BPS, 8),
      latency_buffer_bps: numberEnv(env.LATENCY_BUFFER_BPS, 10),
      stale_book_ms: numberEnv(env.STALE_BOOK_MS, 500)
    },
    risk: {
      predict_wallet_fraction_cap: env.PREDICT_MAX_TRADE_FRACTION ?? "0.30",
      predict_min_order_usdt: env.PREDICT_MIN_ORDER_USDT ?? "1.00",
      per_trade_max_usdt: env.PER_TRADE_MAX_USDT ?? "300.00",
      max_unhedged_seconds: numberEnv(env.MAX_UNHEDGED_SECONDS, 2),
      rescue_max_loss_usd: env.RESCUE_MAX_LOSS_USD ?? "3.00",
      pause_on_unhedged_residual: parseBool(env.PAUSE_ON_UNHEDGED_RESIDUAL, true),
      pause_on_polymarket_insufficient_balance: parseBool(env.PAUSE_ON_POLYMARKET_INSUFFICIENT_BALANCE, true)
    },
    execution: {
      order_type: env.ORDER_TYPE ?? "FOK",
      parallel_submit: parseBool(env.PARALLEL_SUBMIT, true),
      max_fill_wait_ms: numberEnv(env.MAX_FILL_WAIT_MS, 1000),
      cancel_unfilled_orders: parseBool(env.CANCEL_UNFILLED_ORDERS, true),
      post_trade_reconcile_required: parseBool(env.POST_TRADE_RECONCILE_REQUIRED, true)
    },
    jobs: {
      market_discovery_interval_ms: numberEnv(env.MARKET_DISCOVERY_INTERVAL_MS, 15000),
      orderbook_poll_fallback_ms: numberEnv(env.ORDERBOOK_POLL_FALLBACK_MS, 1000),
      account_refresh_interval_ms: numberEnv(env.ACCOUNT_REFRESH_INTERVAL_MS, 10000),
      reconciliation_interval_ms: numberEnv(env.RECONCILIATION_INTERVAL_MS, 5000),
      settlement_check_interval_ms: numberEnv(env.SETTLEMENT_CHECK_INTERVAL_MS, 30000)
    },
    liveness: {
      polymarket_clob_heartbeat_interval_ms: numberEnv(env.POLYMARKET_CLOB_HEARTBEAT_INTERVAL_MS, 5000),
      polymarket_clob_heartbeat_timeout_ms: numberEnv(env.POLYMARKET_CLOB_HEARTBEAT_TIMEOUT_MS, 15000),
      websocket_heartbeat_timeout_ms: numberEnv(env.WEBSOCKET_HEARTBEAT_TIMEOUT_MS, 15000)
    },
    predict: {
      api_base: env.PREDICT_API_BASE ?? "https://api.predict.fun",
      ws_base: env.PREDICT_WS_BASE ?? "wss://ws.predict.fun/ws",
      api_key_env: "PREDICT_API_KEY",
      jwt_refresh_seconds_before_expiry: numberEnv(env.PREDICT_JWT_REFRESH_SECONDS_BEFORE_EXPIRY, 120),
      rate_limit_per_minute: numberEnv(env.PREDICT_RATE_LIMIT_PER_MINUTE, 240)
    },
    polymarket: {
      gamma_base: env.POLYMARKET_GAMMA_BASE ?? "https://gamma-api.polymarket.com",
      clob_base: env.POLYMARKET_CLOB_BASE ?? "https://clob.polymarket.com",
      data_base: env.POLYMARKET_DATA_BASE ?? "https://data-api.polymarket.com",
      market_ws_base: env.POLYMARKET_MARKET_WS_BASE ?? "wss://ws-subscriptions-clob.polymarket.com/ws/market",
      user_ws_base: env.POLYMARKET_USER_WS_BASE ?? "wss://ws-subscriptions-clob.polymarket.com/ws/user",
      geoblock_check: parseBool(env.POLYMARKET_GEOBLOCK_CHECK, true),
      heartbeat_enabled: parseBool(env.POLYMARKET_HEARTBEAT_ENABLED, true)
    },
    accounts: {
      predict_accounts_file: env.PREDICT_ACCOUNTS_FILE ?? "./secrets/predict_accounts.enc.json",
      polymarket_private_key_env: "POLYMARKET_PRIVATE_KEY",
      polymarket_funder_env: "POLYMARKET_FUNDER_ADDRESS",
      polymarket_api_key_env: "POLY_API_KEY",
      polymarket_api_secret_env: "POLY_API_SECRET",
      polymarket_passphrase_env: "POLY_PASSPHRASE"
    },
    storage: {
      postgres_url_env: "DATABASE_URL",
      redis_url_env: "REDIS_URL"
    },
    alerts: {
      telegram_enabled: parseBool(env.TELEGRAM_ENABLED, false),
      telegram_bot_token_env: "TELEGRAM_BOT_TOKEN",
      telegram_chat_id_env: "TELEGRAM_CHAT_ID"
    }
  }, env);
}

export function assertRuntimeConfig(config: AppConfig): void {
  if (config.strategy.maxPredictUsagePct.lte(0) || config.strategy.maxPredictUsagePct.gt(1)) {
    throw new Error("strategy.max_predict_usage_pct must be greater than 0 and at most 1");
  }
  if (config.strategy.maxNetExposureUsd.lt(0) || config.strategy.minProfitAfterHedgeFee.lt(0)) {
    throw new Error("strategy exposure and profit thresholds must be non-negative");
  }
  if (config.simpleMarketMaker.maxQuoteSpread < config.simpleMarketMaker.minQuoteSpread) {
    throw new Error("simple_market_maker.max_quote_spread must be greater than or equal to min_quote_spread");
  }
  if (config.hedge.minHedgeOrderUsd.gt(config.hedge.maxHedgeOrderUsd)) {
    throw new Error("hedge.min_hedge_order_usd must be less than or equal to max_hedge_order_usd");
  }
  if (config.hedge.liveTradingEnabled || !config.hedge.dryRun) {
    throw new Error("hedge v0.2 is dry-run only; set hedge.live_trading_enabled=false and hedge.dry_run=true");
  }
  if (config.hedge.requireSameEventKey && config.hedge.allowCorrelatedHedge) {
    throw new Error("hedge correlated matching is disabled in v0.2; set allow_correlated_hedge=false");
  }
  if (config.enableLiveTrading && config.strategy.strategyMode !== "pure_arbitrage") {
    throw new Error("live mode currently supports only strategy.strategy_mode=pure_arbitrage");
  }
  if (config.enableLiveTrading) {
    const missing = requiredLiveSecretEnvNames(config).filter((item) => !hasValue(item.value)).map((item) => item.envName);
    if (missing.length > 0) {
      throw new Error(`live mode requires configured secrets: ${missing.join(", ")}`);
    }
  }
  if (config.alerts.telegram_enabled && (!hasValue(config.alerts.telegramBotToken) || !hasValue(config.alerts.telegramChatId))) {
    throw new Error("telegram alerts require TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID");
  }
}

export function redactedConfigForLogs(config: AppConfig): AppConfig {
  return redactSecrets(config);
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function numberEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function floatEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function nullableStringEnv(value: string | undefined, fallback: string | null): string | null {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim();
  return normalized.toLowerCase() === "null" ? null : normalized;
}

function nullableNumberEnv(value: string | undefined, fallback: number | null): number | null {
  const normalized = nullableStringEnv(value, fallback === null ? null : String(fallback));
  if (normalized === null) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function modeEnv(env: NodeJS.ProcessEnv): "dry_run" | "live" {
  const explicit = env.MODE ?? env.PREDICTFUN_MODE;
  if (explicit !== undefined && explicit.trim() !== "") {
    const normalized = explicit.trim().toLowerCase();
    if (normalized === "dry_run" || normalized === "live") return normalized;
    throw new Error("MODE must be dry_run or live");
  }
  if (parseBool(env.ENABLE_LIVE_TRADING, false)) return "live";
  if (env.DRY_RUN !== undefined && !parseBool(env.DRY_RUN, true)) return "live";
  return "dry_run";
}

function strategyModeEnv(
  env: NodeJS.ProcessEnv
): "pure_arbitrage" | "hedge_arbitrage" | "exposure_hedge" | "rebalance_only" | "simulation_edge" | "simple_market_maker" {
  const value = env.STRATEGY_MODE?.trim().toLowerCase();
  if (!value) return "pure_arbitrage";
  if (
    value === "pure_arbitrage" ||
    value === "hedge_arbitrage" ||
    value === "exposure_hedge" ||
    value === "rebalance_only" ||
    value === "simulation_edge" ||
    value === "simple_market_maker"
  ) {
    return value;
  }
  throw new Error(
    "STRATEGY_MODE must be pure_arbitrage, hedge_arbitrage, exposure_hedge, rebalance_only, simulation_edge, or simple_market_maker"
  );
}

function hedgeAllowedVenuesEnv(value: string | undefined): ("polymarket" | "predictfun")[] {
  if (value === undefined || value.trim() === "") return ["polymarket", "predictfun"];
  const venues = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== "");
  if (venues.length === 0) return ["polymarket", "predictfun"];
  for (const venue of venues) {
    if (venue !== "polymarket" && venue !== "predictfun") {
      throw new Error("HEDGE_ALLOWED_VENUES must contain only polymarket and/or predictfun");
    }
  }
  return [...new Set(venues)] as ("polymarket" | "predictfun")[];
}

function requiredLiveSecretEnvNames(config: AppConfig): readonly { envName: string; value: string | undefined }[] {
  return [
    { envName: config.predict.api_key_env, value: config.predict.apiKey },
    { envName: config.accounts.polymarket_private_key_env, value: config.accounts.polymarketPrivateKey },
    { envName: config.accounts.polymarket_funder_env, value: config.accounts.polymarketFunder },
    { envName: config.accounts.polymarket_api_key_env, value: config.accounts.polymarketApiKey },
    { envName: config.accounts.polymarket_api_secret_env, value: config.accounts.polymarketApiSecret },
    { envName: config.accounts.polymarket_passphrase_env, value: config.accounts.polymarketPassphrase }
  ];
}

function hasValue(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}
export const HEDGE_CONFIG_SCHEMA = {
  enabled: "boolean",
  dry_run: "boolean",
  hedge_ratio: "number",
  max_hedge_order_usd: "number",
  min_hedge_order_usd: "number",
  max_net_exposure_usd: "number",
  max_predict_usage_pct: "number",
  max_spread: "number",
  min_depth_usd: "number",
  max_depth_usage_pct: "number",
  max_market_data_age_ms: "number",
  require_same_event_key: "boolean",
  allow_correlated_hedge: "boolean",
  live_trading_enabled: "boolean",
  post_only: "boolean",
} as const;
