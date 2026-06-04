import { type PredictWsClient, type PredictWsSubscription } from "../adapters/predict/ws.js";
import { type PolymarketMarketWsClient, type PolymarketMarketWsSubscription } from "../adapters/polymarket/ws-market.js";
import { type PolymarketUserWsClient, type PolymarketUserWsSubscription } from "../adapters/polymarket/ws-user.js";
import { tokenIdFor } from "../domain/models.js";
import { type MarketMatch } from "../matching/strictMatcher.js";

export interface OrderbookSubscriptionBundle {
  predict: readonly PredictWsSubscription[];
  polymarket: readonly PolymarketMarketWsSubscription[];
}

export async function subscribeMatchedPairOrderbooks(input: {
  matches: readonly MarketMatch[];
  predictWs: PredictWsClient;
  polymarketWs: PolymarketMarketWsClient;
  onPredictMessage: Parameters<PredictWsClient["subscribeOrderbook"]>[1];
  onPolymarketMessage: Parameters<PolymarketMarketWsClient["subscribeAssetIds"]>[1];
}): Promise<OrderbookSubscriptionBundle> {
  const predictSubscriptions: PredictWsSubscription[] = [];
  const polymarketSubscriptions: PolymarketMarketWsSubscription[] = [];

  for (const match of input.matches) {
    predictSubscriptions.push(
      await input.predictWs.subscribeOrderbook(match.predict.venueMarketId, input.onPredictMessage)
    );
    const yesToken = tokenIdFor(match.polymarket, "YES");
    const noToken = tokenIdFor(match.polymarket, "NO");
    const assetIds = [yesToken, noToken].filter((value): value is string => Boolean(value));
    if (assetIds.length > 0) {
      polymarketSubscriptions.push(await input.polymarketWs.subscribeAssetIds(assetIds, input.onPolymarketMessage));
    }
  }

  return {
    predict: predictSubscriptions,
    polymarket: polymarketSubscriptions
  };
}

export async function subscribePrivateOrderEvents(input: {
  predictWs: PredictWsClient;
  predictJwt: string;
  polymarketUserWs: PolymarketUserWsClient;
  polymarketConditionIds: readonly string[];
  onPredictWalletEvent: Parameters<PredictWsClient["subscribeWalletEvents"]>[1];
  onPolymarketUserEvent: Parameters<PolymarketUserWsClient["subscribeUserOrders"]>[1];
}): Promise<{
  predictWallet: PredictWsSubscription;
  polymarketUser: PolymarketUserWsSubscription;
}> {
  const [predictWallet, polymarketUser] = await Promise.all([
    input.predictWs.subscribeWalletEvents(input.predictJwt, input.onPredictWalletEvent),
    input.polymarketUserWs.subscribeUserOrders(input.polymarketConditionIds, input.onPolymarketUserEvent)
  ]);

  return { predictWallet, polymarketUser };
}

