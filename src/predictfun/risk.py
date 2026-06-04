from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum

from .fees import FeeEstimate, binary_market_taker_fee, reserve_bps
from .models import FillEstimate, ONE, ZERO, OrderBook, Outcome, Venue, decimal


class ArbitrageCombo(str, Enum):
    COMBO_A = "PREDICT_YES__POLYMARKET_NO"
    COMBO_B = "PREDICT_NO__POLYMARKET_YES"


@dataclass(frozen=True)
class RiskConfig:
    min_net_profit_usd: Decimal = ZERO
    require_positive_after_all_buffers: bool = True
    min_predict_order_usdt: Decimal = Decimal("1")
    predict_slippage_bps: Decimal = Decimal("10")
    polymarket_slippage_bps: Decimal = Decimal("10")
    latency_buffer_bps: Decimal = Decimal("5")
    rescue_slippage_bps: Decimal = Decimal("30")
    predict_max_trade_fraction: Decimal = Decimal("0.30")
    gas_or_fixed_cost_per_share: Decimal = ZERO
    rounding_buffer_per_share: Decimal = ZERO
    fixed_costs_usd: Decimal = ZERO
    per_trade_max_usd: Decimal | None = None
    market_data_max_age_ms: int = 1500
    predict_rate_limit_rpm: int = 240

    def __post_init__(self) -> None:
        if isinstance(self.require_positive_after_all_buffers, str):
            object.__setattr__(
                self,
                "require_positive_after_all_buffers",
                self.require_positive_after_all_buffers.strip().lower() in {"1", "true", "yes", "on"},
            )
        for name in (
            "min_net_profit_usd",
            "min_predict_order_usdt",
            "predict_slippage_bps",
            "polymarket_slippage_bps",
            "latency_buffer_bps",
            "rescue_slippage_bps",
            "predict_max_trade_fraction",
            "gas_or_fixed_cost_per_share",
            "rounding_buffer_per_share",
            "fixed_costs_usd",
        ):
            object.__setattr__(self, name, decimal(getattr(self, name)))
        if self.per_trade_max_usd is not None:
            object.__setattr__(self, "per_trade_max_usd", decimal(self.per_trade_max_usd))


@dataclass(frozen=True)
class LegQuote:
    venue: Venue
    outcome: Outcome
    fill: FillEstimate
    fee: FeeEstimate
    slippage_reserve: Decimal
    latency_reserve: Decimal

    @property
    def total_cost(self) -> Decimal:
        return self.fill.gross_cost + self.fee.amount + self.slippage_reserve + self.latency_reserve

    @property
    def fee_per_share(self) -> Decimal:
        return self.fee.amount / self.fill.filled_shares if self.fill.filled_shares > ZERO else ZERO

    @property
    def buffer_cost(self) -> Decimal:
        return self.slippage_reserve + self.latency_reserve

    @property
    def buffer_per_share(self) -> Decimal:
        return self.buffer_cost / self.fill.filled_shares if self.fill.filled_shares > ZERO else ZERO

    @property
    def effective_price(self) -> Decimal:
        return self.total_cost / self.fill.filled_shares if self.fill.filled_shares > ZERO else ZERO


@dataclass(frozen=True)
class ArbitrageQuote:
    combo: ArbitrageCombo
    shares: Decimal
    predict_leg: LegQuote
    polymarket_leg: LegQuote
    gross_payout: Decimal
    per_share_extra_buffers: Decimal
    fixed_costs: Decimal
    net_cost_per_share: Decimal
    profit_per_share: Decimal
    net_profit: Decimal
    executable: bool
    reasons: tuple[str, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "shares", decimal(self.shares))
        object.__setattr__(self, "gross_payout", decimal(self.gross_payout))
        object.__setattr__(self, "per_share_extra_buffers", decimal(self.per_share_extra_buffers))
        object.__setattr__(self, "fixed_costs", decimal(self.fixed_costs))
        object.__setattr__(self, "net_cost_per_share", decimal(self.net_cost_per_share))
        object.__setattr__(self, "profit_per_share", decimal(self.profit_per_share))
        object.__setattr__(self, "net_profit", decimal(self.net_profit))

    @property
    def total_cost(self) -> Decimal:
        return (
            self.predict_leg.total_cost
            + self.polymarket_leg.total_cost
            + self.per_share_extra_buffers * self.shares
            + self.fixed_costs
        )


