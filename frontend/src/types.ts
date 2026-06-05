export interface HedgeOrder {
  venue?: string;
  marketId: string;
  side: string;
  limitPrice: number;
  sizeUsd: string;
  postOnly: boolean;
}

export interface HedgePlan {
  strategy: "EXPOSURE_HEDGE";
  marketId: string;
  eventKey: string;
  hedgeDirection: string;
  netExposureUsd: number;
  hedgeSizeUsd: number;
  hedgeMarketId?: string;
  hedgeEventKey?: string;
  hedgeOrder?: HedgeOrder;
  exposureBeforeUsd: string;
  exposureAfterUsd: string;
  estimatedHedgeCostUsd: string;
  executable: false;
  dryRun: true;
  postOnly: boolean;
  rejectReason?: string;
  riskCodes: readonly string[];
  riskApproved: boolean;
}

export interface HedgePlanSummary {
  totalPlans: number;
  approvedCount: number;
  rejectedCount: number;
  maxAbsExposureUsd: number;
}

export interface PaperLiveStatus {
  enabled: boolean;
  sourceType: "none" | "market_data_url" | "polymarket_token_id";
  sourceLabel: string;
  marketDataUrlMasked?: string;
  polymarketTokenIdMasked?: string;
  maxSpread: number;
  minDepthUsd: number;
  maxMarketDataAgeMs: number;
}

export interface HedgePlanEnvelope {
  schemaVersion: 1;
  generatedAt: string;
  dataSource: "snapshot_env" | "latest_file" | "paper_live" | "example_snapshot" | "empty_fallback";
  source: string;
  mode: "dry_run";
  readOnly: true;
  liveTradingEnabled: false;
  plans: HedgePlan[];
  summary: HedgePlanSummary;
  paperLive?: PaperLiveStatus;
}

export type DashboardBotStatus = "fresh" | "stale" | "no_data";

export interface DashboardStatus {
  apiStatus: "ok";
  botStatus: DashboardBotStatus;
  readOnly: true;
  liveTradingEnabled: false;
  dataSource: HedgePlanEnvelope["dataSource"];
  lastUpdated: string | null;
  dataAgeMs: number | null;
  staleThresholdMs: number;
  planCount: number;
  approvedCount: number;
  rejectedCount: number;
  maxAbsExposureUsd: number;
}

export interface WalletStatus {
  mode: "dry_run";
  liveTradingEnabled: false;
  readOnly: true;
  expectedChainId: number | null;
  expectedChainName: string | null;
  backendTradingAddressMasked?: string;
  secretsLoaded: boolean;
  canExecuteHedge: false;
  allowedActions: readonly ["OPEN_PURE_ARBITRAGE"];
  blockedActions: readonly ["EXPOSURE_HEDGE", "SIMPLE_MARKET_MAKER_QUOTES"];
  allowFrontendSigning: false;
  allowFrontendTransactions: false;
}

export interface AccountHealth {
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

export type ManagedWalletVenue = "PREDICT" | "POLYMARKET";
export type ManagedWalletRole = "predict_account" | "polymarket_hedge";

export interface ManagedWallet {
  id: string;
  venue: ManagedWalletVenue;
  role: ManagedWalletRole;
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
}

export interface WalletManagerStatus {
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
  predictWallets: ManagedWallet[];
  polymarketHedgeWallet: ManagedWallet | null;
  warnings: readonly string[];
}

export interface DryRunTimelinePoint {
  generatedAt: string;
  planCount: number;
  approvedCount: number;
  rejectedCount: number;
  maxAbsExposureUsd: number;
}

export interface DryRunEventExposure {
  eventKey: string;
  latestNetExposureUsd: number;
  maxAbsExposureUsd: number;
  observationCount: number;
}

export interface DryRunSummary {
  schemaVersion: 1;
  mode: "dry_run";
  readOnly: true;
  liveTradingEnabled: false;
  generatedAt: string;
  recordCount: number;
  planCount: number;
  approvedCount: number;
  rejectedCount: number;
  maxAbsExposureUsd: number;
  rejectReasonCounts: Record<string, number>;
  riskCodeCounts: Record<string, number>;
  eventExposure: DryRunEventExposure[];
  timeline: DryRunTimelinePoint[];
}

export type DryRunAlertSeverity = "info" | "warning" | "critical";

export interface DryRunAlert {
  code: string;
  severity: DryRunAlertSeverity;
  message: string;
  value?: number;
  threshold?: number;
  count?: number;
}

export interface DryRunAlerts {
  schemaVersion: 1;
  mode: "dry_run";
  readOnly: true;
  liveTradingEnabled: false;
  generatedAt: string;
  severity: DryRunAlertSeverity;
  alerts: DryRunAlert[];
}

export interface DryRunReport {
  schemaVersion: 1;
  mode: "dry_run";
  readOnly: true;
  liveTradingEnabled: false;
  reportDate: string;
  recordCount: number;
  planCount: number;
  approvedCount: number;
  rejectedCount: number;
  topRejectReasons: { code: string; count: number }[];
  topRiskCodes: { code: string; count: number }[];
  maxAbsExposureUsd: number;
  recommendations: string[];
}
