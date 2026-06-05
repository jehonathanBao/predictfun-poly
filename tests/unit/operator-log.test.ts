import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendOperatorLog,
  buildOperatorLogResponse,
  readOperatorLogs,
  sanitizeOperatorLogData,
} from "../../src/logging/operator-log.js";

let tempDir: string;
let logPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "operator-log-"));
  logPath = join(tempDir, "operator-events.jsonl");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("operator log", () => {
  it("appends, reads, filters, and returns newest records first", async () => {
    await appendOperatorLog({
      ts: "2026-06-05T00:00:00.000Z",
      level: "info",
      component: "dry-run-worker",
      event: "paper_live_started",
      message: "started",
    }, logPath);
    await appendOperatorLog({
      ts: "2026-06-05T00:00:01.000Z",
      level: "warn",
      component: "market-data",
      event: "market_data_config_missing",
      message: "missing",
    }, logPath);

    const all = await readOperatorLogs({ filePath: logPath, limit: 10 });
    const marketWarnings = await readOperatorLogs({ filePath: logPath, level: "warn", component: "market-data" });
    const response = await buildOperatorLogResponse({ filePath: logPath, limit: 1 });

    expect(all.map((record) => record.event)).toEqual(["market_data_config_missing", "paper_live_started"]);
    expect(marketWarnings).toHaveLength(1);
    expect(marketWarnings[0]?.event).toBe("market_data_config_missing");
    expect(response).toMatchObject({
      schemaVersion: 1,
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      records: [{ event: "market_data_config_missing" }],
    });
  });

  it("redacts secrets, raw tokens, and URL query strings", async () => {
    await appendOperatorLog({
      level: "info",
      component: "market-data",
      event: "market_data_fetch_succeeded",
      message: "ok",
      data: {
        tokenId: "1234567890abcdef",
        rawToken: "raw-token-value",
        privateKey: "key-value",
        nested: {
          apiSecret: "api-secret-value",
          url: "https://example.test/book?key=do-not-return",
        },
      },
    }, logPath);

    const records = await readOperatorLogs({ filePath: logPath });
    const serialized = JSON.stringify(records);

    expect(serialized).toContain("123456...cdef");
    expect(serialized).toContain("https://example.test/book?...");
    expect(serialized).not.toContain("1234567890abcdef");
    expect(serialized).not.toContain("raw-token-value");
    expect(serialized).not.toContain("key-value");
    expect(serialized).not.toContain("api-secret-value");
    expect(serialized).not.toContain("do-not-return");
  });

  it("returns an empty read-only response when the file is absent", async () => {
    await expect(buildOperatorLogResponse({ filePath: join(tempDir, "missing.jsonl") })).resolves.toMatchObject({
      mode: "dry_run",
      readOnly: true,
      liveTradingEnabled: false,
      records: [],
    });
  });

  it("sanitizes non-object data into a value wrapper", () => {
    expect(sanitizeOperatorLogData("https://example.test/path?token=hidden")).toEqual({
      value: "https://example.test/path?...",
    });
  });
});
