import { d } from "../core/decimal.js";
import { type PolymarketAccountState } from "../core/account-rotator.js";

export function parsePolymarketAccount(accountId: string, address: string): PolymarketAccountState {
  return {
    accountId,
    address,
    availableCollateral: d(0),
    paused: false
  };
}

