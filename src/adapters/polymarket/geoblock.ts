export interface PolymarketGeoblockStatus {
  blocked: boolean;
  country: string;
  region?: string;
  ip?: string;
}

export interface PolymarketGeoblockClient {
  check(): Promise<PolymarketGeoblockStatus>;
}

