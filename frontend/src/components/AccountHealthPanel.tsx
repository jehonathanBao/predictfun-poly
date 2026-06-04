import { useEffect, useState } from "react";
import type { AccountHealth } from "../types";

const ACCOUNT_HEALTH_URL = import.meta.env.VITE_ACCOUNT_HEALTH_URL ?? "/api/account-health";

export function AccountHealthPanel() {
  const [health, setHealth] = useState<AccountHealth>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch(ACCOUNT_HEALTH_URL);
        if (!response.ok) throw new Error(`account health API returned ${response.status}`);
        const payload = (await response.json()) as AccountHealth;
        if (!active) return;
        setHealth(payload);
        setError(undefined);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load account health");
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
    <section className="accountHealthPanel" aria-label="account health status">
      <div className="accountHealthHeader">
        <div>
          <h2>Account Health</h2>
          <p>Read-only configuration and usage status</p>
        </div>
        <span className="accountHealthMode">dry-run</span>
      </div>

      <div className="accountHealthGrid">
        <HealthItem label="Mode" value={health?.mode ?? "loading"} />
        <HealthItem label="Read-only" value={health?.readOnly ? "true" : "loading"} tone="ok" />
        <HealthItem label="Live trading" value={health?.liveTradingEnabled === false ? "disabled" : "loading"} tone="ok" />
        <HealthItem label="Backend wallet" value={health?.wallet.backendAddressMasked ?? "-"} />
        <HealthItem label="Expected chain" value={formatChain(health)} />
        <HealthItem label="Predict configured" value={yesNo(health?.predict.configured)} tone={health?.predict.configured ? "ok" : "warn"} />
        <HealthItem label="Predict usage" value={formatUsage(health)} tone={usageTone(health)} />
        <HealthItem label="Predict accounts" value={formatNumber(health?.predict.accountCount)} />
        <HealthItem label="Polymarket configured" value={yesNo(health?.polymarket.configured)} tone={health?.polymarket.configured ? "ok" : "warn"} />
        <HealthItem label="Allowed venues" value={health?.polymarket.allowedVenues.join(", ") ?? "-"} />
      </div>

      <div className="accountWarningList">
        {error ? <span className="accountWarning">{error}</span> : null}
        {health?.warnings.length === 0 ? <span className="accountOk">no warnings</span> : null}
        {health?.warnings.map((warning) => (
          <span className="accountWarning" key={warning}>
            {warning}
          </span>
        ))}
      </div>
    </section>
  );
}

function HealthItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className={`accountHealthItem ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatChain(health: AccountHealth | undefined): string {
  if (!health) return "loading";
  const chain = health.wallet.expectedChainName ?? "unknown";
  return health.wallet.expectedChainId ? `${chain} (${health.wallet.expectedChainId})` : chain;
}

function formatUsage(health: AccountHealth | undefined): string {
  if (!health) return "loading";
  return `${formatPercent(health.predict.usagePct)} / max ${formatPercent(health.predict.maxUsagePct)}`;
}

function usageTone(health: AccountHealth | undefined): "ok" | "warn" | undefined {
  if (!health) return undefined;
  return health.predict.usagePct <= health.predict.maxUsagePct ? "ok" : "warn";
}

function yesNo(value: boolean | undefined): string {
  if (value === undefined) return "loading";
  return value ? "yes" : "no";
}

function formatNumber(value: number | undefined): string {
  if (value === undefined) return "loading";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    style: "percent",
  }).format(value);
}
