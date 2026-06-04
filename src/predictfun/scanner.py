from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .matching import MarketMatch, StrictMarketMatcher
from .models import BinaryMarketSpec


def is_btc_market(market: BinaryMarketSpec) -> bool:
    return " ".join(market.underlying.strip().lower().split()) == "btc"


@dataclass(frozen=True)
class ScanResult:
    accepted: tuple[MarketMatch, ...]
    rejected: tuple[MarketMatch, ...]


class BtcMarketScanner:
    def __init__(self, matcher: StrictMarketMatcher | None = None) -> None:
        self.matcher = matcher or StrictMarketMatcher()

    def scan(
        self,
        predict_markets: Iterable[BinaryMarketSpec],
        polymarket_markets: Iterable[BinaryMarketSpec],
    ) -> ScanResult:
        predict_btc = tuple(market for market in predict_markets if is_btc_market(market))
        poly_btc = tuple(market for market in polymarket_markets if is_btc_market(market))

        accepted: list[MarketMatch] = []
        rejected: list[MarketMatch] = []
        for predict in predict_btc:
            for polymarket in poly_btc:
                match = self.matcher.match(predict, polymarket)
                if match.matched:
                    accepted.append(match)
                else:
                    rejected.append(match)

        return ScanResult(accepted=tuple(accepted), rejected=tuple(rejected))

