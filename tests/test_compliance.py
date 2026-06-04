from __future__ import annotations

import unittest

from predictfun.compliance import ComplianceGate, GeoblockStatus


class ComplianceTests(unittest.TestCase):
    def test_blocks_polymarket_us_opening_trade(self) -> None:
        result = ComplianceGate().evaluate_opening_trade(
            live_trading=True,
            polymarket_geoblock=GeoblockStatus(blocked=True, country="US", region="NY"),
            environ={},
        )

        self.assertFalse(result.ok)
        self.assertTrue(any("US" in reason for reason in result.reasons))

    def test_blocks_proxy_environment(self) -> None:
        result = ComplianceGate().evaluate_opening_trade(
            live_trading=False,
            polymarket_geoblock=None,
            environ={"HTTPS_PROXY": "http://127.0.0.1:8080"},
        )

        self.assertFalse(result.ok)
        self.assertIn("proxy environment variables are set: HTTPS_PROXY", result.reasons)

    def test_blocks_frontend_ui_restricted_by_default(self) -> None:
        result = ComplianceGate().evaluate_opening_trade(
            live_trading=True,
            polymarket_geoblock=GeoblockStatus(blocked=False, country="JP"),
            environ={},
        )

        self.assertFalse(result.ok)
        self.assertTrue(any("manual compliance review" in reason for reason in result.reasons))


if __name__ == "__main__":
    unittest.main()

