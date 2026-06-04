export interface ChainInfo {
  id: number;
  name: string;
  nativeCurrency: string;
}

export const POLYGON: ChainInfo = {
  id: 137,
  name: "Polygon",
  nativeCurrency: "MATIC",
};

export function chainName(chainId: number | null | undefined): string {
  if (chainId === POLYGON.id) return POLYGON.name;
  if (chainId === null || chainId === undefined) return "Unknown";
  return `Chain ${chainId}`;
}
