from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import Enum

from .models import Outcome, ZERO, decimal


class AccountStatus(str, Enum):
    AVAILABLE = "AVAILABLE"
    RESERVED = "RESERVED"
    HELD = "HELD"
    PAUSED = "PAUSED"


@dataclass(frozen=True)
class HeldPosition:
    market_id: str
    condition_id: str | None
    outcome: Outcome
    shares: Decimal
    cost_basis: Decimal
    oracle_status: str = "PENDING_UMA_FINALITY"
    redeemed: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "shares", decimal(self.shares))
        object.__setattr__(self, "cost_basis", decimal(self.cost_basis))


@dataclass(frozen=True)
class PredictAccountState:
    account_id: str
    address: str
    available_balance: Decimal = ZERO
    open_orders: int = 0
    held_position: HeldPosition | None = None
    status: AccountStatus = AccountStatus.AVAILABLE
    max_trade_fraction: Decimal = Decimal("0.30")
    pause_reason: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "available_balance", decimal(self.available_balance))
        object.__setattr__(self, "max_trade_fraction", decimal(self.max_trade_fraction))

    @property
    def is_available(self) -> bool:
        return (
            self.status is AccountStatus.AVAILABLE
            and self.held_position is None
            and self.open_orders == 0
        )

    @property
    def max_trade_notional(self) -> Decimal:
        return self.available_balance * self.max_trade_fraction

    def can_fund(self, required_notional: Decimal | str | int) -> bool:
        notional = decimal(required_notional)
        return self.is_available and notional <= self.max_trade_notional

    def can_fund_inflight(self, required_notional: Decimal | str | int) -> bool:
        notional = decimal(required_notional)
        return (
            self.status in {AccountStatus.AVAILABLE, AccountStatus.RESERVED}
            and self.held_position is None
            and self.open_orders == 0
            and notional <= self.max_trade_notional
        )

    def unavailable_reason(self, required_notional: Decimal | str | int | None = None) -> str:
        if self.status is AccountStatus.PAUSED:
            return self.pause_reason or "account paused"
        if self.held_position is not None or self.status is AccountStatus.HELD:
            return "account has a HELD position awaiting final resolution/redeem"
        if self.open_orders > 0:
            return "account has open orders"
        if self.status is AccountStatus.RESERVED:
            return "account is reserved for an in-flight hedge"
        if required_notional is not None and decimal(required_notional) > self.max_trade_notional:
            return "required Predict notional exceeds 30% of available balance"
        return "account unavailable"


@dataclass(frozen=True)
class PolymarketAccountState:
    account_id: str
    address: str
    available_balance: Decimal = ZERO
    paused: bool = False
    pause_reason: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "available_balance", decimal(self.available_balance))

    def can_fund(self, required_notional: Decimal | str | int) -> bool:
        return not self.paused and decimal(required_notional) <= self.available_balance

    def pause(self, reason: str) -> "PolymarketAccountState":
        return PolymarketAccountState(
            account_id=self.account_id,
            address=self.address,
            available_balance=self.available_balance,
            paused=True,
            pause_reason=reason,
        )


class NoPredictAccountAvailable(RuntimeError):
    pass


class GlobalTradingPaused(RuntimeError):
    pass


class PredictAccountRotator:
    def __init__(self, accounts: list[PredictAccountState]) -> None:
        if not accounts:
            raise ValueError("at least one Predict account is required")
        if len(accounts) > 10:
            raise ValueError("at most 10 Predict accounts are supported")
        self._accounts = list(accounts)
        self._last_index = -1

    @property
    def accounts(self) -> tuple[PredictAccountState, ...]:
        return tuple(self._accounts)

    def candidates_from_next(self) -> tuple[PredictAccountState, ...]:
        count = len(self._accounts)
        return tuple(self._accounts[(self._last_index + offset) % count] for offset in range(1, count + 1))

    def select(self, required_notional: Decimal | str | int) -> PredictAccountState:
        skipped: list[str] = []
        for account in self.candidates_from_next():
            if account.can_fund(required_notional):
                return self.reserve(account.account_id)
            skipped.append(f"{account.account_id}: {account.unavailable_reason(required_notional)}")
        raise NoPredictAccountAvailable("no Predict account can fund this hedge; " + "; ".join(skipped))

    def reserve(self, account_id: str) -> PredictAccountState:
        for index, account in enumerate(self._accounts):
            if account.account_id == account_id:
                if not account.is_available:
                    raise NoPredictAccountAvailable(account.unavailable_reason())
                self._last_index = index
                self._accounts[index] = self._replace(account, status=AccountStatus.RESERVED)
                return self._accounts[index]
        raise KeyError(account_id)

    def release(self, account_id: str, *, available_balance: Decimal | str | int | None = None, open_orders: int = 0) -> None:
        for index, account in enumerate(self._accounts):
            if account.account_id == account_id:
                balance = account.available_balance if available_balance is None else decimal(available_balance)
                self._accounts[index] = self._replace(
                    account,
                    available_balance=balance,
                    open_orders=open_orders,
                    status=AccountStatus.AVAILABLE,
                    held_position=None,
                    pause_reason=None,
                )
                return
        raise KeyError(account_id)

    def mark_held(self, account_id: str, held_position: HeldPosition, *, available_balance: Decimal | str | int | None = None) -> None:
        for index, account in enumerate(self._accounts):
            if account.account_id == account_id:
                balance = account.available_balance if available_balance is None else decimal(available_balance)
                self._accounts[index] = self._replace(
                    account,
                    available_balance=balance,
                    open_orders=0,
                    held_position=held_position,
                    status=AccountStatus.HELD,
                )
                return
        raise KeyError(account_id)

    def pause(self, account_id: str, reason: str) -> None:
        for index, account in enumerate(self._accounts):
            if account.account_id == account_id:
                self._accounts[index] = self._replace(account, status=AccountStatus.PAUSED, pause_reason=reason)
                return
        raise KeyError(account_id)

    def release_after_redeem(self, account_id: str, *, available_balance: Decimal | str | int) -> None:
        self.release(account_id, available_balance=available_balance, open_orders=0)

    def _replace(self, account: PredictAccountState, **changes: object) -> PredictAccountState:
        values = {
            "account_id": account.account_id,
            "address": account.address,
            "available_balance": account.available_balance,
            "open_orders": account.open_orders,
            "held_position": account.held_position,
            "status": account.status,
            "max_trade_fraction": account.max_trade_fraction,
            "pause_reason": account.pause_reason,
        }
        values.update(changes)
        return PredictAccountState(**values)  # type: ignore[arg-type]


class PolymarketFundingGuard:
    def ensure_can_open(self, account: PolymarketAccountState, required_notional: Decimal | str | int) -> PolymarketAccountState:
        if account.can_fund(required_notional):
            return account
        reason = "Polymarket account paused: insufficient funds for hedge leg"
        if account.paused and account.pause_reason:
            reason = account.pause_reason
        raise GlobalTradingPaused(reason)
