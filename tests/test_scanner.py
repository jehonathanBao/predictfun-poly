from __future__ import annotations

import unittest
from decimal import Decimal

from predictfun.models import BinaryMarketSpec, ResolutionSpec, Venue
from predictfun.scanner import BtcMarketScanner


def resolution() -> ResolutionSpec:
    return ResolutionSpec(
        oracle_system="UMA_OPTIMISTIC_ORACLE",
        data_source="BINANCE_BTC_USDT",
        rules_hash="abc",
        challenge_period_seconds=7200,
        finality_rule="UNLESS_CHALLENGED_THEN_UMA_FINAL",
    )


def market(venue: Venue, underlying: str = "BTC") -> BinaryMarketSpec:
    return BinaryMarketSpec(
        venue=venue,
        venue_market_id=f"{venue.value}-{underlying}",
        question="Will BTC be up?",
        underlying=underlying,
        contract_kind="UP_DOWN",
        settlement_source="BINANCE_BTC_USDT",
        window_start_utc="2026-06-03T00:00:00Z",
        window_end_utc="2026-06-03T00:15:00Z",
        decimal_precision=3,
        strike=Decimal("70000"),
        direction="UP",
        resolution_rule_hash="abc",
        resolution=resolution(),
    )


class ScannerTests(unittest.TestCase):
    def test_scanner_only_pairs_btc_markets(self) -> None:
        result = BtcMarketScanner().scan(
            predict_markets=[market(Venue.PREDICT), market(Venue.PREDICT, underlying="ETH")],
            polymarket_markets=[market(Venue.POLYMARKET), market(Venue.POLYMARKET, underlying="ETH")],
        )

        self.assertEqual(len(result.accepted), 1)
        self.assertEqual(result.accepted[0].predict.underlying, "BTC")
        self.assertEqual(result.accepted[0].polymarket.underlying, "BTC")


if __name__ == "__main__":
    unittest.main()

