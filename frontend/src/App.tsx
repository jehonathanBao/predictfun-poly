import { useEffect, useMemo, useState } from "react";
import { HedgePlanTable } from "./components/HedgePlanTable";
import { WalletPanel } from "./components/WalletPanel";
import type { HedgePlan } from "./types";

type FilterMode = "all" | "approved" | "rejected";

const API_URL = import.meta.env.VITE_HEDGE_API_URL ?? "/api/hedge-plans";

export function App() {
  const [plans, setPlans] = useState<HedgePlan[]>([]);
  const [selectedMarketId, setSelectedMarketId] = useState<string>();
  const [filter, setFilter] = useState<FilterMode>("all");
  const [lastUpdated, setLastUpdated] = useState<string>("never");
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;

    async function fetchPlans() {
      try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const data = (await response.json()) as HedgePlan[];
        if (!active) return;
        setPlans(data);
        setLastUpdated(new Date().toLocaleTimeString());
        setError(undefined);
        setSelectedMarketId((current) => current ?? data[0]?.marketId);
      } catch (fetchError) {
        if (!active) return;
        setError(fetchError instanceof Error ? fetchError.message : "Unable to load plans");
      }
    }

    void fetchPlans();
    const intervalId = window.setInterval(fetchPlans, 2_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const filteredPlans = useMemo(() => {
    if (filter === "approved") return plans.filter((plan) => plan.riskApproved);
    if (filter === "rejected") return plans.filter((plan) => !plan.riskApproved);
    return plans;
  }, [filter, plans]);

  const selectedPlan =
    plans.find((plan) => plan.marketId === selectedMarketId) ?? filteredPlans[0] ?? plans[0];
  const totalNetExposure = plans.reduce((total, plan) => total + Math.abs(plan.netExposureUsd), 0);
  const totalHedgeSize = plans.reduce((total, plan) => total + plan.hedgeSizeUsd, 0);
  const rejectedCount = plans.filter((plan) => !plan.riskApproved).length;

  return (
    <main className="appShell">
      <header className="topBar">
        <div>
          <h1>Predict Hedge Dry-Run</h1>
          <p>EXPOSURE_HEDGE signal monitor</p>
        </div>
        <div className="runtimeStatus" aria-label="runtime status">
          <span className="statusDot" />
          <span>dry-run only</span>
        </div>
      </header>

      <section className="metricGrid" aria-label="hedge summary">
        <Metric label="Plans" value={plans.length.toString()} />
        <Metric label="Rejected" value={rejectedCount.toString()} tone={rejectedCount > 0 ? "warn" : "ok"} />
        <Metric label="Net Exposure" value={`$${formatNumber(totalNetExposure)}`} />
        <Metric label="Hedge Size" value={`$${formatNumber(totalHedgeSize)}`} />
        <Metric label="Last Update" value={lastUpdated} />
      </section>

      <WalletPanel />

      <section className="controlBand" aria-label="plan filters">
        <div className="segmentedControl">
          <button className={filter === "all" ? "active" : undefined} onClick={() => setFilter("all")}>
            All
          </button>
          <button
            className={filter === "approved" ? "active" : undefined}
            onClick={() => setFilter("approved")}
          >
            Approved
          </button>
          <button
            className={filter === "rejected" ? "active" : undefined}
            onClick={() => setFilter("rejected")}
          >
            Rejected
          </button>
        </div>
        <div className="guardRail">
          <span>placeOrder blocked</span>
          <span>live trading off</span>
        </div>
      </section>

      {error ? <div className="errorBanner">{error}</div> : null}

      <section className="workspace">
        <HedgePlanTable
          plans={filteredPlans}
          selectedMarketId={selectedPlan?.marketId}
          onSelect={(plan) => setSelectedMarketId(plan.marketId)}
        />

        <aside className="detailPane" aria-label="selected hedge plan">
          {selectedPlan ? (
            <>
              <div className="detailHeader">
                <h2>{selectedPlan.marketId}</h2>
                <span className={`badge ${selectedPlan.riskApproved ? "approved" : "rejected"}`}>
                  {selectedPlan.riskApproved ? "APPROVED" : "REJECTED"}
                </span>
              </div>
              <dl className="detailList">
                <Detail label="Strategy" value={selectedPlan.strategy} />
                <Detail label="Executable" value={String(selectedPlan.executable)} />
                <Detail label="Dry Run" value={String(selectedPlan.dryRun)} />
                <Detail label="Event Key" value={selectedPlan.eventKey} />
                <Detail label="Hedge Market" value={selectedPlan.hedgeMarketId ?? "-"} />
                <Detail label="Direction" value={selectedPlan.hedgeDirection} />
                <Detail label="Before" value={`$${selectedPlan.exposureBeforeUsd}`} />
                <Detail label="After" value={`$${selectedPlan.exposureAfterUsd}`} />
                <Detail label="Est. Cost" value={`$${selectedPlan.estimatedHedgeCostUsd}`} />
                <Detail label="Reject Reason" value={selectedPlan.rejectReason ?? "-"} />
              </dl>
              <div className="detailSection">
                <h3>Risk Codes</h3>
                <div className="riskCodeList">
                  {selectedPlan.riskCodes.length === 0 ? (
                    <span className="riskCode ok">OK</span>
                  ) : (
                    selectedPlan.riskCodes.map((code) => (
                      <span className="riskCode" key={code}>
                        {code}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="emptyState">No plans</div>
          )}
        </aside>
      </section>
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value);
}
