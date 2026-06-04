from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class AuditEvent:
    event_type: str
    message: str
    data: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class AuditSink:
    def record(self, event: AuditEvent) -> None:
        raise NotImplementedError


@dataclass
class InMemoryAuditSink(AuditSink):
    events: list[AuditEvent] = field(default_factory=list)

    def record(self, event: AuditEvent) -> None:
        self.events.append(event)


class SQLiteAuditSink(AuditSink):
    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        self._init()

    def _init(self) -> None:
        with sqlite3.connect(self.path) as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS audit_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    message TEXT NOT NULL,
                    data_json TEXT NOT NULL
                )
                """
            )

    def record(self, event: AuditEvent) -> None:
        payload = asdict(event)
        with sqlite3.connect(self.path) as connection:
            connection.execute(
                "INSERT INTO audit_events (created_at, event_type, message, data_json) VALUES (?, ?, ?, ?)",
                (
                    event.created_at,
                    event.event_type,
                    event.message,
                    json.dumps(payload["data"], sort_keys=True, default=str),
                ),
            )

