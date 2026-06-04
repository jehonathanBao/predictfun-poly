from __future__ import annotations

import json
import os
import urllib.request
from dataclasses import dataclass, field
from typing import Mapping


POLYMARKET_BLOCKED_COUNTRIES = frozenset(
    {
        "AU",
        "BE",
        "BY",
        "BI",
        "CF",
        "CD",
        "CU",
        "DE",
        "ET",
        "FR",
        "GB",
        "IR",
        "IQ",
        "IT",
        "KP",
        "LB",
        "LY",
        "MM",
        "NI",
        "NL",
        "RU",
        "SO",
        "SS",
        "SD",
        "SY",
        "UM",
        "US",
        "VE",
        "YE",
        "ZW",
    }
)
POLYMARKET_CLOSE_ONLY_COUNTRIES = frozenset({"PL", "SG", "TH", "TW"})
POLYMARKET_FRONTEND_UI_RESTRICTED = frozenset({"JP"})
POLYMARKET_BLOCKED_REGIONS = frozenset({("CA", "ON"), ("UA", "43"), ("UA", "14"), ("UA", "09")})
PROXY_ENV_NAMES = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy")


@dataclass(frozen=True)
class GeoblockStatus:
    blocked: bool
    country: str
    region: str = ""
    ip: str = ""
    raw: dict[str, object] = field(default_factory=dict)

    @classmethod
    def from_mapping(cls, data: Mapping[str, object]) -> "GeoblockStatus":
        return cls(
            blocked=bool(data.get("blocked", False)),
            country=str(data.get("country", "")).upper(),
            region=str(data.get("region", "")).upper(),
            ip=str(data.get("ip", "")),
            raw=dict(data),
        )


@dataclass(frozen=True)
class ComplianceConfig:
    reject_proxy_env: bool = True
    require_polymarket_geoblock_for_live: bool = True
    allow_frontend_ui_restricted_opening: bool = False


@dataclass(frozen=True)
class ComplianceResult:
    ok: bool
    reasons: tuple[str, ...]
    warnings: tuple[str, ...] = ()


def fetch_polymarket_geoblock(timeout_seconds: float = 5.0) -> GeoblockStatus:
    request = urllib.request.Request("https://polymarket.com/api/geoblock", headers={"User-Agent": "predictfun/0.1"})
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return GeoblockStatus.from_mapping(payload)


class ComplianceGate:
    def __init__(self, config: ComplianceConfig | None = None) -> None:
        self.config = config or ComplianceConfig()

    def evaluate_opening_trade(
        self,
        *,
        live_trading: bool,
        polymarket_geoblock: GeoblockStatus | None,
        environ: Mapping[str, str] | None = None,
    ) -> ComplianceResult:
        env = os.environ if environ is None else environ
        reasons: list[str] = []
        warnings: list[str] = []

        if self.config.reject_proxy_env:
            present = sorted(name for name in PROXY_ENV_NAMES if env.get(name))
            if present:
                reasons.append(f"proxy environment variables are set: {', '.join(present)}")

        if live_trading and self.config.require_polymarket_geoblock_for_live and polymarket_geoblock is None:
            reasons.append("live trading requires a fresh Polymarket geoblock check")

        if polymarket_geoblock is not None:
            country = polymarket_geoblock.country.upper()
            region = polymarket_geoblock.region.upper()
            if polymarket_geoblock.blocked:
                reasons.append(f"Polymarket geoblock reports blocked country/region: {country}/{region}")
            if country in POLYMARKET_BLOCKED_COUNTRIES:
                reasons.append(f"Polymarket country is blocked for opening trades: {country}")
            if country in POLYMARKET_CLOSE_ONLY_COUNTRIES:
                reasons.append(f"Polymarket country is close-only; this bot opens buy hedges: {country}")
            if (country, region) in POLYMARKET_BLOCKED_REGIONS:
                reasons.append(f"Polymarket region is blocked for opening trades: {country}/{region}")
            if country in POLYMARKET_FRONTEND_UI_RESTRICTED:
                message = f"Polymarket frontend UI restricted country requires manual compliance review: {country}"
                if self.config.allow_frontend_ui_restricted_opening:
                    warnings.append(message)
                else:
                    reasons.append(message)

        return ComplianceResult(ok=not reasons, reasons=tuple(reasons), warnings=tuple(warnings))

