from __future__ import annotations

import time
from dataclasses import dataclass, field

from .accounts import HeldPosition, PolymarketAccountState, PredictAccountState
from .compliance import ComplianceResult
from .matching import MarketMatch
from .models import OrderRequest, OrderResult, OrderSide, OrderStatus, Venue
from .risk import ArbitrageQuote


@dataclass(frozen=True)
class ExecutionPolicy:
    poll_interval_ms: int = 50
    poll_timeout_ms: int = 2000
    crypto_finance_taker_delay_ms: int = 250
    sports_taker_delay_ms: int = 1000
    allow_loss_mitigating_rescue: bool = False


@dataclass(frozen=True)
class ExecutionPlan:
    market_match: MarketMatch
    predict_order: OrderRequest
    polymarket_order: OrderRequest
    quote: ArbitrageQuote
    dry_run: bool
    live_trading_enabled: bool
    compliance: ComplianceResult
    predict_account: PredictAccountState | None = None
    polymarket_account: PolymarketAccountState | None = None


@dataclass(frozen=True)
class ExecutionReport:
    status: str
    results: tuple[OrderResult, ...]
    messages: tuple[str, ...] = ()
    cancel_result: OrderResult | None = None
    rescue_result: OrderResult | None = None
    predict_held_position: HeldPosition | None = None
    pause_opening: bool = False
    pause_reason: str | None = None
    raw: dict[str, object] = field(default_factory=dict)


class ExecutionRejected(RuntimeError):
    def __init__(self, reasons: list[str]) -> None:
        super().__init__("execution rejected: " + "; ".join(reasons))
        self.reasons = tuple(reasons)


class ExecutionGuard:
    def validate(self, plan: ExecutionPlan) -> None:
        reasons: list[str] = []

        if not plan.market_match.matched:
            reasons.extend(plan.market_match.reasons)
        if not plan.compliance.ok:
            reasons.extend(plan.compliance.reasons)
        if not plan.quote.executable:
            reasons.extend(plan.quote.reasons)
        if not plan.dry_run and not plan.live_trading_enabled:
            reasons.append("live trading is disabled")

        orders = (plan.predict_order, plan.polymarket_order)
        if {order.venue for order in orders} != {Venue.PREDICT, Venue.POLYMARKET}:
            reasons.append("plan must contain one Predict order and one Polymarket order")
        if any(order.side is not OrderSide.BUY for order in orders):
            reasons.append("only buy/buy hedges are allowed")
        if plan.predict_order.outcome.complement() is not plan.polymarket_order.outcome:
            reasons.append("orders must buy complementary outcomes")
        if plan.predict_order.shares != plan.polymarket_order.shares:
            reasons.append("hedge legs must use equal share size")
        if not plan.predict_order.account_id:
            reasons.append("Predict order requires a selected Predict account")
        if plan.predict_account is not None:
            if plan.predict_account.account_id != plan.predict_order.account_id:
                reasons.append("selected Predict account does not match Predict order account_id")
            if not plan.predict_account.can_fund_inflight(plan.quote.predict_leg.total_cost):
                reasons.append(plan.predict_account.unavailable_reason(plan.quote.predict_leg.total_cost))
        if plan.polymarket_account is not None and not plan.polymarket_account.can_fund(plan.quote.polymarket_leg.total_cost):
            reasons.append("Polymarket account cannot fund hedge leg; pause opening new positions")

        if reasons:
            raise ExecutionRejected(reasons)


class TradingClient:
    def place_order(self, request: OrderRequest) -> OrderResult:
        raise NotImplementedError

    def get_order(self, exchange_order_id: str) -> OrderResult:
        raise NotImplementedError

    def cancel_order(self, exchange_order_id: str) -> OrderResult:
        raise NotImplementedError


