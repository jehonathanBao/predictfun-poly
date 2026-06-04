export interface PolymarketPosition {
  marketId: string;
  outcome: "YES" | "NO";
  shares: string;
}

export interface PolymarketPositionsReader {
  listPositions(address: string): Promise<readonly PolymarketPosition[]>;
}

