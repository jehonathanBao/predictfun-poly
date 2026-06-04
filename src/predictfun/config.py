from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from .accounts import PolymarketAccountState, PredictAccountState
from .execution import ExecutionPolicy
from .risk import RiskConfig


@dataclass(frozen=True)
class AppConfig:
    dry_run: bool
    enable_live_trading: bool
    risk: RiskConfig
    execution: ExecutionPolicy
    predict_accounts: tuple[PredictAccountState, ...]
    polymarket_account: PolymarketAccountState


def _bool(value: object, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def load_config(path: str | Path, environ: Mapping[str, str] | None = None) -> AppConfig:
    env = os.environ if environ is None else environ
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    risk_data: dict[str, Any] = {**data.get("risk", {}), **data.get("profits", {})}
    execution_data: dict[str, Any] = data.get("execution", {})

    live_env = env.get("PREDICTFUN_ENABLE_LIVE_TRADING")
    enable_live = _bool(live_env, _bool(data.get("enable_live_trading"), False))
    dry_run = _bool(data.get("dry_run"), True)
    if enable_live:
        dry_run = False

    max_trade_fraction = risk_data.get("predict_max_trade_fraction", "0.30")
    accounts = tuple(
        PredictAccountState(
            account_id=str(item["account_id"]),
            address=str(item["address"]),
            available_balance=str(item.get("available_balance_usdt", "0")),
            max_trade_fraction=str(item.get("max_trade_fraction", max_trade_fraction)),
        )
        for item in data.get("predict_accounts", [])
    )
    if not accounts:
        raise ValueError("config requires at least one Predict account")
    if len(accounts) > 10:
        raise ValueError("config supports at most 10 Predict accounts")

    polymarket = data.get("polymarket", {})
    poly_account = PolymarketAccountState(
        account_id=str(polymarket.get("account_id", "poly-main")),
        address=str(polymarket.get("address", "")),
        available_balance=str(polymarket.get("available_balance_usdc", "0")),
    )

    return AppConfig(
        dry_run=dry_run,
        enable_live_trading=enable_live,
        risk=RiskConfig(**risk_data),
        execution=ExecutionPolicy(**execution_data),
        predict_accounts=accounts,
        polymarket_account=poly_account,
    )
