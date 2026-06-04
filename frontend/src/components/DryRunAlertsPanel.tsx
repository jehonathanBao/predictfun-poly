import { useEffect, useState } from "react";
import type { DryRunAlert, DryRunAlerts } from "../types";

const DRY_RUN_ALERTS_URL = import.meta.env.VITE_DRY_RUN_ALERTS_URL ?? "/api/dry-run-alerts?limit=100";

export function DryRunAlertsPanel() {
  const [payload, setPayload] = useState<DryRunAlerts>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch(DRY_RUN_ALERTS_URL);
        if (!response.ok) throw new Error(`dry-run alerts API returned ${response.status}`);
        const data = (await response.json()) as DryRunAlerts;
        if (!active) return;
        setPayload(data);
        setError(undefined);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load dry-run alerts");
      }
    }

    void load();
    const intervalId = window.setInterval(load, 5_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <section className="dryRunAlertsPanel" aria-label="dry-run alerts">
      <div className="dryRunHeader">
        <div>
          <h2>Dry-Run Alerts</h2>
          <p>Read-only warnings from replay history</p>
        </div>
        <span className={`alertSeverity ${payload?.severity ?? "info"}`}>{payload?.severity ?? "loading"}</span>
      </div>

      {error ? <div className="dryRunError">{error}</div> : null}

      <div className="alertList">
        {payload?.alerts.length === 0 ? <span className="alertOk">no alerts</span> : null}
        {payload?.alerts.map((alert) => <AlertRow alert={alert} key={alert.code} />)}
      </div>
    </section>
  );
}

function AlertRow({ alert }: { alert: DryRunAlert }) {
  return (
    <div className={`alertRow ${alert.severity}`}>
      <div>
        <strong>{alert.code}</strong>
        <span>{alert.message}</span>
      </div>
      <div className="alertNumbers">
        {alert.value !== undefined ? <span>value {formatNumber(alert.value)}</span> : null}
        {alert.count !== undefined ? <span>count {formatNumber(alert.count)}</span> : null}
        {alert.threshold !== undefined ? <span>limit {formatNumber(alert.threshold)}</span> : null}
      </div>
    </div>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value);
}
