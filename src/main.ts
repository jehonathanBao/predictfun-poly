import { loadConfigFromFile } from "./config/load-config.js";
import { createLogger } from "./monitoring/logger.js";

const config = await loadConfigFromFile();
const logger = createLogger(process.env.LOG_LEVEL ?? "info");

logger.info(
  {
    dryRun: config.dryRun,
    liveTrading: config.enableLiveTrading,
    mode: config.mode,
    asset: config.market.asset,
    strategyMode: config.strategy.strategyMode,
    hedgeEnabled: config.strategy.hedgeEnabled
  },
  "btc-predict-polymarket-hedger booted"
);
