import { useEffect, useState } from "react";
import type { ManagedWallet, PaperLiveStatus, WalletManagerStatus } from "../types";

const WALLET_MANAGER_URL = import.meta.env.VITE_WALLET_MANAGER_URL ?? "/api/wallet-manager";
const PAPER_LIVE_STATUS_URL = import.meta.env.VITE_PAPER_LIVE_STATUS_URL ?? "/api/paper-live-status";

export function MultiWalletPanel({ paperLive }: { paperLive?: PaperLiveStatus }) {
  const [status, setStatus] = useState<WalletManagerStatus>();
  const [paperStatus, setPaperStatus] = useState<PaperLiveStatus>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [walletResponse, paperResponse] = await Promise.all([
          fetch(WALLET_MANAGER_URL),
          fetch(PAPER_LIVE_STATUS_URL),
        ]);
        if (!walletResponse.ok) throw new Error(`wallet manager API returned ${walletResponse.status}`);
        const payload = (await walletResponse.json()) as WalletManagerStatus;
        const paperPayload = paperResponse.ok ? ((await paperResponse.json()) as PaperLiveStatus) : undefined;
        if (!active) return;
        setStatus(payload);
        setPaperStatus(paperPayload);
        setError(undefined);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load wallet manager");
      }
    }

    void load();
    const intervalId = window.setInterval(load, 5_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const polymarketWallet = status?.polymarketHedgeWallet;
  const activePaperLive = paperLive ?? paperStatus;
  const paperSimulation = status?.paperSimulation;
  const paperSimulationEnabled = paperSimulation?.enabled === true;

  return (
    <section className="multiWalletPanel" aria-label="multi wallet manager">
      <div className="multiWalletHeader">
        <div>
          <h2>Wallet Manager</h2>
          <p>Read-only view of Predict wallets and the single Polymarket hedge wallet</p>
        </div>
        <span className={`multiWalletMode ${activePaperLive?.enabled ? "paper" : ""}`}>
          {activePaperLive?.enabled ? "Paper Mode" : "dry-run"}
        </span>
      </div>

      <div className="walletManagerGrid">
        <WalletMetric label={paperSimulationEnabled ? "Predict paper wallets" : "Predict wallets"} value={formatWalletCount(status)} />
        <WalletMetric label={paperSimulationEnabled ? "Predict paper available" : "Predict available"} value={formatUsd(status?.summary.totalPredictAvailableUsd)} />
        <WalletMetric label={paperSimulationEnabled ? "Simulated net exposure" : "Predict net exposure"} value={formatUsd(status?.summary.totalPredictNetExposureUsd)} />
        <WalletMetric label={paperSimulationEnabled ? "Polymarket paper available" : "Polymarket available"} value={formatUsd(status?.summary.polymarketAvailableUsd)} />
        <WalletMetric label={paperSimulationEnabled ? "Paper planned hedge" : "Planned hedge"} value={formatUsd(status?.summary.currentPlannedHedgeUsd)} />
      </div>

      <div className="walletManagerBadges">
        <span className="walletManagerBadge safe">read-only</span>
        <span className="walletManagerBadge safe">frontend signing blocked</span>
        <span className="walletManagerBadge safe">frontend transactions blocked</span>
        {paperSimulationEnabled ? <span className="walletManagerBadge paper">paper wallets</span> : null}
        {activePaperLive?.enabled ? <span className="walletManagerBadge paper">Paper Mode</span> : null}
        <span className="walletManagerBadge warn">single Polymarket hedge wallet</span>
      </div>

      {paperSimulationEnabled && paperSimulation ? <PaperSimulationBox status={paperSimulation} /> : null}

      {activePaperLive?.enabled ? <PaperLiveBox status={activePaperLive} /> : null}

      {error ? <div className="walletManagerWarning">{error}</div> : null}

      <div className="walletManagerSplit">
        <div className="walletManagerTableShell">
          <h3>Predict Wallets</h3>
          <table className="walletManagerTable">
            <thead>
              <tr>
                <th>ID</th>
                <th>Address</th>
                <th>Status</th>
                <th className="number">Balance</th>
                <th className="number">Reserved</th>
                <th className="number">Available</th>
                <th className="number">YES</th>
                <th className="number">NO</th>
                <th className="number">Net</th>
              </tr>
            </thead>
            <tbody>
              {status?.predictWallets.length ? (
                status.predictWallets.map((wallet) => <PredictWalletRow key={wallet.id} wallet={wallet} />)
              ) : (
                <tr>
                  <td colSpan={9} className="mutedText">
                    no Predict wallets configured
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <aside className="polymarketWalletBox" aria-label="polymarket hedge wallet">
          <h3>Polymarket Hedge Wallet</h3>
          {polymarketWallet ? (
            <dl className="walletManagerDetailList">
              <Detail label="ID" value={polymarketWallet.id} />
              <Detail label="Address" value={polymarketWallet.addressMasked} />
              <Detail label="Network" value={formatNetwork(polymarketWallet)} />
              <Detail label="Status" value={polymarketWallet.status} />
              <Detail label="Balance" value={formatUsd(polymarketWallet.balanceUsd)} />
              <Detail label="Reserved" value={formatUsd(polymarketWallet.reservedUsd)} />
              <Detail label="Available" value={formatUsd(polymarketWallet.availableUsd)} />
              <Detail label="Planned Hedge" value={formatUsd(polymarketWallet.currentPlannedHedgeUsd)} />
              <Detail label="Live Trading" value={polymarketWallet.liveTradingEnabled ? "enabled" : "disabled"} />
            </dl>
          ) : (
            <div className="walletManagerEmpty">not configured</div>
          )}
        </aside>
      </div>

      <div className="walletManagerWarnings">
        {status?.warnings.length === 0 ? <span className="walletManagerOk">no warnings</span> : null}
        {status?.warnings.map((warning) => (
          <span className="walletManagerWarningPill" key={warning}>
            {warning}
          </span>
        ))}
      </div>
    </section>
  );
}

function PaperSimulationBox({ status }: { status: NonNullable<WalletManagerStatus["paperSimulation"]> }) {
  return (
    <div className="paperSimulationBox" aria-label="paper simulated wallet status">
      <WalletMetric label="Paper Predict wallets" value={`${status.predictWalletCount} / 10`} />
      <WalletMetric label="Funds per Predict wallet" value={formatUsd(status.predictWalletFundsUsd)} />
      <WalletMetric label="Paper hedge funds" value={formatUsd(status.polymarketHedgeFundsUsd)} />
      <WalletMetric label="Sim exposure" value={formatUsd(status.simulatedNetExposureUsd)} />
      <WalletMetric label="Planned hedge" value={formatUsd(status.plannedHedgeUsd)} />
      <WalletMetric label="Real Predict wallets" value={status.realPredictWalletCount.toString()} />
      <WalletMetric
        label="Real Polymarket wallet"
        value={status.realPolymarketHedgeWalletConfigured ? "configured" : "not configured"}
      />
    </div>
  );
}

function PaperLiveBox({ status }: { status: PaperLiveStatus }) {
  return (
    <div className="paperLiveBox" aria-label="paper live market data status">
      <WalletMetric label="Paper source" value={status.sourceLabel} />
      <WalletMetric label="Source type" value={sourceTypeLabel(status.sourceType)} />
      <WalletMetric label="Market data" value={marketDataSourceLabel(status.marketDataSource)} />
      <WalletMetric label="Fixture" value={status.fixtureScenario ?? "-"} />
      <WalletMetric label="Token ID" value={status.tokenIdMasked ?? status.polymarketTokenIdMasked ?? "-"} />
      <WalletMetric label="URL host" value={status.marketDataUrlHost ?? "-"} />
      <WalletMetric label="Last fetch" value={formatTimestamp(status.lastFetchAt)} />
      <WalletMetric label="Fetch error" value={status.fetchErrorCode ?? "-"} />
      <WalletMetric label="Max spread" value={formatPct(status.maxSpread)} />
      <WalletMetric label="Min depth" value={formatUsd(status.minDepthUsd)} />
      <WalletMetric label="Max data age" value={`${status.maxMarketDataAgeMs} ms`} />
    </div>
  );
}

function PredictWalletRow({ wallet }: { wallet: ManagedWallet }) {
  return (
    <tr>
      <td className="mono">{wallet.id}</td>
      <td className="mono">{wallet.addressMasked}</td>
      <td>
        {wallet.status}
        {wallet.paperSimulated ? <span className="inlinePaperBadge">paper</span> : null}
      </td>
      <td className="number">{formatUsd(wallet.balanceUsd)}</td>
      <td className="number">{formatUsd(wallet.reservedUsd)}</td>
      <td className="number">{formatUsd(wallet.availableUsd)}</td>
      <td className="number">{formatUsd(wallet.yesExposureUsd)}</td>
      <td className="number">{formatUsd(wallet.noExposureUsd)}</td>
      <td className={`number ${wallet.netExposureUsd === 0 ? "" : "exposureValue"}`}>{formatUsd(wallet.netExposureUsd)}</td>
    </tr>
  );
}

function WalletMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="walletManagerMetric">
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

function formatWalletCount(status: WalletManagerStatus | undefined): string {
  if (!status) return "loading";
  return `${status.summary.predictWalletCount} / ${status.summary.maxPredictWallets}`;
}

function formatNetwork(wallet: ManagedWallet): string {
  const network = wallet.network ?? "unknown";
  return wallet.chainId ? `${network} (${wallet.chainId})` : network;
}

function formatUsd(value: number | undefined): string {
  if (value === undefined) return "loading";
  return `$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value)}`;
}

function sourceTypeLabel(value: PaperLiveStatus["sourceType"]): string {
  if (value === "fixture") return "fixture";
  if (value === "market_data_url") return "market URL";
  if (value === "polymarket_token_id") return "token id";
  return "none";
}

function marketDataSourceLabel(value: PaperLiveStatus["marketDataSource"]): string {
  if (value === "fixture") return "fixture";
  if (value === "market_data_url") return "market URL";
  if (value === "polymarket_clob_book") return "Polymarket CLOB";
  return "none";
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString() : value;
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
