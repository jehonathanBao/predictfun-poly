from __future__ import annotations

import unittest
from decimal import Decimal

from predictfun.compliance import ComplianceResult
from predictfun.execution import ExecutionGuard, ExecutionPlan, ExecutionPolicy, ExecutionRejected, TwoLegExecutor
from predictfun.matching import MarketMatch
from predictfun.models import (
    BinaryMarketSpec,
    FillEstimate,
    OrderBook,
    OrderBookLevel,
    OrderRequest,
    OrderSide,
    OrderStatus,
    OrderType,
    Outcome,
    Venue,
)
from predictfun.clients import DryRunTradingClient
from predictfun.accounts import PolymarketAccountState, PredictAccountState
from predictfun.risk import QuoteEvaluator, RiskConfig


def spec(venue: Venue) -> BinaryMarketSpec:
    return BinaryMarketSpec(
        venue=venue,
        venue_market_id="m1",
        question="Will BTC be up?",
        underlying="BTC",
        contract_kind="UP_DOWN",
        settlement_source="BINANCE_BTC_USDT",
        window_start_utc="2026-06-03T00:00:00Z",
        window_end_utc="2026-06-03T00:15:00Z",
        decimal_precision=3,
        strike=Decimal("70000"),
        direction="UP",
        resolution_rule_hash="abc",
    )


def executable_quote() -> object:
    book = OrderBook(
        bids=(OrderBookLevel(price=Decimal("0.01"), size=Decimal("10")),),
        asks=(OrderBookLevel(price=Decimal("0.45"), size=Decimal("10")),),
        decimal_precision=3,
    )
    return QuoteEvaluator(RiskConfig(predict_slippage_bps="0", polymarket_slippage_bps="0", latency_buffer_bps="0")).evaluate_buy_complement(
        shares="10",
        predict_outcome=Outcome.YES,
        predict_book=book,
        polymarket_book=book,
        predict_fee_rate_bps="0",
        polymarket_fee_rate_bps="0",
    )


def order(venue: Venue, outcome: Outcome, account_id: str = "acct") -> OrderRequest:
    return OrderRequest(
        venue=venue,
        market_id="m1",
        outcome=outcome,
        side=OrderSide.BUY,
        order_type=OrderType.FOK,
        shares=Decimal("10"),
        limit_price=Decimal("0.45"),
        account_id=account_id,
        client_order_id=f"{venue.value}-{outcome.value}",
    )


