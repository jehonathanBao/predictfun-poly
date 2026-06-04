export interface AccountHealthResponse {
  mode: "dry_run";
  readOnly: true;
  liveTradingEnabled: false;
  wallet: {
    enabled: boolean;
    backendAddressMasked?: string;
    expectedChainId: number | null;
    expectedChainName: string | null;
  };
  predict: {
    configured: boolean;
    usagePct: number;
    maxUsagePct: number;
    accountCount: number;
  };
  polymarket: {
    configured: boolean;
    allowedVenues: readonly string[];
  };
  warnings: readonly string[];
}

export function buildAccountHealthResponse(
  env: NodeJS.ProcessEnv = process.env,
): AccountHealthResponse {
  const backendAddress = firstValue(env.POLYMARKET_FUNDER_ADDRESS, env.BACKEND_TRADING_ADDRESS);
  const predictConfigured = Boolean(firstValue(env.PREDICT_API_KEY, env.PREDICT_ACCOUNTS_CONFIGURED));
  const polymarketConfigured = Boolean(
    backendAddress || firstValue(env.POLY_API_KEY, env.POLY_API_SECRET, env.POLY_PASSPHRASE),
  );
  const usagePct = boundedPct(numberEnv(env.PREDICT_USAGE_PCT ?? env.PREDICT_CURRENT_USAGE_PCT, 0));
  const maxUsagePct = boundedPct(numberEnv(env.HEDGE_MAX_PREDICT_USAGE_PCT ?? env.MAX_PREDICT_USAGE_PCT, 0.3));
  const accountCount = Math.max(0, numberEnv(env.PREDICT_ACCOUNT_COUNT, 0));
  const warnings = accountWarnings({
    backendAddress,
    predictConfigured,
    polymarketConfigured,
    usagePct,
    maxUsagePct,
    liveTradingRequested: parseBool(env.HEDGE_LIVE_TRADING_ENABLED, false),
  });

  const wallet: AccountHealthResponse["wallet"] = {
    enabled: parseBool(env.WALLET_ENABLED, true),
    expectedChainId: nullableNumber(env.WALLET_EXPECTED_CHAIN_ID, 137),
    expectedChainName: nullableString(env.WALLET_EXPECTED_CHAIN_NAME, "Polygon"),
  };
  if (backendAddress) {
    wallet.backendAddressMasked = maskAddress(backendAddress);
  }

  return {
    mode: "dry_run",
    readOnly: true,
    liveTradingEnabled: false,
    wallet,
    predict: {
      configured: predictConfigured,
      usagePct,
      maxUsagePct,
      accountCount,
    },
    polymarket: {
      configured: polymarketConfigured,
      allowedVenues: allowedVenues(env.HEDGE_ALLOWED_VENUES),
    },
    warnings,
  };
}

function accountWarnings(input: {
  backendAddress?: string;
  predictConfigured: boolean;
  polymarketConfigured: boolean;
  usagePct: number;
  maxUsagePct: number;
  liveTradingRequested: boolean;
}): string[] {
  const warnings: string[] = [];
  if (!input.backendAddress) warnings.push("backend_wallet_not_configured");
  if (!input.predictConfigured) warnings.push("predict_not_configured");
  if (!input.polymarketConfigured) warnings.push("polymarket_not_configured");
  if (input.usagePct > input.maxUsagePct) warnings.push("predict_usage_above_limit");
  if (input.liveTradingRequested) warnings.push("live_trading_request_ignored_in_dashboard");
  return warnings;
}

function allowedVenues(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === "") return ["polymarket"];
  const venues = raw
    .split(",")
    .map((venue) => venue.trim().toLowerCase())
    .filter((venue) => venue !== "");
  return venues.length > 0 ? [...new Set(venues)] : ["polymarket"];
}

function firstValue(...values: (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined && value.trim() !== "");
}

function boundedPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function numberEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableString(value: string | undefined, fallback: string | null): string | null {
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "null") return null;
  return trimmed;
}

function nullableNumber(value: string | undefined, fallback: number | null): number | null {
  const normalized = nullableString(value, fallback === null ? null : String(fallback));
  if (normalized === null) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function maskAddress(address: string): string {
  const normalized = address.trim();
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}