@dataclass(frozen=True)
class VenueTradeConstraints:
    min_shares: Decimal = ZERO
    max_shares: Decimal | None = None
    min_notional: Decimal = ZERO
    max_notional: Decimal | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "min_shares", decimal(self.min_shares))
        object.__setattr__(self, "min_notional", decimal(self.min_notional))
        if self.max_shares is not None:
            object.__setattr__(self, "max_shares", decimal(self.max_shares))
        if self.max_notional is not None:
            object.__setattr__(self, "max_notional", decimal(self.max_notional))


@dataclass(frozen=True)
class SizingLimits:
    selected_predict_free_balance: Decimal
    polymarket_available_collateral: Decimal
    per_trade_max_usd: Decimal | None = None
    predict_constraints: VenueTradeConstraints = field(default_factory=VenueTradeConstraints)
    polymarket_constraints: VenueTradeConstraints = field(default_factory=VenueTradeConstraints)

    def __post_init__(self) -> None:
        object.__setattr__(self, "selected_predict_free_balance", decimal(self.selected_predict_free_balance))
        object.__setattr__(self, "polymarket_available_collateral", decimal(self.polymarket_available_collateral))
        if self.per_trade_max_usd is not None:
            object.__setattr__(self, "per_trade_max_usd", decimal(self.per_trade_max_usd))


@dataclass(frozen=True)
class SizingResult:
    combo: ArbitrageCombo
    shares: Decimal
    profitable_orderbook_depth: Decimal
    max_predict_notional: Decimal
    limited_by: tuple[str, ...]
    quote: ArbitrageQuote | None
    executable: bool
    reasons: tuple[str, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "shares", decimal(self.shares))
        object.__setattr__(self, "profitable_orderbook_depth", decimal(self.profitable_orderbook_depth))
        object.__setattr__(self, "max_predict_notional", decimal(self.max_predict_notional))


