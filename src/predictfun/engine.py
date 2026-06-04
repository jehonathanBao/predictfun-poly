from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .models import OrderBook
from .risk import ArbitrageCombo, QuoteEvaluator, SizingLimits, SizingResult


@dataclass(frozen=True)
class FeeRates:
    predict_fee_rate_bps: Decimal | str | int
    polymarket_fee_rate_bps: Decimal | str | int


@dataclass(frozen=True)
class BookBundle:
    predict_yes: OrderBook
    predict_no: OrderBook
    polymarket_yes: OrderBook
    polymarket_no: OrderBook


class ArbEngine:
    """Price, fee, and depth engine for the two allowed hedge combos."""

    def __init__(self, evaluator: QuoteEvaluator | None = None) -> None:
        self.evaluator = evaluator or QuoteEvaluator()

    def size_combo(
        self,
        *,
        combo: ArbitrageCombo,
        books: BookBundle,
        fee_rates: FeeRates,
        limits: SizingLimits,
    ) -> SizingResult:
        if combo is ArbitrageCombo.COMBO_A:
            return self.evaluator.size_combo_a(
                predict_yes_book=books.predict_yes,
                polymarket_no_book=books.polymarket_no,
                predict_fee_rate_bps=fee_rates.predict_fee_rate_bps,
                polymarket_fee_rate_bps=fee_rates.polymarket_fee_rate_bps,
                limits=limits,
            )
        return self.evaluator.size_combo_b(
            predict_no_book=books.predict_no,
            polymarket_yes_book=books.polymarket_yes,
            predict_fee_rate_bps=fee_rates.predict_fee_rate_bps,
            polymarket_fee_rate_bps=fee_rates.polymarket_fee_rate_bps,
            limits=limits,
        )

    def size_allowed_combos(
        self,
        *,
        books: BookBundle,
        fee_rates: FeeRates,
        limits: SizingLimits,
    ) -> tuple[SizingResult, SizingResult]:
        return (
            self.size_combo(combo=ArbitrageCombo.COMBO_A, books=books, fee_rates=fee_rates, limits=limits),
            self.size_combo(combo=ArbitrageCombo.COMBO_B, books=books, fee_rates=fee_rates, limits=limits),
        )

