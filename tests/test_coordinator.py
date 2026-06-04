from __future__ import annotations

import unittest
from decimal import Decimal

from predictfun.accounts import AccountStatus, PolymarketAccountState, PredictAccountRotator, PredictAccountState
from predictfun.adapters import StaticPolymarketAdapter, StaticPredictAdapter
from predictfun.alerts import InMemoryAlertSink
from predictfun.audit import InMemoryAuditSink
from predictfun.coordinator import ExecutionCoordinator
from predictfun.engine import ArbEngine, FeeRates
from predictfun.models import BinaryMarketSpec, OrderBook, OrderBookLevel, Outcome, ResolutionSpec, Venue
from predictfun.risk import RiskConfig
from predictfun.risk_manager import RiskManager


def resolution() -> ResolutionSpec:
    return ResolutionSpec(
        oracle_system="UMA_OPTIMISTIC_ORACLE",
        data_source="BINANCE_BTC_USDT",
        rules_hash="abc",
        challenge_period_seconds=7200,
        finality_rule="UNLESS_CHALLENGED_THEN_UMA_FINAL",
    )


def market(venue: Venue, market_id: str) -> BinaryMarketSpec:
    return BinaryMarketSpec(
        venue=venue,
        venue_market_id=market_id,
        question="Will BTC be up?",
        underlying="BTC",
        contract_kind="UP_DOWN",
        settlement_source="BINANCE_BTC_USDT",
        window_start_utc="2026-06-03T00:00:00Z",
        window_end_utc="2026-06-03T00:15:00Z",
        decimal_precision=3,
        strike=Decimal("70000"),
        direction="UP",
        condition_id=f"condition-{market_id}",
        resolution_rule_hash="abc",
        resolution=resolution(),
    )


def book(ask_price: str, size: str = "100") -> OrderBook:
    return OrderBook(
        bids=(OrderBookLevel(price=Decimal("0.01"), size=Decimal(size)),),
        asks=(OrderBookLevel(price=Decimal(ask_price), size=Decimal(size)),),
        decimal_precision=3,
    )


class CoordinatorTests(unittest.TestCase):
    def test_run_once_dry_run_follows_architecture_pipeline(self) -> None:
        predict_market = market(Venue.PREDICT, "predict-btc")
        poly_market = market(Venue.POLYMARKET, "poly-btc")
        predict = StaticPredictAdapter(
            markets=(predict_market,),
            books={
                ("predict-btc", Outcome.YES): book("0.40"),
                ("predict-btc", Outcome.NO): book("0.41"),
            },
            balances={"p1": "100"},
        )
        poly = StaticPolymarketAdapter(
            markets=(poly_market,),
            books={
                ("poly-btc", Outcome.YES): book("0.50"),
                ("poly-btc", Outcome.NO): book("0.50"),
            },
            available_collateral="100",
        )
        audit = InMemoryAuditSink()
        alerts = InMemoryAlertSink()
        rotator = PredictAccountRotator([PredictAccountState("p1", "0x1", available_balance="100")])

        result = ExecutionCoordinator(
            predict_adapter=predict,
            polymarket_adapter=poly,
            predict_rotator=rotator,
            polymarket_account=PolymarketAccountState("poly", "0xpoly", available_balance="100"),
            engine=ArbEngine(),
            risk_manager=RiskManager(engine=ArbEngine(), per_trade_max_usd="10"),
            audit=audit,
            alerts=alerts,
            dry_run=True,
            fee_rates=FeeRates(0, 0),
        ).run_once()

        self.assertFalse(result.paused)
        self.assertEqual(len(result.scan.accepted), 1)
        self.assertEqual(len(result.decisions), 1)
        self.assertEqual(result.reports[0].status, "dry_run")
        self.assertEqual(rotator.accounts[0].status, AccountStatus.AVAILABLE)
        self.assertEqual([event.event_type for event in audit.events], ["market_discovery", "market_matcher", "execution"])
        self.assertEqual(alerts.alerts, [])

    def test_live_fill_marks_predict_account_held(self) -> None:
        predict_market = market(Venue.PREDICT, "predict-btc")
        poly_market = market(Venue.POLYMARKET, "poly-btc")
        predict = StaticPredictAdapter(
            markets=(predict_market,),
            books={
                ("predict-btc", Outcome.YES): book("0.40"),
                ("predict-btc", Outcome.NO): book("0.41"),
            },
            balances={"p1": "100"},
        )
        poly = StaticPolymarketAdapter(
            markets=(poly_market,),
            books={
                ("poly-btc", Outcome.YES): book("0.50"),
                ("poly-btc", Outcome.NO): book("0.50"),
            },
            available_collateral="100",
        )
        rotator = PredictAccountRotator([PredictAccountState("p1", "0x1", available_balance="100")])

        result = ExecutionCoordinator(
            predict_adapter=predict,
            polymarket_adapter=poly,
            predict_rotator=rotator,
            polymarket_account=PolymarketAccountState("poly", "0xpoly", available_balance="100"),
            risk_manager=RiskManager(engine=ArbEngine(), per_trade_max_usd="10"),
            dry_run=False,
            live_trading_enabled=True,
        ).run_once()

        self.assertFalse(result.paused)
        self.assertEqual(result.reports[0].status, "filled")
        self.assertEqual(rotator.accounts[0].status, AccountStatus.HELD)
        self.assertIsNotNone(rotator.accounts[0].held_position)

    def test_polymarket_insufficient_funds_pauses_before_execution(self) -> None:
        predict_market = market(Venue.PREDICT, "predict-btc")
        poly_market = market(Venue.POLYMARKET, "poly-btc")
        predict = StaticPredictAdapter(
            markets=(predict_market,),
            books={
                ("predict-btc", Outcome.YES): book("0.40"),
                ("predict-btc", Outcome.NO): book("0.41"),
            },
            balances={"p1": "100"},
        )
        poly = StaticPolymarketAdapter(
            markets=(poly_market,),
            books={
                ("poly-btc", Outcome.YES): book("0.50"),
                ("poly-btc", Outcome.NO): book("0.50"),
            },
            available_collateral="0",
        )
        alerts = InMemoryAlertSink()

        result = ExecutionCoordinator(
            predict_adapter=predict,
            polymarket_adapter=poly,
            predict_rotator=PredictAccountRotator([PredictAccountState("p1", "0x1", available_balance="100")]),
            polymarket_account=PolymarketAccountState("poly", "0xpoly", available_balance="0"),
            alerts=alerts,
        ).run_once()

        self.assertTrue(result.paused)
        self.assertIn("Polymarket account paused", result.pause_reason)
        self.assertEqual(len(alerts.alerts), 1)


if __name__ == "__main__":
    unittest.main()
