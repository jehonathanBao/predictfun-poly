import { useCallback, useEffect, useMemo, useState } from "react";
import { chainName } from "../lib/chains";
import {
  connectInjectedWallet,
  injectedProvider,
  readInjectedWallet,
  sameAddress,
  type ConnectedWalletState,
} from "../lib/wallet";
import type { WalletStatus } from "../types";

const WALLET_STATUS_URL = import.meta.env.VITE_WALLET_STATUS_URL ?? "/api/wallet-status";

export interface WalletPanelState {
  backend?: WalletStatus;
  wallet: ConnectedWalletState;
  loading: boolean;
  error?: string;
  hasInjectedWallet: boolean;
  isConnected: boolean;
  chainLabel: string;
  isCorrectNetwork?: boolean;
  addressMatch?: boolean;
  connect: () => Promise<void>;
}

export function useWalletStatus(): WalletPanelState {
  const [backend, setBackend] = useState<WalletStatus>();
  const [wallet, setWallet] = useState<ConnectedWalletState>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refreshWallet = useCallback(async () => {
    try {
      setWallet(await readInjectedWallet());
    } catch (walletError) {
      setError(walletError instanceof Error ? walletError.message : "Unable to read wallet");
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch(WALLET_STATUS_URL);
        if (!response.ok) throw new Error(`wallet API returned ${response.status}`);
        const status = (await response.json()) as WalletStatus;
        if (!active) return;
        setBackend(status);
        setError(undefined);
      } catch (statusError) {
        if (!active) return;
        setError(statusError instanceof Error ? statusError.message : "Unable to load wallet status");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    void refreshWallet();
    const intervalId = window.setInterval(load, 5_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [refreshWallet]);

  useEffect(() => {
    const provider = injectedProvider();
    if (!provider?.on) return;

    const handleChange = () => {
      void refreshWallet();
    };

    provider.on("accountsChanged", handleChange);
    provider.on("chainChanged", handleChange);

    return () => {
      provider.removeListener?.("accountsChanged", handleChange);
      provider.removeListener?.("chainChanged", handleChange);
    };
  }, [refreshWallet]);

  const connect = useCallback(async () => {
    try {
      setWallet(await connectInjectedWallet());
      setError(undefined);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Unable to connect wallet");
    }
  }, []);

  const isCorrectNetwork = useMemo(() => {
    if (!backend?.expectedChainId || !wallet.chainId) return undefined;
    return wallet.chainId === backend.expectedChainId;
  }, [backend?.expectedChainId, wallet.chainId]);

  const addressMatch = useMemo(
    () => sameAddress(wallet.connectedAddress, backend?.backendTradingAddressMasked),
    [backend?.backendTradingAddressMasked, wallet.connectedAddress],
  );

  return {
    backend,
    wallet,
    loading,
    error,
    hasInjectedWallet: Boolean(injectedProvider()),
    isConnected: Boolean(wallet.connectedAddress),
    chainLabel: chainName(wallet.chainId),
    isCorrectNetwork,
    addressMatch,
    connect,
  };
}
