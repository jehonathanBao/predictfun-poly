import {
  buildOperatorLogResponse,
  type OperatorLogLevel,
} from "../logging/operator-log.js";

export async function loadOperatorLogsForDashboard(url: URL) {
  return buildOperatorLogResponse({
    limit: queryLimit(url),
    level: queryLevel(url),
    component: queryString(url, "component"),
    filePath: process.env.OPERATOR_LOG_PATH,
  });
}

function queryLimit(url: URL): number | undefined {
  const raw = url.searchParams.get("limit");
  if (raw === null || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function queryLevel(url: URL): OperatorLogLevel | undefined {
  const raw = url.searchParams.get("level");
  if (raw === null || raw.trim() === "") return undefined;
  return raw === "debug" || raw === "info" || raw === "warn" || raw === "error"
    ? raw
    : undefined;
}

function queryString(url: URL, key: string): string | undefined {
  const raw = url.searchParams.get(key);
  return raw === null || raw.trim() === "" ? undefined : raw.trim();
}
