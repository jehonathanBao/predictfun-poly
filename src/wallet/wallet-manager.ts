export type WalletVenue = "PREDICT" | "POLYMARKET";
export type WalletRole = "predict_account" | "polymarket_hedge";

export interface WalletInfo {
  id: string;
  venue: WalletVenue;
  role: WalletRole;
  address: string;
  addressMasked: string;
  chainId: number | null;
  network: string | null;
  balanceUsd: number;
  reservedUsd: number;
  availableUsd: number;
  yesExposureUsd: number;
  noExposureUsd: number;
  netExposureUsd: number;
  currentPlannedHedgeUsd: number;
  dryRun: true;
  liveTradingEnabled: false;
  readOnly: true;
  status: string;
  paperSimulated?: true;
}

export type PublicWalletInfo = Omit<WalletInfo, "address">;

export interface WalletManagerState {
  mode: "dry_run";
  readOnly: true;
  liveTradingEnabled: false;
  canExecuteHedge: false;
  lastUpdatedMs: number;
  wallets: readonly WalletInfo[];
}

export interface PaperSimulationStatus {
  enabled: boolean;
  predictWalletCount: number;
  predictWalletFundsUsd: number;
  polymarketHedgeFundsUsd: number;
  simulatedNetExposureUsd: number;
  plannedHedgeUsd: number;
  realPredictWalletCount: number;
  realPolymarketHedgeWalletConfigured: boolean;
}

export interface WalletReservation {
  planId: string;
  amountUsd: number;
}

export interface WalletManagerDashboardResponse {
  schemaVersion: 1;
  mode: "dry_run";
  readOnly: true;
  liveTradingEnabled: false;
  canExecuteHedge: false;
  generatedAt: string;
  walletPolicy: {
    maxPredictWallets: 10;
    polymarketHedgeWalletsAllowed: 1;
    frontendSigningAllowed: false;
    frontendTransactionsAllowed: false;
  };
  summary: {
    predictWalletCount: number;
    maxPredictWallets: 10;
    polymarketHedgeWalletCount: number;
    totalPredictBalanceUsd: number;
    totalPredictReservedUsd: number;
    totalPredictAvailableUsd: number;
    totalPredictNetExposureUsd: number;
    totalPredictAbsExposureUsd: number;
    polymarketBalanceUsd: number;
    polymarketReservedUsd: number;
    polymarketAvailableUsd: number;
    currentPlannedHedgeUsd: number;
  };
  paperSimulation: PaperSimulationStatus;
  predictWallets: readonly PublicWalletInfo[];
  polymarketHedgeWallet: PublicWalletInfo | null;
  warnings: readonly string[];
}

export class WalletManager {
  private readonly wallets: WalletInfo[];
  private readonly reservations = new Map<string, Map<string, number>>();
  private lastUpdatedMs = Date.now();

  constructor(initialWallets: readonly WalletInfo[]) {
    const predictWallets = initialWallets.filter((wallet) => wallet.role === "predict_account");
    if (predictWallets.length > 10) {
      throw new Error("at most 10 Predict wallets are supported");
    }
    this.wallets = initialWallets.map((wallet) => normalizeWallet(wallet));
  }

  getWallets(): WalletInfo[] {
    return this.wallets.map((wallet) => ({ ...wallet }));
  }

  getWallet(address: string): WalletInfo | undefined {
    const normalized = address.trim().toLowerCase();
    const wallet = this.wallets.find((candidate) => candidate.address.trim().toLowerCase() === normalized);
    return wallet ? { ...wallet } : undefined;
  }

  getAvailableFunds(address: string): number {
    return this.getWallet(address)?.availableUsd ?? 0;
  }

  reserveForPlan(address: string, planId: string, amountUsd: number): void {
    const wallet = this.findMutableWallet(address);
    if (wallet === undefined) throw new Error("wallet not found");
    const amount = safeNonNegativeNumber(amountUsd);
    if (amount <= 0) return;
    if (wallet.availableUsd < amount) throw new Error("insufficient funds");

    let walletReservations = this.reservations.get(wallet.address);
    if (walletReservations === undefined) {
      walletReservations = new Map<string, number>();
      this.reservations.set(wallet.address, walletReservations);
    }
    const previous = walletReservations.get(planId) ?? 0;
    walletReservations.set(planId, previous + amount);
    wallet.reservedUsd = roundUsd(wallet.reservedUsd + amount);
    wallet.availableUsd = roundUsd(Math.max(0, wallet.balanceUsd - wallet.reservedUsd));
    this.lastUpdatedMs = Date.now();
  }

