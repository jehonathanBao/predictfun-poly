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

export interface HedgePlanEnvelope {
  schemaVersion: 1;
  generatedAt: string;
  dataSource: "snapshot_env" | "latest_file" | "example_snapshot" | "empty_fallback";
  source: string;
  mode: "dry_run";
  liveTradingEnabled: false;
  plans: HedgePlan[];
  summary: HedgePlanSummary;
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
