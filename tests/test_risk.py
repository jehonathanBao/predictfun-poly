from __future__ import annotations

import unittest
from decimal import Decimal

from predictfun.models import OrderBook, OrderBookLevel, Outcome
from predictfun.risk import ArbitrageCombo, QuoteEvaluator, RiskConfig, SizingLimits, VenueTradeConstraints


def book(ask_price: str, size: str = "10") -> OrderBook:
    return OrderBook(
        bids=(OrderBookLevel(price=Decimal("0.01"), size=Decimal(size)),),
        asks=(OrderBookLevel(price=Decimal(ask_price), size=Decimal(size)),),
        decimal_precision=3,
    )


class RiskTests(unittest.TestCase):
    def test_blocks_non_positive_net_profit_after_buffers(self) -> None:
        quote = QuoteEvaluator(RiskConfig(predict_slippage_bps="0", polymarket_slippage_bps="0", latency_buffer_bps="0")).evaluate_buy_complement(
            shares="10",
            predict_outcome=Outcome.YES,
            predict_book=book("0.51"),
            polymarket_book=book("0.49"),
            predict_fee_rate_bps="0",
            polymarket_fee_rate_bps="0",
        )

        self.assertFalse(quote.executable)
        self.assertEqual(quote.net_profit, Decimal("0.00"))

    def test_allows_positive_net_profit_after_fees_and_buffers(self) -> None:
        quote = QuoteEvaluator(RiskConfig(predict_slippage_bps="0", polymarket_slippage_bps="0", latency_buffer_bps="0")).evaluate_buy_complement(
            shares="10",
            predict_outcome=Outcome.NO,
            predict_book=book("0.45"),
            polymarket_book=book("0.50"),
            predict_fee_rate_bps="0",
            polymarket_fee_rate_bps="0",
        )

        self.assertTrue(quote.executable)
        self.assertEqual(quote.net_profit, Decimal("0.50"))

    def test_blocks_predict_minimum_order(self) -> None:
        quote = QuoteEvaluator(RiskConfig(predict_slippage_bps="0", polymarket_slippage_bps="0", latency_buffer_bps="0")).evaluate_buy_complement(
            shares="1",
            predict_outcome=Outcome.YES,
            predict_book=book("0.20"),
            polymarket_book=book("0.20"),
            predict_fee_rate_bps="0",
            polymarket_fee_rate_bps="0",
        )

        self.assertFalse(quote.executable)
        self.assertIn("Predict leg is below the 1 USDT minimum order amount", quote.reasons)

    def test_exposes_only_two_named_combos(self) -> None:
        evaluator = QuoteEvaluator(RiskConfig(predict_slippage_bps="0", polymarket_slippage_bps="0", latency_buffer_bps="0"))

        combo_a, combo_b = evaluator.evaluate_two_combos(
            shares="10",
            predict_yes_book=book("0.45"),
            predict_no_book=book("0.46"),
            polymarket_yes_book=book("0.47"),
            polymarket_no_book=book("0.48"),
            predict_fee_rate_bps="0",
            polymarket_fee_rate_bps="0",
        )

        self.assertEqual(combo_a.combo, ArbitrageCombo.COMBO_A)
        self.assertEqual(combo_a.predict_leg.outcome, Outcome.YES)
        self.assertEqual(combo_a.polymarket_leg.outcome, Outcome.NO)
        self.assertEqual(combo_b.combo, ArbitrageCombo.COMBO_B)
        self.assertEqual(combo_b.predict_leg.outcome, Outcome.NO)
        self.assertEqual(combo_b.polymarket_leg.outcome, Outcome.YES)

    def test_buffers_must_still_leave_positive_profit_per_share(self) -> None:
        quote = QuoteEvaluator(
            RiskConfig(
                predict_slippage_bps="0",
                polymarket_slippage_bps="0",
                latency_buffer_bps="0",
                gas_or_fixed_cost_per_share="0.02",
                rounding_buffer_per_share="0.01",
            )
        ).evaluate_buy_complement(
            shares="10",
            predict_outcome=Outcome.YES,
            predict_book=book("0.49"),
            polymarket_book=book("0.49"),
            predict_fee_rate_bps="0",
            polymarket_fee_rate_bps="0",
        )

        self.assertFalse(quote.executable)
        self.assertEqual(quote.net_cost_per_share, Decimal("1.01"))
        self.assertEqual(quote.profit_per_share, Decimal("-0.01"))

    def test_fixed_costs_must_leave_positive_net_profit_usd(self) -> None:
        quote = QuoteEvaluator(
            RiskConfig(
                predict_slippage_bps="0",
                polymarket_slippage_bps="0",
                latency_buffer_bps="0",
                fixed_costs_usd="1.00",
            )
        ).evaluate_buy_complement(
            shares="10",
            predict_outcome=Outcome.YES,
            predict_book=book("0.45"),
            polymarket_book=book("0.50"),
            predict_fee_rate_bps="0",
            polymarket_fee_rate_bps="0",
        )

        self.assertFalse(quote.executable)
        self.assertEqual(quote.profit_per_share, Decimal("0.05"))
        self.assertEqual(quote.net_profit, Decimal("-0.50"))

    def test_sizing_takes_minimum_of_depth_balance_collateral_and_trade_cap(self) -> None:
        sizing = QuoteEvaluator(
            RiskConfig(
                predict_slippage_bps="0",
                polymarket_slippage_bps="0",
                latency_buffer_bps="0",
                predict_max_trade_fraction="0.30",
            )
        ).size_combo_a(
            predict_yes_book=book("0.40", size="100"),
            polymarket_no_book=book("0.50", size="100"),
            predict_fee_rate_bps="0",
            polymarket_fee_rate_bps="0",
            limits=SizingLimits(
                selected_predict_free_balance="100",
                polymarket_available_collateral="100",
                per_trade_max_usd="20",
            ),
        )

        self.assertTrue(sizing.executable)
        self.assertEqual(sizing.limited_by, ("per_trade_max_usd",))
        self.assertEqual(sizing.shares, Decimal("22.22222222222222222222222222"))

    def test_sizing_skips_predict_account_when_30_percent_balance_is_smallest(self) -> None:
        sizing = QuoteEvaluator(
            RiskConfig(
                predict_slippage_bps="0",
                polymarket_slippage_bps="0",
                latency_buffer_bps="0",
                predict_max_trade_fraction="0.30",
            )
        ).size_combo_b(
            predict_no_book=book("0.40", size="100"),
            polymarket_yes_book=book("0.50", size="100"),
            predict_fee_rate_bps="0",
            polymarket_fee_rate_bps="0",
            limits=SizingLimits(
                selected_predict_free_balance="10",
                polymarket_available_collateral="100",
                predict_constraints=VenueTradeConstraints(min_notional="1"),
            ),
        )

        self.assertTrue(sizing.executable)
        self.assertEqual(sizing.limited_by, ("predict_30_percent_balance",))
        self.assertEqual(sizing.shares, Decimal("7.5"))


if __name__ == "__main__":
    unittest.main()
