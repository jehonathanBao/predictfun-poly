import type { HedgePlan, PaperLiveStatus } from "../types";

interface DryRunDiagnosticsPanelProps {
  plans: readonly HedgePlan[];
  paperLive?: PaperLiveStatus;
}

const MAX_DIAGNOSTIC_ROWS = 8;

export function DryRunDiagnosticsPanel({ plans, paperLive }: DryRunDiagnosticsPanelProps) {
  const diagnosticPlans = plans.slice(0, MAX_DIAGNOSTIC_ROWS);

  return (
    <section className="diagnosticsPanel" aria-label="paper live diagnostics">
      <div className="diagnosticsHeader">
        <div>
          <h2>Dry-Run Diagnostics</h2>
          <p>Read-only paper-live orderbook and plan health</p>
        </div>
        <div className="diagnosticsBadges">
          {paperLive?.enabled ? <span className="diagnosticBadge paper">Paper Mode</span> : null}
          <span className="diagnosticBadge safe">read-only</span>
        </div>
      </div>

      <div className="diagnosticsGrid">
        <DiagnosticMetric label="Market data" value={marketDataLabel(paperLive)} />
        <DiagnosticMetric label="Source" value={paperLive?.sourceLabel ?? "-"} />
        <DiagnosticMetric label="Token" value={paperLive?.tokenIdMasked ?? paperLive?.polymarketTokenIdMasked ?? "-"} />
        <DiagnosticMetric label="URL host" value={paperLive?.marketDataUrlHost ?? "-"} />
        <DiagnosticMetric label="Last fetch" value={formatTimestamp(paperLive?.lastFetchAt)} />
        <DiagnosticMetric label="Fetch error" value={paperLive?.fetchErrorCode ?? "-"} tone={paperLive?.fetchErrorCode ? "warn" : "ok"} />
      </div>

      <div className="diagnosticsTableShell">
        <table className="diagnosticsTable">
          <thead>
            <tr>
              <th>Market</th>
              <th>Direction</th>
              <th className="number">Bid</th>
              <th className="number">Ask</th>
              <th className="number">Spread</th>
              <th className="number">Depth</th>
              <th className="number">Hedge</th>
              <th>Diagnostics</th>
            </tr>
          </thead>
          <tbody>
            {diagnosticPlans.length ? (
              diagnosticPlans.map((plan) => (
                <tr key={`${plan.eventKey}:${plan.marketId}`}>
                  <td className="mono">{plan.marketId}</td>
                  <td>
                    <span className={`badge ${plan.hedgeDirection.toLowerCase()}`}>{plan.hedgeDirection}</span>
                  </td>
                  <td className="number">{formatPrice(plan.metadata?.bestBid)}</td>
                  <td className="number">{formatPrice(plan.metadata?.bestAsk)}</td>
                  <td className="number">{formatPrice(plan.metadata?.spread)}</td>
                  <td className="number">{formatUsd(plan.metadata?.depthUsd)}</td>
                  <td className="number">{formatUsd(plan.hedgeSizeUsd)}</td>
                  <td>
                    <DiagnosticBadges plan={plan} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="mutedText">
                  no paper-live diagnostics yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DiagnosticBadges({ plan }: { plan: HedgePlan }) {
  const badges = diagnosticBadges(plan);
  return (
    <div className="diagnosticsBadges">
      {badges.length ? (
        badges.map((badge) => (
          <span className={`diagnosticBadge ${badge.tone}`} key={badge.label}>
            {badge.label}
          </span>
        ))
      ) : (
        <span className="diagnosticBadge ok">orderbook ok</span>
      )}
    </div>
  );
}

function diagnosticBadges(plan: HedgePlan): { label: string; tone: "ok" | "warn" | "paper" | "safe" }[] {
  const codes = new Set(plan.riskCodes);
  const badges: { label: string; tone: "ok" | "warn" | "paper" | "safe" }[] = [];
  if (codes.has("paper_orderbook_stale")) badges.push({ label: "stale", tone: "warn" });
  if (codes.has("paper_orderbook_spread_too_wide")) badges.push({ label: "wide spread", tone: "warn" });
  if (codes.has("paper_orderbook_depth_insufficient") || codes.has("paper_market_depth_unavailable")) {
    badges.push({ label: "shallow depth", tone: "warn" });
  }
  if (codes.has("paper_orderbook_schema_invalid")) badges.push({ label: "schema invalid", tone: "warn" });
  if (plan.metadata?.fetchErrorCode) badges.push({ label: plan.metadata.fetchErrorCode, tone: "warn" });
  if (plan.rejectReason && !badges.some((badge) => badge.label === plan.rejectReason)) {
    badges.push({ label: plan.rejectReason, tone: "warn" });
  }
  return badges;
}

function DiagnosticMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className={`diagnosticMetric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function marketDataLabel(status: PaperLiveStatus | undefined): string {
  if (!status) return "-";
  if (status.marketDataSource === "fixture") return `fixture${status.fixtureScenario ? `:${status.fixtureScenario}` : ""}`;
  if (status.marketDataSource === "polymarket_clob_book") return "Polymarket CLOB";
  if (status.marketDataSource === "market_data_url") return "market URL";
  return "none";
}

function formatPrice(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  return value.toFixed(4);
}

function formatUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  return `$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value)}`;
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString() : value;
}
