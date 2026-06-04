from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from .accounts import HeldPosition
from .models import BinaryMarketSpec, OrderBook, OrderRequest, OrderResult, OrderStatus, Outcome, Venue, decimal


class PredictAdapter:
    """Predict REST/WS/JWT boundary.

    Live implementations should fetch markets and balances through REST/WS,
    authenticate private user actions with JWT, and submit signed SDK orders.
    """

    def list_btc_markets(self) -> tuple[BinaryMarketSpec, ...]:
        raise NotImplementedError

    def get_orderbook(self, market: BinaryMarketSpec, outcome: Outcome) -> OrderBook:
        raise NotImplementedError

    def get_available_balance(self, account_id: str) -> Decimal:
        raise NotImplementedError

    def get_open_order_count(self, account_id: str) -> int:
        raise NotImplementedError

    def get_held_position(self, account_id: str) -> HeldPosition | None:
        raise NotImplementedError

    def place_order(self, request: OrderRequest) -> OrderResult:
        raise NotImplementedError

    def get_order(self, exchange_order_id: str) -> OrderResult:
        raise NotImplementedError

    def cancel_order(self, exchange_order_id: str) -> OrderResult:
        raise NotImplementedError


class PolymarketAdapter:
    """Polymarket Gamma/Data/CLOB/WS boundary.

    Live implementations should use Gamma for discovery, Data for account
    state, CLOB for books/orders, and WS for fast book/order updates.
    """

    def list_btc_markets(self) -> tuple[BinaryMarketSpec, ...]:
        raise NotImplementedError

    def get_orderbook(self, market: BinaryMarketSpec, outcome: Outcome) -> OrderBook:
        raise NotImplementedError

    def get_available_collateral(self) -> Decimal:
        raise NotImplementedError

    def place_order(self, request: OrderRequest) -> OrderResult:
        raise NotImplementedError

    def get_order(self, exchange_order_id: str) -> OrderResult:
        raise NotImplementedError

    def cancel_order(self, exchange_order_id: str) -> OrderResult:
        raise NotImplementedError


@dataclass
class StaticPredictAdapter(PredictAdapter):
    markets: tuple[BinaryMarketSpec, ...]
    books: dict[tuple[str, Outcome], OrderBook]
    balances: dict[str, Decimal | str | int] = field(default_factory=dict)
    open_orders: dict[str, int] = field(default_factory=dict)
    held_positions: dict[str, HeldPosition | None] = field(default_factory=dict)
    fill_status: OrderStatus = OrderStatus.MATCHED
    placed_orders: list[OrderRequest] = field(default_factory=list)

    def list_btc_markets(self) -> tuple[BinaryMarketSpec, ...]:
        return tuple(market for market in self.markets if market.underlying.strip().lower() == "btc")

    def get_orderbook(self, market: BinaryMarketSpec, outcome: Outcome) -> OrderBook:
        return self.books[(market.venue_market_id, outcome)]

    def get_available_balance(self, account_id: str) -> Decimal:
        return decimal(self.balances.get(account_id, "0"))

    def get_open_order_count(self, account_id: str) -> int:
        return int(self.open_orders.get(account_id, 0))

    def get_held_position(self, account_id: str) -> HeldPosition | None:
        return self.held_positions.get(account_id)

    def place_order(self, request: OrderRequest) -> OrderResult:
        self.placed_orders.append(request)
        filled = request.shares if self.fill_status is OrderStatus.MATCHED else Decimal("0")
        return OrderResult(
            venue=Venue.PREDICT,
            client_order_id=request.client_order_id,
            status=self.fill_status,
            exchange_order_id=f"static-predict-{request.client_order_id}",
            filled_shares=filled,
            average_price=request.limit_price if filled else Decimal("0"),
        )

    def get_order(self, exchange_order_id: str) -> OrderResult:
        return OrderResult(
            venue=Venue.PREDICT,
            client_order_id=exchange_order_id,
            exchange_order_id=exchange_order_id,
            status=self.fill_status,
        )

    def cancel_order(self, exchange_order_id: str) -> OrderResult:
        return OrderResult(
            venue=Venue.PREDICT,
            client_order_id=exchange_order_id,
            exchange_order_id=exchange_order_id,
            status=OrderStatus.CANCELLED,
        )


@dataclass
class StaticPolymarketAdapter(PolymarketAdapter):
    markets: tuple[BinaryMarketSpec, ...]
    books: dict[tuple[str, Outcome], OrderBook]
    available_collateral: Decimal | str | int = Decimal("0")
    fill_status: OrderStatus = OrderStatus.MATCHED
    placed_orders: list[OrderRequest] = field(default_factory=list)

    def list_btc_markets(self) -> tuple[BinaryMarketSpec, ...]:
        return tuple(market for market in self.markets if market.underlying.strip().lower() == "btc")

    def get_orderbook(self, market: BinaryMarketSpec, outcome: Outcome) -> OrderBook:
        return self.books[(market.venue_market_id, outcome)]

    def get_available_collateral(self) -> Decimal:
        return decimal(self.available_collateral)

    def place_order(self, request: OrderRequest) -> OrderResult:
        self.placed_orders.append(request)
        filled = request.shares if self.fill_status is OrderStatus.MATCHED else Decimal("0")
        return OrderResult(
            venue=Venue.POLYMARKET,
            client_order_id=request.client_order_id,
            status=self.fill_status,
            exchange_order_id=f"static-poly-{request.client_order_id}",
            filled_shares=filled,
            average_price=request.limit_price if filled else Decimal("0"),
        )

    def get_order(self, exchange_order_id: str) -> OrderResult:
        return OrderResult(
            venue=Venue.POLYMARKET,
            client_order_id=exchange_order_id,
            exchange_order_id=exchange_order_id,
            status=self.fill_status,
        )

    def cancel_order(self, exchange_order_id: str) -> OrderResult:
        return OrderResult(
            venue=Venue.POLYMARKET,
            client_order_id=exchange_order_id,
            exchange_order_id=exchange_order_id,
            status=OrderStatus.CANCELLED,
        )
