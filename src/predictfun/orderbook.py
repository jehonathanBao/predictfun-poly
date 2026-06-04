from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, Sequence

from .models import ONE, OrderBook, OrderBookLevel, Outcome, decimal


def price_quantum(decimal_precision: int) -> Decimal:
    if decimal_precision < 0:
        raise ValueError("decimal_precision must be non-negative")
    return Decimal("1").scaleb(-decimal_precision)


def quantize_price(price: Decimal | str | int | float, decimal_precision: int) -> Decimal:
    return decimal(price).quantize(price_quantum(decimal_precision), rounding=ROUND_HALF_UP)


def complement_price(price: Decimal | str | int | float, decimal_precision: int) -> Decimal:
    return quantize_price(ONE - decimal(price), decimal_precision)


def _parse_level(raw: Sequence[object]) -> OrderBookLevel:
    if len(raw) < 2:
        raise ValueError(f"orderbook level requires [price, size], got {raw}")
    return OrderBookLevel(price=decimal(raw[0]), size=decimal(raw[1]))


def parse_levels(raw_levels: Iterable[Sequence[object]]) -> tuple[OrderBookLevel, ...]:
    return tuple(_parse_level(raw) for raw in raw_levels)


def predict_yes_book_to_outcome_book(
    *,
    yes_bids: Iterable[Sequence[object]],
    yes_asks: Iterable[Sequence[object]],
    outcome: Outcome,
    decimal_precision: int,
    timestamp_ms: int | None = None,
) -> OrderBook:
    """Convert Predict's YES-based book into a book for the requested outcome.

    Predict documents bids/asks as YES-side prices. For NO:
    - NO asks come from complemented YES bids.
    - NO bids come from complemented YES asks.
    """

    bids = parse_levels(yes_bids)
    asks = parse_levels(yes_asks)

    if outcome is Outcome.YES:
        return OrderBook(bids=bids, asks=asks, decimal_precision=decimal_precision, timestamp_ms=timestamp_ms)

    no_asks = tuple(
        OrderBookLevel(price=complement_price(level.price, decimal_precision), size=level.size)
        for level in bids
    )
    no_bids = tuple(
        OrderBookLevel(price=complement_price(level.price, decimal_precision), size=level.size)
        for level in asks
    )
    return OrderBook(bids=no_bids, asks=no_asks, decimal_precision=decimal_precision, timestamp_ms=timestamp_ms)

