from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from typing import Any


ONE = Decimal("1")
ZERO = Decimal("0")


def decimal(value: Decimal | int | str | float) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


class Venue(str, Enum):
    PREDICT = "PREDICT"
    POLYMARKET = "POLYMARKET"


class Outcome(str, Enum):
    YES = "YES"
    NO = "NO"

    def complement(self) -> "Outcome":
        return Outcome.NO if self is Outcome.YES else Outcome.YES


class OrderSide(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(str, Enum):
    LIMIT = "LIMIT"
    MARKET = "MARKET"
    FOK = "FOK"
    FAK = "FAK"
    GTC = "GTC"
    GTD = "GTD"


class OrderStatus(str, Enum):
    LIVE = "live"
    MATCHED = "matched"
    DELAYED = "delayed"
    UNMATCHED = "unmatched"
    CANCELLED = "cancelled"
    FAILED = "failed"
    DRY_RUN = "dry_run"

    @property
    def is_filled(self) -> bool:
        return self is OrderStatus.MATCHED

    @property
    def is_open(self) -> bool:
        return self in {OrderStatus.LIVE, OrderStatus.DELAYED, OrderStatus.UNMATCHED}


@dataclass(frozen=True)
class ResolutionSpec:
    oracle_system: str
    data_source: str
    rules_hash: str
    challenge_period_seconds: int | None
    finality_rule: str
    winning_payout: Decimal = ONE
    losing_payout: Decimal = ZERO
    payout_unit: str = "USD"
    dispute_process: str = "UMA_OPTIMISTIC_ORACLE"

    def __post_init__(self) -> None:
        object.__setattr__(self, "winning_payout", decimal(self.winning_payout))
        object.__setattr__(self, "losing_payout", decimal(self.losing_payout))

    def equivalence_key(self) -> tuple[object, ...]:
        return (
            " ".join(self.oracle_system.strip().lower().split()),
            " ".join(self.data_source.strip().lower().split()),
            self.rules_hash.strip().lower(),
            self.challenge_period_seconds,
            " ".join(self.finality_rule.strip().lower().split()),
            self.winning_payout,
            self.losing_payout,
            self.payout_unit.strip().upper(),
            " ".join(self.dispute_process.strip().lower().split()),
        )


@dataclass(frozen=True)
class OrderBookLevel:
    price: Decimal
    size: Decimal

    def __post_init__(self) -> None:
        object.__setattr__(self, "price", decimal(self.price))
        object.__setattr__(self, "size", decimal(self.size))
        if self.price < ZERO or self.price > ONE:
            raise ValueError(f"price must be in [0, 1], got {self.price}")
        if self.size < ZERO:
            raise ValueError(f"size must be non-negative, got {self.size}")


@dataclass(frozen=True)
class FillEstimate:
    requested_shares: Decimal
    filled_shares: Decimal
    gross_cost: Decimal
    average_price: Decimal
    worst_price: Decimal | None
    complete: bool
    levels_used: int

    @property
    def remaining_shares(self) -> Decimal:
        return self.requested_shares - self.filled_shares


@dataclass(frozen=True)
class OrderBook:
    bids: tuple[OrderBookLevel, ...]
    asks: tuple[OrderBookLevel, ...]
    decimal_precision: int
    timestamp_ms: int | None = None
    min_order_size: Decimal | None = None
    tick_size: Decimal | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "bids", tuple(sorted(self.bids, key=lambda lvl: lvl.price, reverse=True)))
        object.__setattr__(self, "asks", tuple(sorted(self.asks, key=lambda lvl: lvl.price)))
        if self.min_order_size is not None:
            object.__setattr__(self, "min_order_size", decimal(self.min_order_size))
        if self.tick_size is not None:
            object.__setattr__(self, "tick_size", decimal(self.tick_size))

    def estimate_buy(self, shares: Decimal | int | str) -> FillEstimate:
        target = decimal(shares)
        if target <= ZERO:
            raise ValueError("shares must be positive")

        remaining = target
        gross_cost = ZERO
        filled = ZERO
        worst_price: Decimal | None = None
        levels_used = 0

        for level in self.asks:
            if remaining <= ZERO:
                break
            take = min(remaining, level.size)
            if take <= ZERO:
                continue
            gross_cost += take * level.price
            filled += take
            remaining -= take
            worst_price = level.price
            levels_used += 1

        average_price = gross_cost / filled if filled > ZERO else ZERO
        return FillEstimate(
            requested_shares=target,
            filled_shares=filled,
            gross_cost=gross_cost,
            average_price=average_price,
            worst_price=worst_price,
            complete=filled == target,
            levels_used=levels_used,
        )


@dataclass(frozen=True)
class BinaryMarketSpec:
    venue: Venue
    venue_market_id: str
    question: str
    underlying: str
    contract_kind: str
    settlement_source: str
    window_start_utc: str
    window_end_utc: str
    decimal_precision: int
    is_binary: bool = True
    strike: Decimal | None = None
    direction: str | None = None
    condition_id: str | None = None
    yes_token_id: str | None = None
    no_token_id: str | None = None
    resolution_rule_hash: str | None = None
    resolution: ResolutionSpec | None = None
    linked_polymarket_condition_ids: tuple[str, ...] = field(default_factory=tuple)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.strike is not None:
            object.__setattr__(self, "strike", decimal(self.strike))
        object.__setattr__(
            self,
            "linked_polymarket_condition_ids",
            tuple(str(item).strip().lower() for item in self.linked_polymarket_condition_ids if str(item).strip()),
        )

    def token_id_for(self, outcome: Outcome) -> str | None:
        return self.yes_token_id if outcome is Outcome.YES else self.no_token_id


@dataclass(frozen=True)
class OrderRequest:
    venue: Venue
    market_id: str
    outcome: Outcome
    side: OrderSide
    order_type: OrderType
    shares: Decimal
    limit_price: Decimal
    account_id: str
    client_order_id: str
    expected_delay_ms: int = 0
    signed_payload: dict[str, Any] | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "shares", decimal(self.shares))
        object.__setattr__(self, "limit_price", decimal(self.limit_price))
        if self.shares <= ZERO:
            raise ValueError("shares must be positive")
        if self.limit_price < ZERO or self.limit_price > ONE:
            raise ValueError("limit_price must be in [0, 1]")


@dataclass(frozen=True)
class OrderResult:
    venue: Venue
    client_order_id: str
    status: OrderStatus
    exchange_order_id: str | None = None
    filled_shares: Decimal = ZERO
    average_price: Decimal = ZERO
    error: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "filled_shares", decimal(self.filled_shares))
        object.__setattr__(self, "average_price", decimal(self.average_price))
