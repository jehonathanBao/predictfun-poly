from __future__ import annotations

import unittest
from decimal import Decimal

from predictfun.models import Outcome
from predictfun.orderbook import complement_price, predict_yes_book_to_outcome_book


class PredictOrderbookTests(unittest.TestCase):
    def test_no_side_uses_complemented_yes_bids_as_asks(self) -> None:
        book = predict_yes_book_to_outcome_book(
            yes_bids=[["0.491", "303518.1"], ["0.490", "1365.44"]],
            yes_asks=[["0.492", "30192.26"], ["0.493", "20003"]],
            outcome=Outcome.NO,
            decimal_precision=3,
        )

        self.assertEqual(book.asks[0].price, Decimal("0.509"))
        self.assertEqual(book.asks[0].size, Decimal("303518.1"))
        self.assertEqual(book.bids[0].price, Decimal("0.508"))

    def test_yes_side_keeps_native_predict_book(self) -> None:
        book = predict_yes_book_to_outcome_book(
            yes_bids=[["0.48", "10"]],
            yes_asks=[["0.51", "20"]],
            outcome=Outcome.YES,
            decimal_precision=2,
        )

        self.assertEqual(book.asks[0].price, Decimal("0.51"))
        self.assertEqual(book.bids[0].price, Decimal("0.48"))

    def test_complement_quantizes_at_market_precision(self) -> None:
        self.assertEqual(complement_price("0.3334", 3), Decimal("0.667"))


if __name__ == "__main__":
    unittest.main()

