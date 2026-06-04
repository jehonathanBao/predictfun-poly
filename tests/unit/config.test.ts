import { describe, expect, it } from "vitest";
import { REDACTED_SECRET, maskSecretString, redactSecrets } from "../../src/config/secrets.js";
import { loadConfigFromEnv, normalizeConfig, redactedConfigForLogs } from "../../src/config/schema.js";
import { loadConfigFromFile } from "../../src/config/load-config.js";

function rawConfig(mode: "dry_run" | "live" = "dry_run") {
  return {
    mode,
    strategy: {
      strategy_mode: "pure_arbitrage",
      hedge_enabled: false,
      max_net_exposure_usd: "0.00",
      max_predict_usage_pct: "0.30",
      min_profit_after_hedge_fee: "0.00"
    },
    simulation_edge: {
      sigma: 0.2,
      min_edge: 0.01,
      max_order_usd: 10,
      paths: 100000
    },
    simple_market_maker: {
      enabled: true,
      live_trading_enabled: false,
      n_paths: 20000,
      annualized_vol: 0.65,
      model_weight: 0.7,
      base_spread: 0.018,
      min_quote_spread: 0.012,
      max_quote_spread: 0.08,
      uncertainty_spread_multiplier: 0.4,
      fee_buffer: 0,
      slippage_buffer: 0,
      inventory_skew_factor: 0.03,
      max_order_usd: 5,
      max_inventory_usd: 25,
      min_depth_usd: 20,
      max_market_data_age_ms: 2000,
      min_seconds_to_expiry: 60,
      min_locked_edge: 0.004,
      quote_ttl_ms: 1500,
      post_only: true
    },
    market: {
      asset: "BTC",
      allowed_market_family: ["BTC_UP_DOWN"],
      max_window_seconds: 3600,
      require_exact_1h_window: true,
      min_seconds_to_close: 90,
      discovery_lookahead_seconds: 3600,
      max_start_time_mismatch_sec: 0,
      max_end_time_mismatch_sec: 0,
      require_same_resolution_source: true,
      allowed_resolution_sources: ["BINANCE_BTC_USDT"],
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
      min_net_profit_usd: "0.00",
      require_positive_after_all_buffers: true,
      slippage_buffer_bps: 8,
      latency_buffer_bps: 10,
      stale_book_ms: 500
    },
    risk: {
      predict_wallet_fraction_cap: "0.30",
      predict_min_order_usdt: "1.00",
      per_trade_max_usdt: "300.00",
      max_unhedged_seconds: 2,
      rescue_max_loss_usd: "3.00",
      pause_on_unhedged_residual: true,
      pause_on_polymarket_insufficient_balance: true
    },
    execution: {
      order_type: "FOK",
      parallel_submit: true,
      max_fill_wait_ms: 1000,
      cancel_unfilled_orders: true,
      post_trade_reconcile_required: true
    },
    jobs: {
      market_discovery_interval_ms: 15000,
      orderbook_poll_fallback_ms: 1000,
      account_refresh_interval_ms: 10000,
      reconciliation_interval_ms: 5000,
      settlement_check_interval_ms: 30000
    },
    liveness: {
      polymarket_clob_heartbeat_interval_ms: 5000,
      polymarket_clob_heartbeat_timeout_ms: 15000,
      websocket_heartbeat_timeout_ms: 15000
    },
    predict: {
      api_base: "https://api.predict.fun",
      ws_base: "wss://ws.predict.fun/ws",
      api_key_env: "PREDICT_API_KEY",
      jwt_refresh_seconds_before_expiry: 120,
      rate_limit_per_minute: 240
    },
    polymarket: {
      gamma_base: "https://gamma-api.polymarket.com",
      clob_base: "https://clob.polymarket.com",
      data_base: "https://data-api.polymarket.com",
      market_ws_base: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
      user_ws_base: "wss://ws-subscriptions-clob.polymarket.com/ws/user",
      geoblock_check: true,
      heartbeat_enabled: true
    },
    accounts: {
      predict_accounts_file: "./secrets/predict_accounts.enc.json",
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
      telegram_enabled: false,
      telegram_bot_token_env: "TELEGRAM_BOT_TOKEN",
      telegram_chat_id_env: "TELEGRAM_CHAT_ID"
    }
  };
}

const liveSecrets = {
  PREDICT_API_KEY: "predict-key",
  POLYMARKET_PRIVATE_KEY: "poly-private-key",
  POLYMARKET_FUNDER_ADDRESS: "0xfunder",
  POLY_API_KEY: "poly-api-key",
  POLY_API_SECRET: "poly-api-secret",
  POLY_PASSPHRASE: "poly-passphrase"
};

