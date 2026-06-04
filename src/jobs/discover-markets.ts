import { type MarketDiscovery } from "../discovery/marketDiscovery.js";

export async function discoverMarketsJob(discovery: MarketDiscovery) {
  return discovery.discover();
}

