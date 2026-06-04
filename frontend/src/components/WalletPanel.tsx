import { POLYGON } from "../lib/chains";
import { shortAddress } from "../lib/wallet";
import { useWalletStatus } from "../hooks/useWalletStatus";

export function WalletPanel() {
  const {
    backend,
    wallet,
    loading,
    error,
    hasInjectedWallet,
    isConnected,
    chainLabel,
    isCorrectNetwork,
    addressMatch,
    connect,
  } = useWalletStatus();

  const currency = backend?.expectedChainId === POLYGON.id ? POLYGON.nativeCurrency : "native";

  return (
    <section className="walletPanel" aria-label="read-only wallet status">
      <div className="walletHeader">
        <div>
          <h2>Wallet Status</h2>
          <p>Read-only connection for dashboard context</p>
        </div>
        <span className="walletMode">read-only</span>
      </div>

      <div className="walletGrid">
        <WalletItem label="Connected" value={isConnected ? shortAddress(wallet.connectedAddress) : "Disconnected"} />
        <WalletItem label="Network" value={wallet.chainId ? `${chainLabel} (${wallet.chainId})` : "-"} />
        <WalletItem label="Backend Wallet" value={backend?.backendTradingAddressMasked ?? "-"} />
        <WalletItem label="Balance" value={wallet.balance ? `${wallet.balance} ${currency}` : "-"} />
      </div>

      <div className="walletBadges">
        <StatusBadge label="live trading disabled" tone="safe" />
        <StatusBadge label="no signing" tone="safe" />
        <StatusBadge label="no transactions" tone="safe" />
        {isCorrectNetwork === false ? <StatusBadge label="wrong network" tone="warn" /> : null}
        {addressMatch === false ? <StatusBadge label="address mismatch" tone="warn" /> : null}
        {isCorrectNetwork === true ? <StatusBadge label="network ok" tone="safe" /> : null}
        {addressMatch === true ? <StatusBadge label="address match" tone="safe" /> : null}
      </div>

      {error ? <div className="walletWarning">{error}</div> : null}

      <button
        className="connectButton"
        disabled={!hasInjectedWallet || loading}
        onClick={() => {
          void connect();
        }}
      >
        {hasInjectedWallet ? "Connect Wallet" : "No Browser Wallet"}
      </button>
    </section>
  );
}

function WalletItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="walletItem">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: "safe" | "warn" }) {
  return <span className={`walletBadge ${tone}`}>{label}</span>;
}
