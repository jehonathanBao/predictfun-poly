from __future__ import annotations

import time
from dataclasses import dataclass


@dataclass
class TokenBucketRateLimiter:
    capacity: int
    refill_per_second: float
    tokens: float | None = None
    updated_at: float | None = None

    @classmethod
    def per_minute(cls, requests_per_minute: int) -> "TokenBucketRateLimiter":
        if requests_per_minute <= 0:
            raise ValueError("requests_per_minute must be positive")
        return cls(capacity=requests_per_minute, refill_per_second=requests_per_minute / 60)

    def _refill(self, now: float) -> None:
        if self.tokens is None:
            self.tokens = float(self.capacity)
            self.updated_at = now
            return
        assert self.updated_at is not None
        elapsed = max(0.0, now - self.updated_at)
        self.tokens = min(float(self.capacity), self.tokens + elapsed * self.refill_per_second)
        self.updated_at = now

    def try_acquire(self, amount: int = 1, now: float | None = None) -> bool:
        if amount <= 0:
            raise ValueError("amount must be positive")
        current = time.monotonic() if now is None else now
        self._refill(current)
        assert self.tokens is not None
        if self.tokens >= amount:
            self.tokens -= amount
            return True
        return False

    def seconds_until_available(self, amount: int = 1, now: float | None = None) -> float:
        current = time.monotonic() if now is None else now
        self._refill(current)
        assert self.tokens is not None
        if self.tokens >= amount:
            return 0.0
        return (amount - self.tokens) / self.refill_per_second