  releaseReservation(address: string, planId: string, amountUsd?: number): void {
    const wallet = this.findMutableWallet(address);
    if (wallet === undefined) return;
    const walletReservations = this.reservations.get(wallet.address);
    const reservedForPlan = walletReservations?.get(planId) ?? 0;
    if (reservedForPlan <= 0) return;

    const releaseAmount = amountUsd === undefined ? reservedForPlan : Math.min(reservedForPlan, safeNonNegativeNumber(amountUsd));
    const remaining = roundUsd(reservedForPlan - releaseAmount);
    if (remaining > 0) {
      walletReservations?.set(planId, remaining);
    } else {
      walletReservations?.delete(planId);
    }
    if (walletReservations && walletReservations.size === 0) this.reservations.delete(wallet.address);

    wallet.reservedUsd = roundUsd(Math.max(0, wallet.reservedUsd - releaseAmount));
    wallet.availableUsd = roundUsd(Math.max(0, wallet.balanceUsd - wallet.reservedUsd));
    this.lastUpdatedMs = Date.now();
  }

  getWalletWithMostAvailable(): WalletInfo | undefined {
    const wallet = [...this.wallets]
      .filter((candidate) => candidate.role === "predict_account")
      .sort((left, right) => right.availableUsd - left.availableUsd)[0];
    return wallet ? { ...wallet } : undefined;
  }

  getPolymarketHedgeWallet(): WalletInfo | undefined {
    const wallet = this.wallets.find((candidate) => candidate.role === "polymarket_hedge");
    return wallet ? { ...wallet } : undefined;
  }

  snapshot(): WalletManagerState {
    return {
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      canExecuteHedge: false,
      lastUpdatedMs: this.lastUpdatedMs,
      wallets: this.getWallets(),
    };
  }

  private findMutableWallet(address: string): WalletInfo | undefined {
    const normalized = address.trim().toLowerCase();
    return this.wallets.find((candidate) => candidate.address.trim().toLowerCase() === normalized);
  }
}

export function buildWalletManagerDashboardResponse(
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): WalletManagerDashboardResponse {
  const { wallets, warnings, paperSimulation } = walletsFromEnv(env);
  const manager = new WalletManager(wallets);
  const snapshot = manager.snapshot();
  const predictWallets = snapshot.wallets.filter((wallet) => wallet.role === "predict_account");
  const polymarketWallet = manager.getPolymarketHedgeWallet() ?? null;
  const publicPredictWallets = predictWallets.map(toPublicWalletInfo);
  const publicPolymarketWallet = polymarketWallet === null ? null : toPublicWalletInfo(polymarketWallet);
  const allWarnings = [...warnings];

  if (predictWallets.length === 0) allWarnings.push("predict_wallets_not_configured");
  if (polymarketWallet === null) allWarnings.push("polymarket_hedge_wallet_not_configured");
  if (parseBool(env.HEDGE_LIVE_TRADING_ENABLED, false)) allWarnings.push("live_trading_request_ignored_in_wallet_manager");

  return {
    schemaVersion: 1,
    mode: "dry_run",
    readOnly: true,
    liveTradingEnabled: false,
    canExecuteHedge: false,
    generatedAt: now.toISOString(),
    walletPolicy: {
      maxPredictWallets: 10,
      polymarketHedgeWalletsAllowed: 1,
      frontendSigningAllowed: false,
      frontendTransactionsAllowed: false,
    },
    summary: {
      predictWalletCount: predictWallets.length,
      maxPredictWallets: 10,
      polymarketHedgeWalletCount: polymarketWallet === null ? 0 : 1,
      totalPredictBalanceUsd: roundUsd(sum(predictWallets, (wallet) => wallet.balanceUsd)),
      totalPredictReservedUsd: roundUsd(sum(predictWallets, (wallet) => wallet.reservedUsd)),
      totalPredictAvailableUsd: roundUsd(sum(predictWallets, (wallet) => wallet.availableUsd)),
      totalPredictNetExposureUsd: roundUsd(sum(predictWallets, (wallet) => wallet.netExposureUsd)),
      totalPredictAbsExposureUsd: roundUsd(sum(predictWallets, (wallet) => Math.abs(wallet.netExposureUsd))),
      polymarketBalanceUsd: polymarketWallet?.balanceUsd ?? 0,
      polymarketReservedUsd: polymarketWallet?.reservedUsd ?? 0,
      polymarketAvailableUsd: polymarketWallet?.availableUsd ?? 0,
      currentPlannedHedgeUsd: polymarketWallet?.currentPlannedHedgeUsd ?? 0,
    },
    paperSimulation,
    predictWallets: publicPredictWallets,
    polymarketHedgeWallet: publicPolymarketWallet,
    warnings: [...new Set(allWarnings)],
  };
}

