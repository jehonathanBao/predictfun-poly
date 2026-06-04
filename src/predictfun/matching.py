from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .models import BinaryMarketSpec, Venue


def _norm(value: str | None) -> str:
    return " ".join((value or "").strip().lower().split())


def _norm_decimal(value: Decimal | None) -> str:
    if value is None:
        return ""
    return format(value.normalize(), "f")


def _resolution_key(market: BinaryMarketSpec) -> tuple[object, ...] | None:
    if market.resolution is not None:
        return market.resolution.equivalence_key()
    return None


@dataclass(frozen=True)
class MarketMatch:
    predict: BinaryMarketSpec
    polymarket: BinaryMarketSpec
    matched: bool
    reasons: tuple[str, ...]


class StrictMarketMatcher:
    """Accept only field-complete BTC binary equivalence."""

    def match(self, predict: BinaryMarketSpec, polymarket: BinaryMarketSpec) -> MarketMatch:
        reasons: list[str] = []

        if predict.venue is not Venue.PREDICT:
            reasons.append("left market must be Predict")
        if polymarket.venue is not Venue.POLYMARKET:
            reasons.append("right market must be Polymarket")
        if not predict.is_binary or not polymarket.is_binary:
            reasons.append("both markets must be binary")
        if _norm(predict.underlying) != "btc" or _norm(polymarket.underlying) != "btc":
            reasons.append("both markets must be BTC markets")

        poly_condition = _norm(polymarket.condition_id)
        direct_link = bool(poly_condition and poly_condition in predict.linked_polymarket_condition_ids)

        required_fields = {
            "contract_kind": (_norm(predict.contract_kind), _norm(polymarket.contract_kind)),
            "settlement_source": (_norm(predict.settlement_source), _norm(polymarket.settlement_source)),
            "window_start_utc": (_norm(predict.window_start_utc), _norm(polymarket.window_start_utc)),
            "window_end_utc": (_norm(predict.window_end_utc), _norm(polymarket.window_end_utc)),
            "strike": (_norm_decimal(predict.strike), _norm_decimal(polymarket.strike)),
            "direction": (_norm(predict.direction), _norm(polymarket.direction)),
            "resolution_rule_hash": (_norm(predict.resolution_rule_hash), _norm(polymarket.resolution_rule_hash)),
        }

        for field_name, (left, right) in required_fields.items():
            if not left or not right:
                reasons.append(f"missing strict equivalence field: {field_name}")
            elif left != right:
                reasons.append(f"strict equivalence mismatch: {field_name}")

        predict_resolution = _resolution_key(predict)
        polymarket_resolution = _resolution_key(polymarket)
        if predict_resolution is None or polymarket_resolution is None:
            reasons.append("missing strict equivalence field: resolution")
        elif predict_resolution != polymarket_resolution:
            reasons.append("strict equivalence mismatch: resolution")

        if direct_link and reasons:
            reasons.append("direct market link does not override strict BTC/resolution checks")

        return MarketMatch(predict=predict, polymarket=polymarket, matched=not reasons, reasons=tuple(reasons))
