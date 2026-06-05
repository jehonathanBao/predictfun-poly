import { useEffect, useMemo, useState } from "react";
import type { OperatorLogLevel, OperatorLogRecord, OperatorLogResponse } from "../types";

const OPERATOR_LOG_URL = import.meta.env.VITE_OPERATOR_LOG_URL ?? "/api/operator-logs";
const LEVELS: readonly ("all" | OperatorLogLevel)[] = ["all", "info", "warn", "error", "debug"];
const COMPONENTS = ["all", "dry-run-worker", "market-data", "dashboard-api"] as const;

export function OperatorLogPanel() {
  const [records, setRecords] = useState<OperatorLogRecord[]>([]);
  const [level, setLevel] = useState<"all" | OperatorLogLevel>("all");
  const [component, setComponent] = useState<(typeof COMPONENTS)[number]>("all");
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const params = new URLSearchParams({ limit: "100" });
        if (level !== "all") params.set("level", level);
        if (component !== "all") params.set("component", component);
        const response = await fetch(`${OPERATOR_LOG_URL}?${params.toString()}`);
        if (!response.ok) throw new Error(`operator log API returned ${response.status}`);
        const payload = (await response.json()) as OperatorLogResponse;
        if (!active) return;
        setRecords(payload.records);
        setError(undefined);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load operator logs");
      }
    }

    void load();
    const intervalId = window.setInterval(load, 5_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [component, level]);

  const visibleRecords = useMemo(() => records.slice(0, 40), [records]);

  return (
    <section className="operatorLogPanel" aria-label="operator logs">
      <div className="operatorLogHeader">
        <div>
          <h2>Operator Logs</h2>
          <p>Read-only paper-live startup, market data, and plan events</p>
        </div>
        <div className="operatorLogBadges">
          <span className="operatorLogBadge safe">read-only</span>
          <span className="operatorLogBadge safe">dry-run</span>
        </div>
      </div>

      <div className="operatorLogControls" aria-label="operator log filters">
        <div className="operatorLogFilterGroup">
          {LEVELS.map((item) => (
            <button className={level === item ? "active" : undefined} key={item} onClick={() => setLevel(item)}>
              {item}
            </button>
          ))}
        </div>
        <div className="operatorLogFilterGroup components">
          {COMPONENTS.map((item) => (
            <button className={component === item ? "active" : undefined} key={item} onClick={() => setComponent(item)}>
              {componentLabel(item)}
            </button>
          ))}
        </div>
      </div>

      {error ? <div className="operatorLogError">{error}</div> : null}

      <div className="operatorLogTableShell">
        <table className="operatorLogTable">
          <thead>
            <tr>
              <th>Time</th>
              <th>Level</th>
              <th>Component</th>
              <th>Event</th>
              <th>Message</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {visibleRecords.length ? (
              visibleRecords.map((record) => (
                <tr key={`${record.ts}:${record.component}:${record.event}:${record.message}`}>
                  <td className="mono">{formatTimestamp(record.ts)}</td>
                  <td>
                    <span className={`operatorLogLevel ${record.level}`}>{record.level}</span>
                  </td>
                  <td className="mono">{record.component}</td>
                  <td className="mono">{record.event}</td>
                  <td>{record.message}</td>
                  <td className="mono">{formatDetails(record.data)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="mutedText">
                  no operator logs yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function componentLabel(value: (typeof COMPONENTS)[number]): string {
  if (value === "dry-run-worker") return "worker";
  if (value === "market-data") return "market";
  if (value === "dashboard-api") return "api";
  return "all";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString() : value;
}

function formatDetails(value: Record<string, unknown> | undefined): string {
  if (value === undefined) return "-";
  const compact = JSON.stringify(value);
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}
