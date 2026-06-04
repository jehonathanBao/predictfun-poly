import { type D } from "../../domain/money.js";

export interface PolymarketBalancesReader {
  getAvailableCollateral(address: string): Promise<D>;
}

