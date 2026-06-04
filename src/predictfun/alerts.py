from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass(frozen=True)
class Alert:
    level: str
    message: str
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class AlertSink:
    def send(self, alert: Alert) -> None:
        raise NotImplementedError


@dataclass
class InMemoryAlertSink(AlertSink):
    alerts: list[Alert] = field(default_factory=list)

    def send(self, alert: Alert) -> None:
        self.alerts.append(alert)


class ConsoleAlertSink(AlertSink):
    def send(self, alert: Alert) -> None:
        print(f"[{alert.level}] {alert.message}")

