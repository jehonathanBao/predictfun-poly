import { z } from "zod";

export const simpleMarketMakerRawSchemaSnippet = z.object({
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
  max_order_usd: z.union([z.string(), z.number()]),
  max_inventory_usd: z.union([z.string(), z.number()]),
  min_depth_usd: z.union([z.string(), z.number()]),
  max_market_data_age_ms: z.number().int().positive(),
  min_seconds_to_expiry: z.number().int().positive(),
  min_locked_edge: z.number().nonnegative(),
  quote_ttl_ms: z.number().int().positive(),
  post_only: z.boolean()
});
