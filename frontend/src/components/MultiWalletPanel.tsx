import { useEffect, useState } from "react";
import type { ManagedWallet, WalletManagerStatus } from "../types";

const WALLET_MANAGER_URL = import.meta.env.VITE_WALLET_MANAGER_URL ?? "/api/wallet-manager";

export function MultiWalletPanel() {
  const [status, setStatus] = useState<WalletManagerStatus>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch(WALLET_MANAGER_URL);
        if (!response.ok) throw new Error(`wallet manager API returned ${response.status}`);
        const payload = (await response.json()) as WalletManagerStatus;
        if (!active) return;
        setStatus(payload);
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

  return (
    <section className="multiWalletPanel" aria-label="multi wallet manager">
      <div className="multiWalletHeader">
        <div>
          <h2>Wallet Manager</h2>
          <p>Read-only view of Predict wallets and the single Polymarket hedge wallet</p>
        </div>
        <span className="multiWalletMode">dry-run</span>
      </div>

      <div className="walletManagerGrid">
        <WalletMetric label="Predict wallets" value={formatWalletCount(status)} />
        <WalletMetric label="Predict available" value={formatUsd(status?.summary.totalPredictAvailableUsd)} />
        <WalletMetric label="Predict net exposure" value={formatUsd(status?.summary.totalPredictNetExposureUsd)} />
        <WalletMetric label="Polymarket available" value={formatUsd(status?.summary.polymarketAvailableUsd)} />
        <WalletMetric label="Planned hedge" value={formatUsd(status?.summary.currentPlannedHedgeUsd)} />
      </div>

      <div className="walletManagerBadges">
        <span className="walletManagerBadge safe">read-only</span>
        <span className="walletManagerBadge safe">frontend signing blocked</span>
        <span className="walletManagerBadge safe">frontend transactions blocked</span>
        <span className="walletManagerBadge warn">single Polymarket hedge wallet</span>
      </div>

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

function PredictWalletRow({ wallet }: { wallet: ManagedWallet }) {
  return (
    <tr>
      <td className="mono">{wallet.id}</td>
      <td className="mono">{wallet.addressMasked}</td>
      <td>{wallet.status}</td>
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
