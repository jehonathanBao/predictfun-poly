import { useEffect, useState } from "react";
import type { DryRunSummary } from "../types";

const DRY_RUN_SUMMARY_URL = import.meta.env.VITE_DRY_RUN_SUMMARY_URL ?? "/api/dry-run-summary?limit=100";

export function DryRunSummaryPanel({ onSummary }: { onSummary?: (summary: DryRunSummary) => void }) {
  const [summary, setSummary] = useState<DryRunSummary>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch(DRY_RUN_SUMMARY_URL);
        if (!response.ok) throw new Error(`dry-run summary API returned ${response.status}`);
        const payload = (await response.json()) as DryRunSummary;
        if (!active) return;
        setSummary(payload);
        onSummary?.(payload);
        setError(undefined);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load dry-run summary");
      }
    }

    void load();
    const intervalId = window.setInterval(load, 5_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [onSummary]);

  return (
    <section className="dryRunSummaryPanel" aria-label="dry-run replay summary">
      <div className="dryRunHeader">
        <div>
          <h2>Dry-Run Replay</h2>
          <p>Historical hedge plan summary</p>
        </div>
        <span className="dryRunMode">read-only</span>
      </div>

      <div className="dryRunMetricGrid">
        <SummaryItem label="History records" value={formatNumber(summary?.recordCount)} />
        <SummaryItem label="Total plans" value={formatNumber(summary?.planCount)} />
        <SummaryItem label="Approved" value={formatNumber(summary?.approvedCount)} tone="ok" />
        <SummaryItem label="Rejected" value={formatNumber(summary?.rejectedCount)} tone={summary?.rejectedCount ? "warn" : "ok"} />
        <SummaryItem label="Max exposure" value={`$${formatNumber(summary?.maxAbsExposureUsd)}`} />
      </div>

      {error ? <div className="dryRunError">{error}</div> : null}

      <div className="distributionGrid">
        <Distribution title="Top reject reasons" values={summary?.rejectReasonCounts} emptyLabel="no reject reasons" />
        <Distribution title="Top risk codes" values={summary?.riskCodeCounts} emptyLabel="no risk codes" />
      </div>
    </section>
  );
}

function SummaryItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className={`dryRunMetric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Distribution({
  title,
  values,
  emptyLabel,
}: {
  title: string;
  values?: Record<string, number>;
  emptyLabel: string;
}) {
  const rows = Object.entries(values ?? {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6);

  return (
    <div className="distributionBox">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <span className="distributionEmpty">{emptyLabel}</span>
      ) : (
        <div className="distributionRows">
          {rows.map(([label, count]) => (
            <div className="distributionRow" key={label}>
              <span>{label}</span>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatNumber(value: number | undefined): string {
  if (value === undefined) return "-";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value);
}
