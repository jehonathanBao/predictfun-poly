import { pathToFileURL } from "node:url";
import {
  appendHedgePlanHistory,
  DEFAULT_HISTORY_HEDGE_PLANS_PATH,
  DEFAULT_LATEST_HEDGE_PLANS_PATH,
  writeLatestHedgePlans,
  type SanitizedHedgePlanRecord,
  type StoredHedgePlanRecord,
} from "../storage/hedge-plan-store.js";

export interface DryRunHedgeWorkerOptions {
  intervalMs: number;
  once: boolean;
  latestPath: string;
  historyPath: string;
}

export const DEFAULT_DRY_RUN_WORKER_INTERVAL_MS = 5_000;

export function buildEmptyDryRunHedgePayload(now = new Date()): StoredHedgePlanRecord {
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    source: "dry_run_worker",
    mode: "dry_run",
    readOnly: true,
    liveTradingEnabled: false,
    plans: [],
  };
}

export async function writeDryRunHedgeSnapshot(options: {
  latestPath?: string;
  historyPath?: string;
  now?: Date;
} = {}): Promise<SanitizedHedgePlanRecord> {
  const payload = buildEmptyDryRunHedgePayload(options.now);
  const latestPath = options.latestPath ?? DEFAULT_LATEST_HEDGE_PLANS_PATH;
  const historyPath = options.historyPath ?? DEFAULT_HISTORY_HEDGE_PLANS_PATH;
  const written = await writeLatestHedgePlans(payload, latestPath);
  await appendHedgePlanHistory(payload, historyPath);
  return written;
}

export async function runDryRunHedgeWorker(options: Partial<DryRunHedgeWorkerOptions> = {}): Promise<void> {
  const resolved = resolveDryRunHedgeWorkerOptions(options);
  let stopped = false;

  const stop = (): void => {
    stopped = true;
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    do {
      const written = await writeDryRunHedgeSnapshot({
        latestPath: resolved.latestPath,
        historyPath: resolved.historyPath,
      });
      console.log(
        JSON.stringify({
          level: "info",
          worker: "dry_run_hedge_worker",
          generatedAt: written.generatedAt,
          latestPath: resolved.latestPath,
          historyPath: resolved.historyPath,
          mode: written.mode,
          readOnly: written.readOnly,
          liveTradingEnabled: written.liveTradingEnabled,
          totalPlans: written.summary.totalPlans,
        }),
      );

      if (resolved.once) return;
      await delay(resolved.intervalMs);
    } while (!stopped);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

export function parseDryRunHedgeWorkerOptions(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): DryRunHedgeWorkerOptions {
  const args = new Map<string, string | true>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined || !arg.startsWith("--")) continue;
    const equalsIndex = arg.indexOf("=");
    if (equalsIndex >= 0) {
      args.set(arg.slice(0, equalsIndex), arg.slice(equalsIndex + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args.set(arg, next);
      index += 1;
    } else {
      args.set(arg, true);
    }
  }

  return resolveDryRunHedgeWorkerOptions({
    intervalMs: numberOption(args.get("--interval-ms"), env.DRY_RUN_WORKER_INTERVAL_MS, DEFAULT_DRY_RUN_WORKER_INTERVAL_MS),
    once: boolOption(args.get("--once"), env.DRY_RUN_WORKER_ONESHOT, false),
    latestPath: stringOption(args.get("--latest-path"), env.HEDGE_DASHBOARD_LATEST_PATH, DEFAULT_LATEST_HEDGE_PLANS_PATH),
    historyPath: stringOption(args.get("--history-path"), env.HEDGE_DASHBOARD_HISTORY_PATH, DEFAULT_HISTORY_HEDGE_PLANS_PATH),
  });
}

function resolveDryRunHedgeWorkerOptions(options: Partial<DryRunHedgeWorkerOptions>): DryRunHedgeWorkerOptions {
  return {
    intervalMs: Number.isFinite(options.intervalMs) && Number(options.intervalMs) > 0
      ? Math.floor(Number(options.intervalMs))
      : DEFAULT_DRY_RUN_WORKER_INTERVAL_MS,
    once: options.once ?? false,
    latestPath: options.latestPath ?? DEFAULT_LATEST_HEDGE_PLANS_PATH,
    historyPath: options.historyPath ?? DEFAULT_HISTORY_HEDGE_PLANS_PATH,
  };
}

function boolOption(cliValue: string | true | undefined, envValue: string | undefined, fallback: boolean): boolean {
  if (cliValue === true) return true;
  if (typeof cliValue === "string") return parseBool(cliValue, fallback);
  return parseBool(envValue, fallback);
}

function numberOption(
  cliValue: string | true | undefined,
  envValue: string | undefined,
  fallback: number,
): number {
  if (typeof cliValue === "string") return numberValue(cliValue, fallback);
  return numberValue(envValue, fallback);
}

function stringOption(
  cliValue: string | true | undefined,
  envValue: string | undefined,
  fallback: string,
): string {
  if (typeof cliValue === "string" && cliValue.trim() !== "") return cliValue.trim();
  if (envValue !== undefined && envValue.trim() !== "") return envValue.trim();
  return fallback;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function numberValue(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isMainModule()) {
  await runDryRunHedgeWorker(parseDryRunHedgeWorkerOptions());
}
