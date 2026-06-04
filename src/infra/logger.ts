import pino from "pino";
import { PINO_SECRET_REDACT_PATHS, REDACTED_SECRET } from "../config/secrets.js";

export function createLogger(level = "info") {
  return pino({
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: PINO_SECRET_REDACT_PATHS,
      censor: REDACTED_SECRET
    }
  });
}
