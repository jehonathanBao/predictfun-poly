import type { DashboardStatus } from "../types";

interface RuntimeStatusPanelProps {
  status?: DashboardStatus;
}

export function RuntimeStatusPanel({ status }: RuntimeStatusPanelProps) {
  return (
    <section className="runtimePanel" aria-label="dashboard runtime status">
      <RuntimeItem label="API Status" value={status?.apiStatus.toUpperCase() ?? "LOADING"} tone="ok" />
      <RuntimeItem
        label="Bot Status"
        value={formatBotStatus(status?.botStatus)}
        tone={statusTone(status?.botStatus)}
      />
      <RuntimeItem label="Data Source" value={status?.dataSource ?? "loading"} />
      <RuntimeItem label="Last Updated" value={formatTimestamp(status?.lastUpdated)} />
      <RuntimeItem label="Data Age" value={formatAge(status?.dataAgeMs)} tone={ageTone(status)} />
      <RuntimeItem label="Total" value={formatNumber(status?.planCount)} />
      <RuntimeItem label="Approved" value={formatNumber(status?.approvedCount)} tone="ok" />
      <RuntimeItem label="Rejected" value={formatNumber(status?.rejectedCount)} tone={status?.rejectedCount ? "warn" : "ok"} />
      <RuntimeItem label="Max Exposure" value={`$${formatNumber(status?.maxAbsExposureUsd)}`} />
      {status?.dataSource === "paper_live" ? <RuntimeBadge label="Paper Mode" tone="warn" /> : null}
      <RuntimeBadge label="Read-only" tone="ok" />
      <RuntimeBadge label="Live disabled" tone="ok" />
    </section>
  );
}

function RuntimeItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "neutral";
}) {
  return (
    <div className={`runtimeItem ${tone ?? "neutral"}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RuntimeBadge({ label, tone }: { label: string; tone: "ok" | "warn" }) {
  return <div className={`runtimeBadge ${tone}`}>{label}</div>;
}

function formatBotStatus(value: DashboardStatus["botStatus"] | undefined): string {
  if (value === "fresh") return "Fresh";
  if (value === "stale") return "Stale";
  if (value === "no_data") return "No data";
  return "Loading";
}

function statusTone(value: DashboardStatus["botStatus"] | undefined): "ok" | "warn" | "neutral" {
  if (value === "fresh") return "ok";
  if (value === "stale" || value === "no_data") return "warn";
  return "neutral";
}

function ageTone(status: DashboardStatus | undefined): "ok" | "warn" | "neutral" {
  if (!status || status.dataAgeMs === null) return "neutral";
  return status.dataAgeMs <= status.staleThresholdMs ? "ok" : "warn";
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString();
}

function formatAge(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  if (value < 1_000) return `${value} ms`;
  return `${(value / 1_000).toFixed(1)} s`;
}

function formatNumber(value: number | undefined): string {
  if (value === undefined) return "-";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value);
}
