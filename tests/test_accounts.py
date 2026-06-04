from __future__ import annotations

import unittest
from decimal import Decimal

from predictfun.accounts import (
    GlobalTradingPaused,
    HeldPosition,
    NoPredictAccountAvailable,
    PolymarketAccountState,
    PolymarketFundingGuard,
    PredictAccountRotator,
    PredictAccountState,
)
from predictfun.models import Outcome


class AccountRotationTests(unittest.TestCase):
    def test_rotates_to_next_available_predict_account(self) -> None:
        rotator = PredictAccountRotator(
            [
                PredictAccountState(
                    "a1",
                    "0x1",
                    available_balance="100",
                    held_position=HeldPosition("m1", "c1", Outcome.YES, "10", "4"),
                ),
                PredictAccountState("a2", "0x2", available_balance="100"),
            ]
        )

        selected = rotator.select(required_notional=Decimal("20"))

        self.assertEqual(selected.account_id, "a2")
        self.assertEqual(selected.status.value, "RESERVED")

    def test_raises_when_all_accounts_have_positions_or_orders(self) -> None:
        rotator = PredictAccountRotator(
            [
                PredictAccountState(
                    "a1",
                    "0x1",
                    available_balance="100",
                    held_position=HeldPosition("m1", "c1", Outcome.YES, "10", "4"),
                ),
                PredictAccountState("a2", "0x2", available_balance="100", open_orders=1),
            ]
        )

        with self.assertRaises(NoPredictAccountAvailable):
            rotator.select(required_notional=Decimal("20"))

    def test_skips_account_when_required_notional_exceeds_30_percent_balance(self) -> None:
        rotator = PredictAccountRotator(
            [
                PredictAccountState("a1", "0x1", available_balance="100"),
                PredictAccountState("a2", "0x2", available_balance="200"),
            ]
        )

        selected = rotator.select(required_notional=Decimal("50"))

        self.assertEqual(selected.account_id, "a2")

    def test_releases_held_account_only_after_redeem(self) -> None:
        rotator = PredictAccountRotator([PredictAccountState("a1", "0x1", available_balance="100")])
        rotator.mark_held("a1", HeldPosition("m1", "c1", Outcome.NO, "10", "4"))

        with self.assertRaises(NoPredictAccountAvailable):
            rotator.select(required_notional=Decimal("10"))

        rotator.release_after_redeem("a1", available_balance=Decimal("110"))
        selected = rotator.select(required_notional=Decimal("10"))

        self.assertEqual(selected.account_id, "a1")

    def test_rejects_more_than_10_predict_accounts(self) -> None:
        accounts = [PredictAccountState(f"a{index}", f"0x{index}", available_balance="100") for index in range(11)]

        with self.assertRaises(ValueError):
            PredictAccountRotator(accounts)

    def test_polymarket_insufficient_funds_pauses_global_opening(self) -> None:
        account = PolymarketAccountState("poly", "0xpoly", available_balance="10")

        with self.assertRaises(GlobalTradingPaused):
            PolymarketFundingGuard().ensure_can_open(account, required_notional=Decimal("20"))


if __name__ == "__main__":
    unittest.main()
