import { loadConfigFromFile } from "../config/load-config.js";
import { redactedConfigForLogs } from "../config/schema.js";

export type DoctorCheckStatus = "ok" | "failed" | "skipped";

export interface DoctorCheck {
  name: string;
  status: DoctorCheckStatus;
  message: string;
}

export interface DoctorCliReport {
  checks: readonly DoctorCheck[];
  liveReady: boolean;
  config: unknown;
}

export async function doctor(): Promise<DoctorCliReport> {
  const config = await loadConfigFromFile();
  const checks: DoctorCheck[] = [
    checkConfigured("DB connected", config.storage.postgresUrl, "DATABASE_URL is configured"),
    checkConfigured("Redis connected", config.storage.redisUrl, "REDIS_URL is configured"),
    checkConfigured("Predict API reachable", config.predict.apiKey, "PREDICT_API_KEY is configured"),
    { name: "Polymarket APIs reachable", status: "skipped", message: "requires live Polymarket adapter wiring" },
    { name: "geoblock status", status: config.polymarket.geoblock_check ? "skipped" : "failed", message: "requires geoblock adapter call" },
    { name: "account count", status: "skipped", message: `accounts file: ${config.accounts.predict_accounts_file}` },
    { name: "balances", status: "skipped", message: "requires venue balance adapters" },
    { name: "unresolved positions", status: "skipped", message: "requires Predict positions adapter" }
  ];
  return {
    checks,
    liveReady: config.enableLiveTrading && checks.every((check) => check.status === "ok" || check.status === "skipped"),
    config: redactedConfigForLogs(config)
  };
}

function checkConfigured(name: string, value: string | undefined, okMessage: string): DoctorCheck {
  return value && value.trim() !== ""
    ? { name, status: "ok", message: okMessage }
    : { name, status: "skipped", message: `${name} check needs configuration` };
}
