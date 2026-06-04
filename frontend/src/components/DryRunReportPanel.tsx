import { useEffect, useState } from "react";
import type { DryRunReport } from "../types";

const DRY_RUN_REPORT_URL = import.meta.env.VITE_DRY_RUN_REPORT_URL ?? "/api/dry-run-report?limit=100";

export function DryRunReportPanel() {
  const [report, setReport] = useState<DryRunReport>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch(DRY_RUN_REPORT_URL);
        if (!response.ok) throw new Error(`dry-run report API returned ${response.status}`);
        const payload = (await response.json()) as DryRunReport;
        if (!active) return;
        setReport(payload);
        setError(undefined);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load dry-run report");
      }
    }

    void load();
    const intervalId = window.setInterval(load, 10_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <section className="dryRunReportPanel" aria-label="dry-run daily report">
      <div className="dryRunHeader">
        <div>
          <h2>Dry-Run Report</h2>
          <p>Daily replay export summary</p>
        </div>
        <span className="dryRunMode">{report?.reportDate ?? "loading"}</span>
      </div>

      <div className="dryRunMetricGrid">
        <ReportMetric label="Records" value={formatNumber(report?.recordCount)} />
        <ReportMetric label="Plans" value={formatNumber(report?.planCount)} />
        <ReportMetric label="Approved" value={formatNumber(report?.approvedCount)} tone="ok" />
        <ReportMetric label="Rejected" value={formatNumber(report?.rejectedCount)} tone={report?.rejectedCount ? "warn" : "ok"} />
        <ReportMetric label="Max Exposure" value={`$${formatNumber(report?.maxAbsExposureUsd)}`} />
      </div>

      {error ? <div className="dryRunError">{error}</div> : null}

      <div className="reportGrid">
        <ReportList title="Top reject reasons" rows={report?.topRejectReasons} emptyLabel="no reject reasons" />
        <ReportList title="Top risk codes" rows={report?.topRiskCodes} emptyLabel="no risk codes" />
        <div className="reportBox wide">
          <h3>Recommendations</h3>
          {report?.recommendations.length === 0 ? (
            <span className="distributionEmpty">no recommendations</span>
          ) : (
            <div className="recommendationList">
              {report?.recommendations.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ReportMetric({
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

function ReportList({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows?: { code: string; count: number }[];
  emptyLabel: string;
}) {
  return (
    <div className="reportBox">
      <h3>{title}</h3>
      {!rows || rows.length === 0 ? (
        <span className="distributionEmpty">{emptyLabel}</span>
      ) : (
        <div className="distributionRows">
          {rows.map((row) => (
            <div className="distributionRow" key={row.code}>
              <span>{row.code}</span>
              <strong>{row.count}</strong>
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
