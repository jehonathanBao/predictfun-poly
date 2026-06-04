export interface InjectedEthereumProvider {
  request<T = unknown>(args: { method: string; params?: unknown[] }): Promise<T>;
  on?(event: "accountsChanged" | "chainChanged", handler: (...args: unknown[]) => void): void;
  removeListener?(event: "accountsChanged" | "chainChanged", handler: (...args: unknown[]) => void): void;
}

export interface ConnectedWalletState {
  connectedAddress?: string;
  chainId?: number;
  balance?: string;
}

declare global {
  interface Window {
    ethereum?: InjectedEthereumProvider;
  }
}

const READ_ONLY_METHODS = new Set(["eth_accounts", "eth_requestAccounts", "eth_chainId", "eth_getBalance"]);

export function injectedProvider(): InjectedEthereumProvider | undefined {
  return window.ethereum;
}

export async function connectInjectedWallet(): Promise<ConnectedWalletState> {
  const provider = injectedProvider();
  if (!provider) return {};

  const accounts = await readOnlyRequest<string[]>(provider, "eth_requestAccounts");
  const address = accounts[0];
  const chainId = await readChainId(provider);
  const balance = address ? await readBalance(provider, address) : undefined;

  return {
    connectedAddress: address,
    chainId,
    balance,
  };
}

export async function readInjectedWallet(): Promise<ConnectedWalletState> {
  const provider = injectedProvider();
  if (!provider) return {};

  const accounts = await readOnlyRequest<string[]>(provider, "eth_accounts");
  const address = accounts[0];
  const chainId = await readChainId(provider);
  const balance = address ? await readBalance(provider, address) : undefined;

  return {
    connectedAddress: address,
    chainId,
    balance,
  };
}

export function sameAddress(left?: string, right?: string): boolean | undefined {
  if (!left || !right) return undefined;
  if (right.includes("...")) return shortAddress(left).toLowerCase() === right.toLowerCase();
  return left.toLowerCase() === right.toLowerCase();
}

export function shortAddress(address?: string): string {
  if (!address) return "-";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function readChainId(provider: InjectedEthereumProvider): Promise<number | undefined> {
  const chainIdHex = await readOnlyRequest<string>(provider, "eth_chainId");
  return Number.parseInt(chainIdHex, 16);
}

async function readBalance(provider: InjectedEthereumProvider, address: string): Promise<string | undefined> {
  const balanceHex = await readOnlyRequest<string>(provider, "eth_getBalance", [address, "latest"]);
  return formatNativeBalance(BigInt(balanceHex));
}

async function readOnlyRequest<T>(
  provider: InjectedEthereumProvider,
  method: string,
  params?: unknown[],
): Promise<T> {
  if (!READ_ONLY_METHODS.has(method)) {
    throw new Error("Wallet request blocked by read-only guard");
  }
  return provider.request<T>({ method, params });
}

function formatNativeBalance(wei: bigint): string {
  const whole = wei / 1_000_000_000_000_000_000n;
  const fraction = wei % 1_000_000_000_000_000_000n;
  const fractionText = fraction.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  return fractionText ? `${whole.toString()}.${fractionText}` : whole.toString();
}