class ExecutionTests(unittest.TestCase):
    def test_guard_rejects_same_outcome(self) -> None:
        plan = ExecutionPlan(
            market_match=MarketMatch(spec(Venue.PREDICT), spec(Venue.POLYMARKET), True, ()),
            predict_order=order(Venue.PREDICT, Outcome.YES),
            polymarket_order=order(Venue.POLYMARKET, Outcome.YES),
            quote=executable_quote(),  # type: ignore[arg-type]
            dry_run=True,
            live_trading_enabled=False,
            compliance=ComplianceResult(ok=True, reasons=()),
        )

        with self.assertRaises(ExecutionRejected):
            ExecutionGuard().validate(plan)

    def test_dry_run_validates_without_submitting_orders(self) -> None:
        plan = ExecutionPlan(
            market_match=MarketMatch(spec(Venue.PREDICT), spec(Venue.POLYMARKET), True, ()),
            predict_order=order(Venue.PREDICT, Outcome.YES),
            polymarket_order=order(Venue.POLYMARKET, Outcome.NO),
            quote=executable_quote(),  # type: ignore[arg-type]
            dry_run=True,
            live_trading_enabled=False,
            compliance=ComplianceResult(ok=True, reasons=()),
        )
        predict = DryRunTradingClient(Venue.PREDICT)
        poly = DryRunTradingClient(Venue.POLYMARKET)

        report = TwoLegExecutor(
            predict_client=predict,
            polymarket_client=poly,
            policy=ExecutionPolicy(poll_timeout_ms=1),
        ).execute(plan)

        self.assertEqual(report.status, "dry_run")
        self.assertEqual(predict.orders, [])
        self.assertEqual(poly.orders, [])

    def test_live_aborts_when_first_leg_unmatched(self) -> None:
        plan = ExecutionPlan(
            market_match=MarketMatch(spec(Venue.PREDICT), spec(Venue.POLYMARKET), True, ()),
            predict_order=order(Venue.PREDICT, Outcome.YES),
            polymarket_order=order(Venue.POLYMARKET, Outcome.NO),
            quote=executable_quote(),  # type: ignore[arg-type]
            dry_run=False,
            live_trading_enabled=True,
            compliance=ComplianceResult(ok=True, reasons=()),
        )
        predict = DryRunTradingClient(Venue.PREDICT)
        poly = DryRunTradingClient(Venue.POLYMARKET, fill_status=OrderStatus.UNMATCHED)

        report = TwoLegExecutor(
            predict_client=predict,
            polymarket_client=poly,
            policy=ExecutionPolicy(poll_timeout_ms=1),
        ).execute(plan)

        self.assertEqual(report.status, "paused")
        self.assertTrue(report.pause_opening)
        self.assertEqual(predict.orders, [])
        self.assertEqual(len(poly.orders), 1)

    def test_live_fill_reports_predict_held_position(self) -> None:
        plan = ExecutionPlan(
            market_match=MarketMatch(spec(Venue.PREDICT), spec(Venue.POLYMARKET), True, ()),
            predict_order=order(Venue.PREDICT, Outcome.YES),
            polymarket_order=order(Venue.POLYMARKET, Outcome.NO),
            quote=executable_quote(),  # type: ignore[arg-type]
            dry_run=False,
            live_trading_enabled=True,
            compliance=ComplianceResult(ok=True, reasons=()),
        )

        report = TwoLegExecutor(
            predict_client=DryRunTradingClient(Venue.PREDICT),
            polymarket_client=DryRunTradingClient(Venue.POLYMARKET),
            policy=ExecutionPolicy(poll_timeout_ms=1),
        ).execute(plan)

        self.assertEqual(report.status, "filled")
        self.assertIsNotNone(report.predict_held_position)
        self.assertEqual(report.predict_held_position.outcome, Outcome.YES)

    def test_cancels_open_second_leg_before_rescue_attempt(self) -> None:
        plan = ExecutionPlan(
            market_match=MarketMatch(spec(Venue.PREDICT), spec(Venue.POLYMARKET), True, ()),
            predict_order=order(Venue.PREDICT, Outcome.YES),
            polymarket_order=order(Venue.POLYMARKET, Outcome.NO),
            quote=executable_quote(),  # type: ignore[arg-type]
            dry_run=False,
            live_trading_enabled=True,
            compliance=ComplianceResult(ok=True, reasons=()),
        )
        predict = DryRunTradingClient(Venue.PREDICT, fill_status=OrderStatus.LIVE)
        poly = DryRunTradingClient(Venue.POLYMARKET, fill_status=OrderStatus.MATCHED)

        report = TwoLegExecutor(
            predict_client=predict,
            polymarket_client=poly,
            policy=ExecutionPolicy(poll_timeout_ms=1),
        ).execute(plan)

        self.assertEqual(report.status, "rescue_attempted")
        self.assertTrue(report.pause_opening)
        self.assertIsNotNone(report.cancel_result)
        self.assertEqual(report.cancel_result.status, OrderStatus.CANCELLED)
        self.assertEqual(len(predict.orders), 2)

    def test_guard_rejects_selected_predict_account_over_30_percent_limit(self) -> None:
        plan = ExecutionPlan(
            market_match=MarketMatch(spec(Venue.PREDICT), spec(Venue.POLYMARKET), True, ()),
            predict_order=order(Venue.PREDICT, Outcome.YES),
            polymarket_order=order(Venue.POLYMARKET, Outcome.NO),
            quote=executable_quote(),  # type: ignore[arg-type]
            dry_run=True,
            live_trading_enabled=False,
            compliance=ComplianceResult(ok=True, reasons=()),
            predict_account=PredictAccountState("acct", "0x1", available_balance="10"),
            polymarket_account=PolymarketAccountState("poly", "0x2", available_balance="100"),
        )

        with self.assertRaises(ExecutionRejected):
            ExecutionGuard().validate(plan)


if __name__ == "__main__":
    unittest.main()
