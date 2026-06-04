from __future__ import annotations

from dataclasses import dataclass

from .adapters import PolymarketAdapter, PredictAdapter
from .models import BinaryMarketSpec


@dataclass(frozen=True)
class DiscoveredMarkets:
    predict_markets: tuple[BinaryMarketSpec, ...]
    polymarket_markets: tuple[BinaryMarketSpec, ...]


class MarketDiscovery:
    def __init__(self, *, predict: PredictAdapter, polymarket: PolymarketAdapter) -> None:
        self.predict = predict
        self.polymarket = polymarket

    def discover(self) -> DiscoveredMarkets:
        return DiscoveredMarkets(
            predict_markets=self.predict.list_btc_markets(),
            polymarket_markets=self.polymarket.list_btc_markets(),
        )