export function walletInfo(input: {
  id: string;
  venue: WalletVenue;
  role: WalletRole;
  address?: string;
  chainId?: number | null;
  network?: string | null;
  balanceUsd?: number;
  reservedUsd?: number;
  yesExposureUsd?: number;
  noExposureUsd?: number;
  netExposureUsd?: number;
  currentPlannedHedgeUsd?: number;
  status?: string;
  paperSimulated?: boolean;
}): WalletInfo {
  const balanceUsd = safeNonNegativeNumber(input.balanceUsd);
  const reservedUsd = Math.min(balanceUsd, safeNonNegativeNumber(input.reservedUsd));
  const yesExposureUsd = safeNumber(input.yesExposureUsd);
  const noExposureUsd = safeNumber(input.noExposureUsd);
  const netExposureUsd = input.netExposureUsd === undefined ? yesExposureUsd - noExposureUsd : safeNumber(input.netExposureUsd);
  const address = input.address?.trim() ?? "";

  return {
    id: input.id,
    venue: input.venue,
    role: input.role,
    address,
    addressMasked: address === "" ? "-" : maskAddress(address),
    chainId: input.chainId ?? 137,
    network: input.network ?? "Polygon",
    balanceUsd: roundUsd(balanceUsd),
    reservedUsd: roundUsd(reservedUsd),
    availableUsd: roundUsd(Math.max(0, balanceUsd - reservedUsd)),
    yesExposureUsd: roundUsd(yesExposureUsd),
    noExposureUsd: roundUsd(noExposureUsd),
    netExposureUsd: roundUsd(netExposureUsd),
    currentPlannedHedgeUsd: roundUsd(safeNonNegativeNumber(input.currentPlannedHedgeUsd)),
    dryRun: true,
    liveTradingEnabled: false,
    readOnly: true,
    status: input.status ?? "unknown",
    ...(input.paperSimulated ? { paperSimulated: true } : {}),
  };
}

function walletsFromEnv(
  env: NodeJS.ProcessEnv,
): { wallets: WalletInfo[]; warnings: string[]; paperSimulation: PaperSimulationStatus } {
  const warnings: string[] = [];
  const predictWallets = predictWalletsFromEnv(env, warnings);
  const polymarketWallet = polymarketWalletFromEnv(env);
  const paperSimulation = paperSimulationFromEnv(env, predictWallets.length, polymarketWallet !== undefined);
  const paperPredictWallets = paperSimulation.enabled && predictWallets.length === 0
    ? paperPredictWalletsFromSimulation(paperSimulation)
    : [];
  const paperPolymarketWallet = paperSimulation.enabled && polymarketWallet === undefined
    ? paperPolymarketWalletFromSimulation(paperSimulation)
    : undefined;
  const wallets = [
    ...predictWallets,
    ...paperPredictWallets,
    ...(polymarketWallet ? [polymarketWallet] : []),
    ...(paperPolymarketWallet ? [paperPolymarketWallet] : []),
  ];

  if (paperSimulation.enabled) {
    warnings.push("paper_simulated_wallets_enabled");
    if (predictWallets.length === 0) warnings.push("real_predict_wallets_not_configured_using_paper_simulation");
    if (polymarketWallet === undefined) warnings.push("real_polymarket_hedge_wallet_not_configured_using_paper_simulation");
  }

  return { wallets, warnings, paperSimulation };
}