class QuoteEvaluator:
    def __init__(self, config: RiskConfig | None = None) -> None:
        self.config = config or RiskConfig()

    def evaluate_buy_complement(
        self,
        *,
        shares: Decimal | str | int,
        predict_outcome: Outcome,
        predict_book: OrderBook,
        polymarket_book: OrderBook,
        predict_fee_rate_bps: Decimal | str | int,
        polymarket_fee_rate_bps: Decimal | str | int,
        combo: ArbitrageCombo | None = None,
    ) -> ArbitrageQuote:
        share_count = decimal(shares)
        if share_count <= ZERO:
            raise ValueError("shares must be positive")

        predict_fill = predict_book.estimate_buy(share_count)
        poly_fill = polymarket_book.estimate_buy(share_count)
        poly_outcome = predict_outcome.complement()

        predict_leg = self._leg_quote(
            venue=Venue.PREDICT,
            outcome=predict_outcome,
            fill=predict_fill,
            fee_rate_bps=predict_fee_rate_bps,
            slippage_bps=self.config.predict_slippage_bps,
        )
        poly_leg = self._leg_quote(
            venue=Venue.POLYMARKET,
            outcome=poly_outcome,
            fill=poly_fill,
            fee_rate_bps=polymarket_fee_rate_bps,
            slippage_bps=self.config.polymarket_slippage_bps,
        )

        gross_payout = share_count * ONE
        per_share_extra_buffers = self.config.gas_or_fixed_cost_per_share + self.config.rounding_buffer_per_share
        variable_cost = predict_leg.total_cost + poly_leg.total_cost + per_share_extra_buffers * share_count
        net_cost_per_share = variable_cost / share_count
        profit_per_share = ONE - net_cost_per_share
        net_profit = gross_payout - variable_cost - self.config.fixed_costs_usd
        resolved_combo = combo or (
            ArbitrageCombo.COMBO_A if predict_outcome is Outcome.YES else ArbitrageCombo.COMBO_B
        )

        reasons: list[str] = []
        if not predict_fill.complete:
            reasons.append("insufficient Predict depth")
        if not poly_fill.complete:
            reasons.append("insufficient Polymarket depth")
        if predict_fill.gross_cost < self.config.min_predict_order_usdt:
            reasons.append("Predict leg is below the 1 USDT minimum order amount")
        if self.config.require_positive_after_all_buffers and profit_per_share <= ZERO:
            reasons.append("profit per share is not positive after fees and buffers")
        if net_profit <= self.config.min_net_profit_usd:
            reasons.append("net profit is not strictly positive after fees and buffers")

        return ArbitrageQuote(
            combo=resolved_combo,
            shares=share_count,
            predict_leg=predict_leg,
            polymarket_leg=poly_leg,
            gross_payout=gross_payout,
            per_share_extra_buffers=per_share_extra_buffers,
            fixed_costs=self.config.fixed_costs_usd,
            net_cost_per_share=net_cost_per_share,
            profit_per_share=profit_per_share,
            net_profit=net_profit,
            executable=not reasons,
            reasons=tuple(reasons),
        )

    def evaluate_combo_a(
        self,
        *,
        shares: Decimal | str | int,
        predict_yes_book: OrderBook,
        polymarket_no_book: OrderBook,
        predict_fee_rate_bps: Decimal | str | int,
        polymarket_fee_rate_bps: Decimal | str | int,
    ) -> ArbitrageQuote:
        return self.evaluate_buy_complement(
            shares=shares,
            predict_outcome=Outcome.YES,
            predict_book=predict_yes_book,
            polymarket_book=polymarket_no_book,
            predict_fee_rate_bps=predict_fee_rate_bps,
            polymarket_fee_rate_bps=polymarket_fee_rate_bps,
            combo=ArbitrageCombo.COMBO_A,
        )

    def evaluate_combo_b(
        self,
        *,
        shares: Decimal | str | int,
        predict_no_book: OrderBook,
        polymarket_yes_book: OrderBook,
        predict_fee_rate_bps: Decimal | str | int,
        polymarket_fee_rate_bps: Decimal | str | int,
    ) -> ArbitrageQuote:
        return self.evaluate_buy_complement(
            shares=shares,
            predict_outcome=Outcome.NO,
            predict_book=predict_no_book,
            polymarket_book=polymarket_yes_book,
            predict_fee_rate_bps=predict_fee_rate_bps,
            polymarket_fee_rate_bps=polymarket_fee_rate_bps,
            combo=ArbitrageCombo.COMBO_B,
        )

    def evaluate_two_combos(
        self,
        *,
        shares: Decimal | str | int,
        predict_yes_book: OrderBook,
        predict_no_book: OrderBook,
        polymarket_yes_book: OrderBook,
        polymarket_no_book: OrderBook,
        predict_fee_rate_bps: Decimal | str | int,
        polymarket_fee_rate_bps: Decimal | str | int,
    ) -> tuple[ArbitrageQuote, ArbitrageQuote]:
        return (
            self.evaluate_combo_a(
                shares=shares,
                predict_yes_book=predict_yes_book,
                polymarket_no_book=polymarket_no_book,
                predict_fee_rate_bps=predict_fee_rate_bps,
                polymarket_fee_rate_bps=polymarket_fee_rate_bps,
            ),
            self.evaluate_combo_b(
                shares=shares,
                predict_no_book=predict_no_book,
                polymarket_yes_book=polymarket_yes_book,
                predict_fee_rate_bps=predict_fee_rate_bps,
                polymarket_fee_rate_bps=polymarket_fee_rate_bps,
            ),
        )

    def size_buy_complement(
        self,
        *,
        combo: ArbitrageCombo,
        predict_outcome: Outcome,
        predict_book: OrderBook,
        polymarket_book: OrderBook,
        predict_fee_rate_bps: Decimal | str | int,
        polymarket_fee_rate_bps: Decimal | str | int,
        limits: SizingLimits,
    ) -> SizingResult:
        profitable_depth = self.profitable_orderbook_depth(
            combo=combo,
            predict_outcome=predict_outcome,
            predict_book=predict_book,
            polymarket_book=polymarket_book,
            predict_fee_rate_bps=predict_fee_rate_bps,
            polymarket_fee_rate_bps=polymarket_fee_rate_bps,
        )
        max_predict_notional = limits.selected_predict_free_balance * self.config.predict_max_trade_fraction
        if profitable_depth <= ZERO:
            return SizingResult(
                combo=combo,
                shares=ZERO,
                profitable_orderbook_depth=profitable_depth,
                max_predict_notional=max_predict_notional,
                limited_by=("profitable_orderbook_depth",),
                quote=None,
                executable=False,
                reasons=("no profitable orderbook depth after fees and buffers",),
            )

        depth_quote = self.evaluate_buy_complement(
            shares=profitable_depth,
            predict_outcome=predict_outcome,
            predict_book=predict_book,
            polymarket_book=polymarket_book,
            predict_fee_rate_bps=predict_fee_rate_bps,
            polymarket_fee_rate_bps=polymarket_fee_rate_bps,
            combo=combo,
        )
        candidates: list[tuple[str, Decimal]] = [("profitable_orderbook_depth", profitable_depth)]
        candidates.append(
            (
                "predict_30_percent_balance",
                self._shares_from_notional(max_predict_notional, depth_quote.predict_leg.effective_price),
            )
        )
        candidates.append(
            (
                "polymarket_available_collateral",
                self._shares_from_notional(
                    limits.polymarket_available_collateral,
                    depth_quote.polymarket_leg.effective_price,
                ),
            )
        )
        per_trade_max = limits.per_trade_max_usd if limits.per_trade_max_usd is not None else self.config.per_trade_max_usd
        if per_trade_max is not None:
            candidates.append(("per_trade_max_usd", self._shares_from_notional(per_trade_max, depth_quote.net_cost_per_share)))

        self._append_constraint_candidates(candidates, "predict", limits.predict_constraints, depth_quote.predict_leg.effective_price)
        self._append_constraint_candidates(
            candidates,
            "polymarket",
            limits.polymarket_constraints,
            depth_quote.polymarket_leg.effective_price,
        )

        selected_name, selected_shares = min(candidates, key=lambda item: item[1])
        limited_by = tuple(name for name, shares in candidates if shares == selected_shares)
        if selected_shares <= ZERO:
            return SizingResult(
                combo=combo,
                shares=ZERO,
                profitable_orderbook_depth=profitable_depth,
                max_predict_notional=max_predict_notional,
                limited_by=limited_by or (selected_name,),
                quote=None,
                executable=False,
                reasons=("sizing constraints reduce shares to zero",),
            )

        final_quote = self.evaluate_buy_complement(
            shares=selected_shares,
            predict_outcome=predict_outcome,
            predict_book=predict_book,
            polymarket_book=polymarket_book,
            predict_fee_rate_bps=predict_fee_rate_bps,
            polymarket_fee_rate_bps=polymarket_fee_rate_bps,
            combo=combo,
        )
        reasons = list(final_quote.reasons)
        self._append_min_constraint_reasons(reasons, "predict", limits.predict_constraints, selected_shares, final_quote.predict_leg.fill.gross_cost)
        self._append_min_constraint_reasons(
            reasons,
            "polymarket",
            limits.polymarket_constraints,
            selected_shares,
            final_quote.polymarket_leg.fill.gross_cost,
        )
        return SizingResult(
            combo=combo,
            shares=selected_shares,
            profitable_orderbook_depth=profitable_depth,
            max_predict_notional=max_predict_notional,
            limited_by=limited_by,
            quote=final_quote,
            executable=final_quote.executable and not reasons,
            reasons=tuple(reasons),
        )

    def size_combo_a(
        self,
        *,
        predict_yes_book: OrderBook,
        polymarket_no_book: OrderBook,
        predict_fee_rate_bps: Decimal | str | int,
        polymarket_fee_rate_bps: Decimal | str | int,
        limits: SizingLimits,
    ) -> SizingResult:
        return self.size_buy_complement(
            combo=ArbitrageCombo.COMBO_A,
            predict_outcome=Outcome.YES,
            predict_book=predict_yes_book,
            polymarket_book=polymarket_no_book,
            predict_fee_rate_bps=predict_fee_rate_bps,
            polymarket_fee_rate_bps=polymarket_fee_rate_bps,
            limits=limits,
        )

    def size_combo_b(
        self,
        *,
        predict_no_book: OrderBook,
        polymarket_yes_book: OrderBook,
        predict_fee_rate_bps: Decimal | str | int,
        polymarket_fee_rate_bps: Decimal | str | int,
        limits: SizingLimits,
    ) -> SizingResult:
        return self.size_buy_complement(
            combo=ArbitrageCombo.COMBO_B,
            predict_outcome=Outcome.NO,
            predict_book=predict_no_book,
            polymarket_book=polymarket_yes_book,
            predict_fee_rate_bps=predict_fee_rate_bps,
            polymarket_fee_rate_bps=polymarket_fee_rate_bps,
            limits=limits,
        )

    def profitable_orderbook_depth(
        self,
        *,
        combo: ArbitrageCombo,
        predict_outcome: Outcome,
        predict_book: OrderBook,
        polymarket_book: OrderBook,
        predict_fee_rate_bps: Decimal | str | int,
        polymarket_fee_rate_bps: Decimal | str | int,
    ) -> Decimal:
        max_profitable = ZERO
        for candidate_shares in self._paired_depth_breakpoints(predict_book, polymarket_book):
            quote = self.evaluate_buy_complement(
                shares=candidate_shares,
                predict_outcome=predict_outcome,
                predict_book=predict_book,
                polymarket_book=polymarket_book,
                predict_fee_rate_bps=predict_fee_rate_bps,
                polymarket_fee_rate_bps=polymarket_fee_rate_bps,
                combo=combo,
            )
            if quote.executable:
                max_profitable = candidate_shares
        return max_profitable

    def _leg_quote(
        self,
        *,
        venue: Venue,
        outcome: Outcome,
        fill: FillEstimate,
        fee_rate_bps: Decimal | str | int,
        slippage_bps: Decimal,
    ) -> LegQuote:
        fee = binary_market_taker_fee(
            shares=fill.filled_shares,
            price=fill.average_price if fill.filled_shares > ZERO else ZERO,
            fee_rate_bps=fee_rate_bps,
        )
        slippage = reserve_bps(fill.gross_cost, slippage_bps)
        latency = reserve_bps(fill.gross_cost, self.config.latency_buffer_bps)
        return LegQuote(
            venue=venue,
            outcome=outcome,
            fill=fill,
            fee=fee,
            slippage_reserve=slippage,
            latency_reserve=latency,
        )

    def _paired_depth_breakpoints(self, predict_book: OrderBook, polymarket_book: OrderBook) -> tuple[Decimal, ...]:
        if not predict_book.asks or not polymarket_book.asks:
            return ()
        breakpoints: list[Decimal] = []
        predict_index = 0
        poly_index = 0
        predict_remaining = predict_book.asks[predict_index].size
        poly_remaining = polymarket_book.asks[poly_index].size
        cumulative = ZERO

        while predict_index < len(predict_book.asks) and poly_index < len(polymarket_book.asks):
            take = min(predict_remaining, poly_remaining)
            if take > ZERO:
                cumulative += take
                breakpoints.append(cumulative)
            predict_remaining -= take
            poly_remaining -= take
            if predict_remaining <= ZERO:
                predict_index += 1
                if predict_index < len(predict_book.asks):
                    predict_remaining = predict_book.asks[predict_index].size
            if poly_remaining <= ZERO:
                poly_index += 1
                if poly_index < len(polymarket_book.asks):
                    poly_remaining = polymarket_book.asks[poly_index].size

        return tuple(breakpoints)

    def _shares_from_notional(self, notional: Decimal, effective_price: Decimal) -> Decimal:
        if notional <= ZERO or effective_price <= ZERO:
            return ZERO
        return notional / effective_price

    def _append_constraint_candidates(
        self,
        candidates: list[tuple[str, Decimal]],
        venue_name: str,
        constraints: VenueTradeConstraints,
        effective_price: Decimal,
    ) -> None:
        if constraints.max_shares is not None:
            candidates.append((f"{venue_name}_max_shares", constraints.max_shares))
        if constraints.max_notional is not None:
            candidates.append(
                (
                    f"{venue_name}_max_notional",
                    self._shares_from_notional(constraints.max_notional, effective_price),
                )
            )

    def _append_min_constraint_reasons(
        self,
        reasons: list[str],
        venue_name: str,
        constraints: VenueTradeConstraints,
        shares: Decimal,
        notional: Decimal,
    ) -> None:
        if shares < constraints.min_shares:
            reasons.append(f"{venue_name} shares below venue minimum")
        if notional < constraints.min_notional:
            reasons.append(f"{venue_name} notional below venue minimum")
