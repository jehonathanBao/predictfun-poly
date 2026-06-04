from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .models import ONE, ZERO, decimal


BPS = Decimal("10000")


@dataclass(frozen=True)
class FeeEstimate:
    amount: Decimal
    fee_rate_bps: Decimal
    model: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "amount", decimal(self.amount))
        object.__setattr__(self, "fee_rate_bps", decimal(self.fee_rate_bps))


def binary_market_taker_fee(
    *,
    shares: Decimal | str | int,
    price: Decimal | str | int,
    fee_rate_bps: Decimal | str | int,
    model_name: str = "binary_min_price",
) -> FeeEstimate:
    """Estimate CTF-style binary taker fees.

    The conservative bot uses the same shape commonly documented for binary
    outcome markets: shares * fee_rate_bps / 10000 * min(price, 1 - price).
    If an exchange exposes a higher explicit fee estimate, prefer that value
    before passing a quote to the risk gate.
    """

    share_count = decimal(shares)
    share_price = decimal(price)
    bps = decimal(fee_rate_bps)
    if share_count < ZERO:
        raise ValueError("shares must be non-negative")
    if share_price < ZERO or share_price > ONE:
        raise ValueError("price must be in [0, 1]")
    if bps < ZERO:
        raise ValueError("fee_rate_bps must be non-negative")

    fee_basis_price = min(share_price, ONE - share_price)
    return FeeEstimate(amount=share_count * fee_basis_price * bps / BPS, fee_rate_bps=bps, model=model_name)


def reserve_bps(amount: Decimal | str | int, reserve_rate_bps: Decimal | str | int) -> Decimal:
    base = decimal(amount)
    bps = decimal(reserve_rate_bps)
    if base < ZERO:
        raise ValueError("amount must be non-negative")
    if bps < ZERO:
        raise ValueError("reserve_rate_bps must be non-negative")
    return base * bps / BPS

