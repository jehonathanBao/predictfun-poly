from __future__ import annotations

from dataclasses import dataclass

from .accounts import GlobalTradingPaused, PolymarketAccountState, PredictAccountRotator
from .engine import ArbEngine, BookBundle, FeeRates
from .models import Outcome
from .risk import ArbitrageCombo, SizingLimits, SizingResult


@dataclass(frozen=True)
class RiskDecision:
    accepted: bool
    reasons: tuple[str, ...]
    sizing: SizingResult | None = None
    predict_account_id: str | None = None


class RiskManager:
    def __init__(self, *, engine: ArbEngine, per_trade_max_usd=None) -> None:
        self.engine = engine
        self.per_trade_max_usd = per_trade_max_usd

    def choose_trade(
        self,
        *,
        books: BookBundle,
        fee_rates: FeeRates,
        predict_rotator: PredictAccountRotator,
        polymarket_account: PolymarketAccountState,
    ) -> RiskDecision:
        if polymarket_account.paused:
            raise GlobalTradingPaused(polymarket_account.pause_reason or "Polymarket account paused")
        if polymarket_account.available_balance <= 0:
            raise GlobalTradingPaused("Polymarket account paused: insufficient funds for hedge leg")

        rejected: list[str] = []
        for account in predict_rotator.candidates_from_next():
            if not account.is_available:
                rejected.append(f"{account.account_id}: {account.unavailable_reason()}")
                continue

            limits = SizingLimits(
                selected_predict_free_balance=account.available_balance,
                polymarket_available_collateral=polymarket_account.available_balance,
                per_trade_max_usd=self.per_trade_max_usd,
                polymarket_constraints=self._polymarket_constraints(books),
            )
            sized = self.engine.size_allowed_combos(books=books, fee_rates=fee_rates, limits=limits)
            executable = tuple(result for result in sized if result.executable and result.quote is not None)
            if not executable:
                rejected.extend(f"{account.account_id}/{result.combo.value}: {', '.join(result.reasons)}" for result in sized)
                continue

            best = max(executable, key=lambda result: result.quote.net_profit if result.quote else 0)
            assert best.quote is not None
            reserved = predict_rotator.reserve(account.account_id)
            return RiskDecision(
                accepted=True,
                reasons=(),
                sizing=best,
                predict_account_id=reserved.account_id,
            )

        return RiskDecision(accepted=False, reasons=tuple(rejected))

    def predict_outcome_for(self, combo: ArbitrageCombo) -> Outcome:
        return Outcome.YES if combo is ArbitrageCombo.COMBO_A else Outcome.NO

    def polymarket_outcome_for(self, combo: ArbitrageCombo) -> Outcome:
        return Outcome.NO if combo is ArbitrageCombo.COMBO_A else Outcome.YES

    def _polymarket_constraints(self, books: BookBundle):
        from .risk import VenueTradeConstraints

        min_size_values = tuple(
            book.min_order_size for book in (books.polymarket_yes, books.polymarket_no) if book.min_order_size is not None
        )
        min_shares = max(min_size_values) if min_size_values else 0
        return VenueTradeConstraints(min_shares=min_shares)