function paperSimulationFromEnv(
  env: NodeJS.ProcessEnv,
  realPredictWalletCount: number,
  realPolymarketHedgeWalletConfigured: boolean,
): PaperSimulationStatus {
  const predictWalletCount = clampInteger(numberEnv(env.PAPER_SIM_PREDICT_WALLET_COUNT, 10), 0, 10);
  const predictWalletFundsUsd = safeNonNegativeNumber(numberEnv(env.PAPER_SIM_PREDICT_WALLET_FUNDS_USD, 100));
  const polymarketHedgeFundsUsd = safeNonNegativeNumber(
    numberEnv(env.PAPER_SIM_POLYMARKET_HEDGE_FUNDS_USD ?? env.PAPER_SIM_FUNDS_USD, 100),
  );
  const simulatedNetExposureUsd = safeNumber(numberEnv(env.PAPER_SIM_NET_EXPOSURE_USD, 20));
  const hedgeRatio = clampNumber(numberEnv(env.PAPER_HEDGE_RATIO, 0.5), 0, 1);
  const maxOrderUsd = safeNonNegativeNumber(numberEnv(env.PAPER_MAX_ORDER_USD, 10));
  const plannedHedgeUsd = roundUsd(
    Math.min(Math.abs(simulatedNetExposureUsd) * hedgeRatio, maxOrderUsd, polymarketHedgeFundsUsd),
  );

  return {
    enabled: parseBool(env.PAPER_SIMULATE_WALLETS, false),
    predictWalletCount,
    predictWalletFundsUsd: roundUsd(predictWalletFundsUsd),
    polymarketHedgeFundsUsd: roundUsd(polymarketHedgeFundsUsd),
    simulatedNetExposureUsd: roundUsd(simulatedNetExposureUsd),
    plannedHedgeUsd,
    realPredictWalletCount,
    realPolymarketHedgeWalletConfigured,
  };
}

function paperPredictWalletsFromSimulation(paperSimulation: PaperSimulationStatus): WalletInfo[] {
  return Array.from({ length: paperSimulation.predictWalletCount }, (_, index) => {
    const netExposureUsd = index === 0 ? paperSimulation.simulatedNetExposureUsd : 0;
    return walletInfo({
      id: `paper-predict-${index + 1}`,
      venue: "PREDICT",
      role: "predict_account",
      address: `paper-p${String(index + 1).padStart(2, "0")}`,
      chainId: null,
      network: "Paper",
      balanceUsd: paperSimulation.predictWalletFundsUsd,
      netExposureUsd,
      yesExposureUsd: netExposureUsd > 0 ? netExposureUsd : 0,
      noExposureUsd: netExposureUsd < 0 ? Math.abs(netExposureUsd) : 0,
      status: "paper_simulated",
      paperSimulated: true,
    });
  });
}

function paperPolymarketWalletFromSimulation(paperSimulation: PaperSimulationStatus): WalletInfo {
  return walletInfo({
    id: "paper-polymarket-hedge",
    venue: "POLYMARKET",
    role: "polymarket_hedge",
    address: "paper-poly",
    chainId: null,
    network: "Paper",
    balanceUsd: paperSimulation.polymarketHedgeFundsUsd,
    currentPlannedHedgeUsd: paperSimulation.plannedHedgeUsd,
    status: "paper_hedge_only",
    paperSimulated: true,
  });
}

function predictWalletsFromEnv(env: NodeJS.ProcessEnv, warnings: string[]): WalletInfo[] {
  const jsonWallets = parsePredictWalletsJson(env.PREDICT_WALLETS_JSON, warnings);
  if (jsonWallets.length > 0) return jsonWallets.slice(0, 10);

  const addresses = listEnv(env.PREDICT_WALLET_ADDRESSES ?? env.PREDICT_ACCOUNT_ADDRESSES);
  const balances = listEnv(env.PREDICT_WALLET_BALANCES_USD);
  const reserved = listEnv(env.PREDICT_WALLET_RESERVED_USD);
  const yesExposures = listEnv(env.PREDICT_WALLET_YES_EXPOSURES_USD);
  const noExposures = listEnv(env.PREDICT_WALLET_NO_EXPOSURES_USD);
  const netExposures = listEnv(env.PREDICT_WALLET_NET_EXPOSURES_USD);
  const statuses = listEnv(env.PREDICT_WALLET_STATUSES);
  const accountCount = Math.min(10, Math.max(addresses.length, Math.floor(numberEnv(env.PREDICT_ACCOUNT_COUNT, 0))));

  if (Number(env.PREDICT_ACCOUNT_COUNT) > 10) warnings.push("predict_wallet_count_exceeds_10");

  return Array.from({ length: accountCount }, (_, index) =>
    walletInfo({
      id: `predict-${index + 1}`,
      venue: "PREDICT",
      role: "predict_account",
      address: addresses[index] ?? "",
      balanceUsd: numberEnv(balances[index], 0),
      reservedUsd: numberEnv(reserved[index], 0),
      yesExposureUsd: numberEnv(yesExposures[index], 0),
      noExposureUsd: numberEnv(noExposures[index], 0),
      netExposureUsd: netExposures[index] === undefined ? undefined : numberEnv(netExposures[index], 0),
      status: statuses[index] ?? "READY",
    }),
  );
}

