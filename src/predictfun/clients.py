from __future__ import annotations

import json
import urllib.parse
import urllib.request
from decimal import Decimal
from typing import Mapping

from .execution import TradingClient
from .models import OrderBook, OrderBookLevel, OrderRequest, OrderResult, OrderStatus, Venue, decimal
from .orderbook import predict_yes_book_to_outcome_book


class DryRunTradingClient(TradingClient):
    def __init__(self, venue: Venue, *, fill_status: OrderStatus = OrderStatus.MATCHED) -> None:
        self.venue = venue
        self.fill_status = fill_status
        self.orders: list[OrderRequest] = []

    def place_order(self, request: OrderRequest) -> OrderResult:
        self.orders.append(request)
        filled = request.shares if self.fill_status is OrderStatus.MATCHED else Decimal("0")
        return OrderResult(
            venue=request.venue,
            client_order_id=request.client_order_id,
            status=self.fill_status,
            exchange_order_id=f"dry-run-{request.client_order_id}",
            filled_shares=filled,
            average_price=request.limit_price if filled else Decimal("0"),
        )

    def get_order(self, exchange_order_id: str) -> OrderResult:
        return OrderResult(
            venue=self.venue,
            client_order_id=exchange_order_id,
            exchange_order_id=exchange_order_id,
            status=self.fill_status,
        )

    def cancel_order(self, exchange_order_id: str) -> OrderResult:
        return OrderResult(
            venue=self.venue,
            client_order_id=exchange_order_id,
            exchange_order_id=exchange_order_id,
            status=OrderStatus.CANCELLED,
        )


class HttpJsonClient:
    def __init__(self, base_url: str, headers: Mapping[str, str] | None = None, timeout_seconds: float = 5.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.headers = dict(headers or {})
        self.timeout_seconds = timeout_seconds

    def get_json(self, path: str, query: Mapping[str, object] | None = None) -> dict[str, object]:
        query_string = ""
        if query:
            query_string = "?" + urllib.parse.urlencode({key: str(value) for key, value in query.items()})
        request = urllib.request.Request(
            self.base_url + path + query_string,
            headers={"User-Agent": "predictfun/0.1", **self.headers},
        )
        with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
            return json.loads(response.read().decode("utf-8"))


class PredictReadClient:
    def __init__(self, *, api_key: str | None, base_url: str = "https://api.predict.fun") -> None:
        headers = {"x-api-key": api_key} if api_key else {}
        self.http = HttpJsonClient(base_url, headers=headers)

    def get_outcome_orderbook(self, *, market_id: str, outcome, decimal_precision: int) -> OrderBook:
        payload = self.http.get_json(f"/v1/markets/{market_id}/orderbook")
        data = payload.get("data")
        if not isinstance(data, dict):
            raise ValueError("Predict orderbook response missing data object")
        return predict_yes_book_to_outcome_book(
            yes_bids=data.get("bids", []),  # type: ignore[arg-type]
            yes_asks=data.get("asks", []),  # type: ignore[arg-type]
            outcome=outcome,
            decimal_precision=decimal_precision,
            timestamp_ms=int(data["updateTimestampMs"]) if data.get("updateTimestampMs") is not None else None,
        )


class PolymarketReadClient:
    def __init__(self, *, base_url: str = "https://clob.polymarket.com") -> None:
        self.http = HttpJsonClient(base_url)

    def get_token_orderbook(self, *, token_id: str, decimal_precision: int = 2) -> OrderBook:
        payload = self.http.get_json("/book", {"token_id": token_id})
        data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
        if not isinstance(data, dict):
            raise ValueError("Polymarket orderbook response missing book object")
        return OrderBook(
            bids=self._parse_levels(data.get("bids", [])),
            asks=self._parse_levels(data.get("asks", [])),
            decimal_precision=decimal_precision,
            min_order_size=decimal(data["min_order_size"]) if data.get("min_order_size") is not None else None,
            tick_size=decimal(data["tick_size"]) if data.get("tick_size") is not None else None,
        )

    def _parse_levels(self, raw_levels: object) -> tuple[OrderBookLevel, ...]:
        if not isinstance(raw_levels, list):
            raise ValueError("Polymarket orderbook levels must be a list")
        levels: list[OrderBookLevel] = []
        for raw in raw_levels:
            if isinstance(raw, dict):
                levels.append(OrderBookLevel(price=decimal(raw["price"]), size=decimal(raw["size"])))
            elif isinstance(raw, (list, tuple)) and len(raw) >= 2:
                levels.append(OrderBookLevel(price=decimal(raw[0]), size=decimal(raw[1])))
            else:
                raise ValueError(f"unsupported Polymarket orderbook level: {raw!r}")
        return tuple(levels)


class SignedOrderClient(TradingClient):
    """Boundary for real signed trading clients.

    Use the official Predict and Polymarket SDKs behind this interface. The bot
    core intentionally does not accept raw private keys or implement signing.
    """

    def place_order(self, request: OrderRequest) -> OrderResult:
        if request.signed_payload is None:
            return OrderResult(
                venue=request.venue,
                client_order_id=request.client_order_id,
                status=OrderStatus.FAILED,
                error="signed_payload is required for live trading",
            )
        raise NotImplementedError("wire official SDK order submission here")

    def get_order(self, exchange_order_id: str) -> OrderResult:
        raise NotImplementedError("wire official SDK order polling here")

    def cancel_order(self, exchange_order_id: str) -> OrderResult:
        raise NotImplementedError("wire official SDK cancellation here")