class TwoLegExecutor:
    def __init__(
        self,
        *,
        predict_client: TradingClient,
        polymarket_client: TradingClient,
        guard: ExecutionGuard | None = None,
        policy: ExecutionPolicy | None = None,
    ) -> None:
        self.predict_client = predict_client
        self.polymarket_client = polymarket_client
        self.guard = guard or ExecutionGuard()
        self.policy = policy or ExecutionPolicy()

    def execute(self, plan: ExecutionPlan) -> ExecutionReport:
        self.guard.validate(plan)

        if plan.dry_run:
            return ExecutionReport(status="dry_run", results=(), messages=("validated dry-run plan",))

        first, first_client, second, second_client = self._execution_order(plan)

        first_result = self._place_and_resolve(first_client, first)
        if not first_result.status.is_filled:
            return ExecutionReport(
                status="paused",
                results=(first_result,),
                messages=("first leg did not fill; second leg was not submitted",),
                pause_opening=True,
                pause_reason="first hedge leg failed or remained unfilled",
            )

        second_result = self._place_and_resolve(second_client, second)
        if second_result.status.is_filled:
            results = (first_result, second_result)
            return ExecutionReport(
                status="filled",
                results=results,
                predict_held_position=self._predict_held_position(plan, results),
            )

        cancel_result = self._cancel_open_if_possible(second_client, second_result)
        rescue = self._rescue_unhedged_fill(
            filled=first_result,
            missing_order=second,
            missing_client=second_client,
            plan=plan,
        )
        return ExecutionReport(
            status="rescue_attempted" if rescue else "unhedged_fill",
            results=(first_result, second_result),
            cancel_result=cancel_result,
            rescue_result=rescue,
            predict_held_position=self._predict_held_position(plan, (first_result, second_result, rescue)),
            messages=("one leg filled while the hedge leg did not fill",),
            pause_opening=True,
            pause_reason="one hedge leg filled while the other failed or remained unfilled",
        )

    def _execution_order(
        self, plan: ExecutionPlan
    ) -> tuple[OrderRequest, TradingClient, OrderRequest, TradingClient]:
        if plan.polymarket_order.expected_delay_ms >= plan.predict_order.expected_delay_ms:
            return plan.polymarket_order, self.polymarket_client, plan.predict_order, self.predict_client
        return plan.predict_order, self.predict_client, plan.polymarket_order, self.polymarket_client

    def _place_and_resolve(self, client: TradingClient, order: OrderRequest) -> OrderResult:
        result = client.place_order(order)
        if result.status is not OrderStatus.DELAYED or not result.exchange_order_id:
            return result

        deadline = time.monotonic() + self.policy.poll_timeout_ms / 1000
        current = result
        while time.monotonic() < deadline:
            time.sleep(self.policy.poll_interval_ms / 1000)
            current = client.get_order(result.exchange_order_id)
            if current.status is not OrderStatus.DELAYED:
                return current
        return current

    def _rescue_unhedged_fill(
        self,
        *,
        filled: OrderResult,
        missing_order: OrderRequest,
        missing_client: TradingClient,
        plan: ExecutionPlan,
    ) -> OrderResult | None:
        if plan.quote.net_profit <= 0 and not self.policy.allow_loss_mitigating_rescue:
            return None
        rescue_request = OrderRequest(
            venue=missing_order.venue,
            market_id=missing_order.market_id,
            outcome=missing_order.outcome,
            side=missing_order.side,
            order_type=missing_order.order_type,
            shares=filled.filled_shares,
            limit_price=missing_order.limit_price,
            account_id=missing_order.account_id,
            client_order_id=f"{missing_order.client_order_id}-rescue",
            expected_delay_ms=missing_order.expected_delay_ms,
            signed_payload=missing_order.signed_payload,
        )
        return self._place_and_resolve(missing_client, rescue_request)

    def _cancel_open_if_possible(self, client: TradingClient, result: OrderResult) -> OrderResult | None:
        if result.status is OrderStatus.DELAYED:
            return None
        if result.status.is_open and result.exchange_order_id:
            return client.cancel_order(result.exchange_order_id)
        return None

    def _predict_held_position(
        self,
        plan: ExecutionPlan,
        results: tuple[OrderResult | None, ...],
    ) -> HeldPosition | None:
        for result in results:
            if result is None or result.venue is not Venue.PREDICT or not result.status.is_filled:
                continue
            return HeldPosition(
                market_id=plan.predict_order.market_id,
                condition_id=plan.market_match.predict.condition_id,
                outcome=plan.predict_order.outcome,
                shares=result.filled_shares,
                cost_basis=result.filled_shares * result.average_price,
            )
        return None
