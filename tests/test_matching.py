from __future__ import annotations

import unittest
from decimal import Decimal

from predictfun.matching import StrictMarketMatcher
from predictfun.models import BinaryMarketSpec, ResolutionSpec, Venue


def resolution(**overrides: object) -> ResolutionSpec:
    base = {
        "oracle_system": "UMA_OPTIMISTIC_ORACLE",
        "data_source": "BINANCE_BTC_USDT",
        "rules_hash": "abc",
        "challenge_period_seconds": 7200,
        "finality_rule": "UNLESS_CHALLENGED_THEN_UMA_FINAL",
        "winning_payout": "1",
        "losing_payout": "0",
        "payout_unit": "USD",
        "dispute_process": "UMA_OPTIMISTIC_ORACLE",
    }
    base.update(overrides)
    return ResolutionSpec(**base)  # type: ignore[arg-type]


def market(venue: Venue, **overrides: object) -> BinaryMarketSpec:
    base = {
        "venue": venue,
        "venue_market_id": "m1",
        "question": "Will BTC be up?",
        "underlying": "BTC",
        "contract_kind": "UP_DOWN",
        "settlement_source": "BINANCE_BTC_USDT",
        "window_start_utc": "2026-06-03T00:00:00Z",
        "window_end_utc": "2026-06-03T00:15:00Z",
        "strike": Decimal("70000"),
        "direction": "UP",
        "decimal_precision": 3,
        "resolution_rule_hash": "abc",
        "resolution": resolution(),
    }
    base.update(overrides)
    return BinaryMarketSpec(**base)  # type: ignore[arg-type]


class StrictMarketMatcherTests(unittest.TestCase):
    def test_matches_complete_equivalent_btc_binary_markets(self) -> None:
        result = StrictMarketMatcher().match(market(Venue.PREDICT), market(Venue.POLYMARKET))
        self.assertTrue(result.matched)

    def test_rejects_non_btc_market(self) -> None:
        result = StrictMarketMatcher().match(
            market(Venue.PREDICT),
            market(Venue.POLYMARKET, underlying="ETH"),
        )
        self.assertFalse(result.matched)
        self.assertIn("both markets must be BTC markets", result.reasons)

    def test_rejects_missing_resolution_spec(self) -> None:
        result = StrictMarketMatcher().match(
            market(Venue.PREDICT, resolution=None),
            market(Venue.POLYMARKET),
        )
        self.assertFalse(result.matched)
        self.assertIn("missing strict equivalence field: resolution", result.reasons)

    def test_direct_condition_link_does_not_override_resolution_mismatch(self) -> None:
        result = StrictMarketMatcher().match(
            market(Venue.PREDICT, linked_polymarket_condition_ids=("0xpoly",)),
            market(
                Venue.POLYMARKET,
                condition_id="0xPoly",
                resolution=resolution(challenge_period_seconds=3600),
            ),
        )
        self.assertFalse(result.matched)
        self.assertIn("strict equivalence mismatch: resolution", result.reasons)

    def test_rejects_different_uma_finality_rule(self) -> None:
        result = StrictMarketMatcher().match(
            market(Venue.PREDICT),
            market(Venue.POLYMARKET, resolution=resolution(finality_rule="TWO_HOUR_CHALLENGE_ONLY")),
        )
        self.assertFalse(result.matched)
        self.assertIn("strict equivalence mismatch: resolution", result.reasons)


if __name__ == "__main__":
    unittest.main()
