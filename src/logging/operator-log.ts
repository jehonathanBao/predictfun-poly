import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type OperatorLogLevel = "debug" | "info" | "warn" | "error";

export interface OperatorLogRecord {
  ts: string;
  level: OperatorLogLevel;
  component: string;
  event: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface OperatorLogResponse {
  schemaVersion: 1;
  mode: "dry_run";
  readOnly: true;
  liveTradingEnabled: false;
  records: OperatorLogRecord[];
}

export interface OperatorLogFilter {
  level?: OperatorLogLevel;
  component?: string;
  limit?: number;
  filePath?: string;
}

export const DEFAULT_OPERATOR_LOG_PATH = "logs/operator-events.jsonl";

const LOG_LEVELS: readonly OperatorLogLevel[] = ["debug", "info", "warn", "error"];

export async function appendOperatorLog(
  input: Omit<OperatorLogRecord, "ts"> & { ts?: string },
  filePath = DEFAULT_OPERATOR_LOG_PATH,
): Promise<OperatorLogRecord> {
  const record: OperatorLogRecord = {
    ts: input.ts ?? new Date().toISOString(),
    level: normalizeLevel(input.level),
    component: safeString(input.component, "unknown"),
    event: safeString(input.event, "unknown"),
    message: safeString(input.message, ""),
    data: sanitizeData(input.data),
  };
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
  return record;
}

export async function readOperatorLogs(filter: OperatorLogFilter = {}): Promise<OperatorLogRecord[]> {
  const filePath = filter.filePath ?? DEFAULT_OPERATOR_LOG_PATH;
  const limit = clampLimit(filter.limit ?? 200);
  try {
    const raw = await readFile(filePath, "utf8");
    const records = raw
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .map((line) => sanitizeRecord(JSON.parse(line) as unknown))
      .filter((record): record is OperatorLogRecord => record !== undefined)
      .filter((record) => filter.level === undefined || record.level === filter.level)
      .filter((record) => filter.component === undefined || record.component === filter.component);
    return records.slice(-limit).reverse();
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
}

export async function buildOperatorLogResponse(filter: OperatorLogFilter = {}): Promise<OperatorLogResponse> {
  return {
    schemaVersion: 1,
    mode: "dry_run",
    readOnly: true,
    liveTradingEnabled: false,
    records: await readOperatorLogs(filter),
  };
}

export function sanitizeOperatorLogData(value: unknown): Record<string, unknown> | undefined {
  return sanitizeData(value);
}

export function maskToken(value: string): string {
  const normalized = value.trim();
  if (normalized === "") return "";
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

function sanitizeRecord(value: unknown): OperatorLogRecord | undefined {
  const record = asRecord(value);
  const ts = safeString(record.ts);
  const component = safeString(record.component);
  const event = safeString(record.event);
  if (!ts || !component || !event) return undefined;
  return {
    ts,
    level: normalizeLevel(record.level),
    component,
    event,
    message: safeString(record.message, ""),
    data: sanitizeData(record.data),
  };
}

function sanitizeData(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const sanitized = sanitizeValue(value, "");
  return isRecord(sanitized) ? sanitized : { value: sanitized };
}

function sanitizeValue(value: unknown, key: string): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return sanitizeString(value, key);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, key));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeValue(entryValue, entryKey),
      ]),
    );
  }
  return String(value);
}

function sanitizeString(value: string, key: string): string {
  const normalizedKey = key.toLowerCase();
  if (
    normalizedKey.includes("privatekey") ||
    normalizedKey.includes("private_key") ||
    normalizedKey.includes("mnemonic") ||
    normalizedKey.includes("secret") ||
    normalizedKey.includes("apikey") ||
    normalizedKey.includes("api_key") ||
    normalizedKey.includes("rawsigner") ||
    normalizedKey.includes("raw_signer") ||
    normalizedKey.includes("rawtoken") ||
    normalizedKey.includes("raw_token")
  ) {
    return "<redacted>";
  }
  if (normalizedKey.includes("tokenid") || normalizedKey.includes("token_id")) {
    return maskToken(value);
  }
  return redactUrl(value);
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "data:") return "data:<redacted>";
    if (url.search) url.search = "?...";
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function normalizeLevel(value: unknown): OperatorLogLevel {
  return LOG_LEVELS.includes(value as OperatorLogLevel) ? (value as OperatorLogLevel) : "info";
}

function clampLimit(value: number): number {
  return Math.min(500, Math.max(1, Math.floor(Number.isFinite(value) ? value : 200)));
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
