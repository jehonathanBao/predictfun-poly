from __future__ import annotations

import argparse

from .config import load_config


def main() -> int:
    parser = argparse.ArgumentParser(description="predictfun safety checks")
    parser.add_argument("--check-config", required=True, help="Path to a JSON config file")
    args = parser.parse_args()

    config = load_config(args.check_config)
    mode = "dry-run" if config.dry_run else "live"
    print(
        "config ok: "
        f"mode={mode}, "
        f"predict_accounts={len(config.predict_accounts)}, "
        f"polymarket_account={config.polymarket_account.account_id}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
