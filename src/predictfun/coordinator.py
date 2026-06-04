from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from .accounts import GlobalTradingPaused, PolymarketAccountState, PredictAccountRotator, PredictAccountState
from .adapters import PolymarketAdapter, PredictAdapter
from .alerts import Alert, AlertSink
from .audit import AuditEvent, AuditSink
from .compliance import ComplianceResult
from .discovery import MarketDiscovery
from .engine import ArbEngine, BookBundle, FeeRates
from .execution import ExecutionPlan, ExecutionReport, TwoLegExecutor
from .matching import MarketMatch
from .models import OrderRequest, OrderSide, OrderType, Outcome, Venue
from .risk_manager import RiskDecision, RiskManager
from .scanner import BtcMarketScanner, ScanResult


@dataclass(frozen=True)
class CoordinatorResult:
    scan: ScanResult
    decisions: tuple[RiskDecision, ...]
    reports: tuple[ExecutionReport, ...]
    paused: bool = False
    pause_reason: str | None = None


class ExecutionCoordinator:
    def __init__(
        self,
        *,
        predict_adapter: PredictAdapter,
        polymarket_adapter: PolymarketAdapter,
        predict_rotator: PredictAccountRotator,
        polymarket_account: PolymarketAccountState,
        discovery: MarketDiscovery | None = None,
        scanner: BtcMarketScanner | None = None,
        engine: ArbEngine | None = None,
        risk_manager: RiskManager | None = None,
        executor: TwoLegExecutor | None = None,
        audit: AuditSink | None = None,
        alerts: AlertSink | None = None,
        compliance: ComplianceResult | None = None,
        dry_run: bool = True,
        live_trading_enabled: bool = False,
        fee_rates: FeeRates | None = None,
    ) -> None:
        self.predict_adapter = predict_adapter
        self.polymarket_adapter = polymarket_adapter
        self.predict_rotator = predict_rotator
        self.polymarket_account = polymarket_account
        self.discovery = discovery or MarketDiscovery(predict=predict_adapter, polymarket=polymarket_adapter)
        self.scanner = scanner or BtcMarketScanner()
        self.engine = engine or ArbEngine()
        self.risk_manager = risk_manager or RiskManager(engine=self.engine)
        self.executor = executor or TwoLegExecutor(
            predict_client=predict_adapter,
            polymarket_client=polymarket_adapter,
        )
        self.audit = audit
        self.alerts = alerts
        self.compliance = compliance or ComplianceResult(ok=True, reasons=())
        self.dry_run = dry_run
        self.live_trading_enabled = live_trading_enabled
        self.fee_rates = fee_rates or FeeRates(predict_fee_rate_bps=0, polymarket_fee_rate_bps=0)

    def run_once(self) -> CoordinatorResult:
        discovered = self.discovery.discover()
        self._audit("market_discovery", "discovered BTC markets", {
            "predict": len(discovered.predict_markets),
            "polymarket": len(discovered.polymarket_markets),
        })

        scan = self.scanner.scan(discovered.predict_markets, discovered.polymarket_markets)
        self._audit("market_matcher", "strict matcher completed", {
            "accepted": len(scan.accepted),
            "rejected": len(scan.rejected),
        })

        decisions: list[RiskDecision] = []
        reports: list[ExecutionReport] = []
        for match in scan.accepted:
            books = self._books_for(match)
            try:
                decision = self.risk_manager.choose_trade(
                    books=books,
                    fee_rates=self.fee_rates,
                    predict_rotator=self.predict_rotator,
                    polymarket_account=self.polymarket_account,
                )
            except GlobalTradingPaused as exc:
                reason = str(exc)
                self._audit("risk_manager", "global pause", {"reason": reason})
                self._alert("warning", reason)
                return CoordinatorResult(scan=scan, decisions=tuple(decisions), reports=tuple(reports), paused=True, pause_reason=reason)

            decisions.append(decision)
            if not decision.accepted or decision.sizing is None or decision.sizing.quote is None or decision.predict_account_id is None:
                self._audit("risk_manager", "no executable hedge", {"reasons": decision.reasons})
                continue

            plan = self._plan_for(match, decision)
            report = self.executor.execute(plan)
            reports.append(report)
            self._audit("execution", "execution report", {
                "status": report.status,
                "pause_opening": report.pause_opening,
                "pause_reason": report.pause_reason,
            })
            self._settle_predict_account(decision.predict_account_id, report)

            if report.pause_opening:
                reason = report.pause_reason or "execution paused new openings"
                self._alert("warning", reason)
                return CoordinatorResult(scan=scan, decisions=tuple(decisions), reports=tuple(reports), paused=True, pause_reason=reason)

        return CoordinatorResult(scan=scan, decisions=tuple(decisions), reports=tuple(reports))

    def _books_for(self, match: MarketMatch) -> BookBundle:
        return BookBundle(
            predict_yes=self.predict_adapter.get_orderbook(match.predict, Outcome.YES),
            predict_no=self.predict_adapter.get_orderbook(match.predict, Outcome.NO),
            polymarket_yes=self.polymarket_adapter.get_orderbook(match.polymarket, Outcome.YES),
            polymarket_no=self.polymarket_adapter.get_orderbook(match.polymarket, Outcome.NO),
        )

    def _plan_for(self, match: MarketMatch, decision: RiskDecision) -> ExecutionPlan:
        assert decision.sizing is not None
        assert decision.sizing.quote is not None
        assert decision.predict_account_id is not None
        combo = decision.sizing.combo
        predict_outcome = self.risk_manager.predict_outcome_for(combo)
        polymarket_outcome = self.risk_manager.polymarket_outcome_for(combo)
        quote = decision.sizing.quote
        predict_order = OrderRequest(
            venue=Venue.PREDICT,
            market_id=match.predict.venue_market_id,
            outcome=predict_outcome,
            side=OrderSide.BUY,
            order_type=OrderType.FOK,
            shares=quote.shares,
            limit_price=quote.predict_leg.fill.worst_price or quote.predict_leg.fill.average_price,
            account_id=decision.predict_account_id,
            client_order_id=f"predict-{combo.value}-{match.predict.venue_market_id}",
        )
        polymarket_order = OrderRequest(
            venue=Venue.POLYMARKET,
            market_id=match.polymarket.venue_market_id,
            outcome=polymarket_outcome,
            side=OrderSide.BUY,
            order_type=OrderType.FOK,
            shares=quote.shares,
            limit_price=quote.polymarket_leg.fill.worst_price or quote.polymarket_leg.fill.average_price,
            account_id=self.polymarket_account.account_id,
            client_order_id=f"poly-{combo.value}-{match.polymarket.venue_market_id}",
        )
        return ExecutionPlan(
            market_match=match,
            predict_order=predict_order,
            polymarket_order=polymarket_order,
            quote=quote,
            dry_run=self.dry_run,
            live_trading_enabled=self.live_trading_enabled,
            compliance=self.compliance,
            predict_account=self._account(decision.predict_account_id),
            polymarket_account=self.polymarket_account,
        )

    def _settle_predict_account(self, account_id: str, report: ExecutionReport) -> None:
        if report.predict_held_position is not None:
            self.predict_rotator.mark_held(account_id, report.predict_held_position)
        else:
            self.predict_rotator.release(account_id)

    def _account(self, account_id: str) -> PredictAccountState | None:
        for account in self.predict_rotator.accounts:
            if account.account_id == account_id:
                return account
        return None

    def _audit(self, event_type: str, message: str, data: dict[str, object] | None = None) -> None:
        if self.audit is not None:
            self.audit.record(AuditEvent(event_type=event_type, message=message, data=dict(data or {})))

    def _alert(self, level: str, message: str) -> None:
        if self.alerts is not None:
            self.alerts.send(Alert(level=level, message=message))