function parsePredictWalletsJson(raw: string | undefined, warnings: string[]): WalletInfo[] {
  if (raw === undefined || raw.trim() === "") return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      warnings.push("predict_wallets_json_invalid");
      return [];
    }
    if (parsed.length > 10) warnings.push("predict_wallet_count_exceeds_10");
    return parsed.slice(0, 10).map((item, index) => {
      const record = isRecord(item) ? item : {};
      return walletInfo({
        id: stringValue(record.id ?? record.accountId, `predict-${index + 1}`),
        venue: "PREDICT",
        role: "predict_account",
        address: stringValue(record.address ?? record.walletAddress, ""),
        chainId: nullableNumber(record.chainId, 137),
        network: stringValue(record.network, "Polygon"),
        balanceUsd: numberValue(record.balanceUsd ?? record.balance, 0),
        reservedUsd: numberValue(record.reservedUsd, 0),
        yesExposureUsd: numberValue(record.yesExposureUsd, 0),
        noExposureUsd: numberValue(record.noExposureUsd, 0),
        netExposureUsd: record.netExposureUsd === undefined ? undefined : numberValue(record.netExposureUsd, 0),
        status: stringValue(record.status, "READY"),
      });
    });
  } catch {
    warnings.push("predict_wallets_json_invalid");
    return [];
  }
}

function polymarketWalletFromEnv(env: NodeJS.ProcessEnv): WalletInfo | undefined {
  const address = firstValue(env.POLYMARKET_FUNDER_ADDRESS, env.BACKEND_TRADING_ADDRESS, env.POLYMARKET_WALLET_ADDRESS);
  const configured = address !== undefined || parseBool(env.POLYMARKET_HEDGE_WALLET_CONFIGURED, false);
  if (!configured) return undefined;

  return walletInfo({
    id: env.POLYMARKET_HEDGE_WALLET_ID ?? "polymarket-hedge",
    venue: "POLYMARKET",
    role: "polymarket_hedge",
    address: address ?? "",
    chainId: nullableNumber(env.POLYMARKET_CHAIN_ID, 137),
    network: nullableString(env.POLYMARKET_NETWORK, "Polygon"),
    balanceUsd: numberEnv(env.POLYMARKET_BALANCE_USD, 0),
    reservedUsd: numberEnv(env.POLYMARKET_RESERVED_USD, 0),
    currentPlannedHedgeUsd: numberEnv(env.POLYMARKET_CURRENT_PLANNED_HEDGE_USD, 0),
    status: env.POLYMARKET_WALLET_STATUS ?? "hedge_only",
  });
}

function normalizeWallet(wallet: WalletInfo): WalletInfo {
  return walletInfo({
    ...wallet,
    address: wallet.address,
    chainId: wallet.chainId,
    network: wallet.network,
  });
}

function toPublicWalletInfo(wallet: WalletInfo): PublicWalletInfo {
  const { address: _address, ...publicWallet } = wallet;
  return publicWallet;
}

function sum(wallets: readonly WalletInfo[], selector: (wallet: WalletInfo) => number): number {
  return wallets.reduce((total, wallet) => total + selector(wallet), 0);
}

function listEnv(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function firstValue(...values: (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined && value.trim() !== "");
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function nullableString(value: unknown, fallback: string | null): string | null {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim();
  if (normalized === "" || normalized.toLowerCase() === "null") return null;
  return normalized;
}

function nullableNumber(value: unknown, fallback: number | null): number | null {
  const normalized = nullableString(value, fallback === null ? null : String(fallback));
  if (normalized === null) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  return numberValue(value, fallback);
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim();
  return normalized === "" ? fallback : normalized;
}

function safeNumber(value: unknown): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function safeNonNegativeNumber(value: unknown): number {
  return Math.max(0, safeNumber(value));
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.floor(clampNumber(value, min, max));
}

function maskAddress(address: string): string {
  const normalized = address.trim();
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