describe("config loading", () => {
  it("loads the checked-in default yaml in dry_run mode", async () => {
    const config = await loadConfigFromFile("src/config/default.yaml", {});

    expect(config.mode).toBe("dry_run");
    expect(config.dryRun).toBe(true);
    expect(config.market.requireExact1hWindow).toBe(true);
    expect(config.market.allowedResolutionSources).toContain("BINANCE_BTC_USDT");
    expect(config.strategy.strategyMode).toBe("pure_arbitrage");
    expect(config.simulationEdge.sigma).toBe(0.2);
    expect(config.simpleMarketMaker.liveTradingEnabled).toBe(false);
  });

  it("allows dry_run without live private keys", () => {
    const config = normalizeConfig(rawConfig(), {});

    expect(config.mode).toBe("dry_run");
    expect(config.dryRun).toBe(true);
    expect(config.predict.apiKey).toBeUndefined();
  });

  it("rejects live mode when required secrets are missing", () => {
    expect(() => normalizeConfig(rawConfig("live"), {})).toThrow(/live mode requires configured secrets/);
  });

  it("accepts live mode when required secrets are present", () => {
    const config = normalizeConfig(rawConfig("live"), liveSecrets);

    expect(config.enableLiveTrading).toBe(true);
    expect(config.predict.apiKey).toBe("predict-key");
    expect(config.accounts.polymarketApiSecret).toBe("poly-api-secret");
  });

  it("rejects missing config files", async () => {
    await expect(loadConfigFromFile("does-not-exist.yaml", {})).rejects.toThrow();
  });

  it("rejects invalid decimal strings", () => {
    const config = rawConfig();
    config.profits.min_net_profit_usd = "not-a-decimal";

    expect(() => normalizeConfig(config, {})).toThrow();
  });

  it("rejects invalid integer environment strings", () => {
    expect(() => loadConfigFromEnv({ SLIPPAGE_BUFFER_BPS: "5abc" })).toThrow();
  });

  it("supports MODE=live from the environment", () => {
    const config = loadConfigFromEnv({
      MODE: "live",
      ...liveSecrets
    });

    expect(config.mode).toBe("live");
  });

  it("rejects invalid strategy usage caps", () => {
    const config = rawConfig();
    config.strategy.max_predict_usage_pct = "1.50";

    expect(() => normalizeConfig(config, {})).toThrow(/max_predict_usage_pct/);
  });

  it("rejects non-pure strategy modes in live mode until implemented", () => {
    const config = rawConfig("live");
    config.strategy.strategy_mode = "simulation_edge";
    config.strategy.hedge_enabled = true;

    expect(() => normalizeConfig(config, liveSecrets)).toThrow(/pure_arbitrage/);
  });

  it("loads simulation_edge numeric env settings", () => {
    const config = loadConfigFromEnv({
      STRATEGY_MODE: "simulation_edge",
      SIMULATION_EDGE_SIGMA: "0.35",
      SIMULATION_EDGE_MIN_EDGE: "0.02",
      SIMULATION_EDGE_MAX_ORDER_USD: "25",
      SIMULATION_EDGE_PATHS: "5000"
    });

    expect(config.strategy.strategyMode).toBe("simulation_edge");
    expect(config.simulationEdge).toMatchObject({
      sigma: 0.35,
      minEdge: 0.02,
      paths: 5000
    });
    expect(config.simulationEdge.maxOrderUsd.toString()).toBe("25");
  });

  it("loads simple_market_maker env settings in dry_run", () => {
    const config = loadConfigFromEnv({
      STRATEGY_MODE: "simple_market_maker",
      SIMPLE_MARKET_MAKER_LIVE_TRADING_ENABLED: "false",
      SIMPLE_MARKET_MAKER_MAX_ORDER_USD: "7.50",
      SIMPLE_MARKET_MAKER_MAX_INVENTORY_USD: "30",
      SIMPLE_MARKET_MAKER_N_PATHS: "3000"
    });

    expect(config.strategy.strategyMode).toBe("simple_market_maker");
    expect(config.simpleMarketMaker.liveTradingEnabled).toBe(false);
    expect(config.simpleMarketMaker.maxOrderUsd.toString()).toBe("7.5");
    expect(config.simpleMarketMaker.maxInventoryUsd.toString()).toBe("30");
    expect(config.simpleMarketMaker.nPaths).toBe(3000);
  });
});

describe("secret redaction", () => {
  it("redacts nested secret fields before logging", () => {
    const redacted = redactSecrets({
      privateKey: "0xabc",
      nested: {
        jwt: "jwt-value",
        apiSecret: "api-secret-value",
        apiKey: "api-key-value",
        safe: "visible"
      }
    });

    expect(redacted.privateKey).toBe(REDACTED_SECRET);
    expect(redacted.nested.jwt).toBe(REDACTED_SECRET);
    expect(redacted.nested.apiSecret).toBe(REDACTED_SECRET);
    expect(redacted.nested.apiKey).toBe(REDACTED_SECRET);
    expect(redacted.nested.safe).toBe("visible");
    expect(JSON.stringify(redacted)).not.toContain("0xabc");
    expect(JSON.stringify(redacted)).not.toContain("jwt-value");
    expect(JSON.stringify(redacted)).not.toContain("api-secret-value");
    expect(JSON.stringify(redacted)).not.toContain("api-key-value");
  });

  it("masks secret assignments in log strings", () => {
    const message = maskSecretString("private key=0xabc jwt:jwt-value api secret=secret api key=key");

    expect(message).not.toContain("0xabc");
    expect(message).not.toContain("jwt-value");
    expect(message).not.toContain("secret api");
    expect(message).not.toContain("=key");
  });

  it("redacts loaded config objects for logs", () => {
    const config = normalizeConfig(rawConfig("live"), liveSecrets);
    const redacted = redactedConfigForLogs(config);
    const payload = JSON.stringify(redacted);

    expect(payload).not.toContain("predict-key");
    expect(payload).not.toContain("poly-private-key");
    expect(payload).not.toContain("poly-api-secret");
    expect(payload).toContain(REDACTED_SECRET);
  });
});
