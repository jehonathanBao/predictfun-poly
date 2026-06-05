import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";

export type PaperLiveFixtureScenario =
  | "valid"
  | "empty"
  | "malformed"
  | "stale"
  | "wide_spread"
  | "shallow_depth";

export const PAPER_LIVE_FIXTURE_SCENARIOS: readonly PaperLiveFixtureScenario[] = [
  "valid",
  "empty",
  "malformed",
  "stale",
  "wide_spread",
  "shallow_depth",
];

export interface PaperLiveFixtureResponse {
  status: number;
  body: string;
  contentType: string;
}

export interface PaperLiveFixtureServer {
  server: Server;
  url: string;
  close: () => Promise<void>;
}

export function isPaperLiveFixtureScenario(value: string | undefined): value is PaperLiveFixtureScenario {
  return PAPER_LIVE_FIXTURE_SCENARIOS.includes(value as PaperLiveFixtureScenario);
}

export function paperLiveFixtureResponse(
  scenario: PaperLiveFixtureScenario,
  nowMs = Date.now(),
): PaperLiveFixtureResponse {
  if (scenario === "malformed") {
    return {
      status: 200,
      body: "{not-json",
      contentType: "application/json",
    };
  }

  return {
    status: 200,
    body: JSON.stringify(paperLiveFixtureOrderBook(scenario, nowMs)),
    contentType: "application/json",
  };
}

export function paperLiveFixtureOrderBook(
  scenario: Exclude<PaperLiveFixtureScenario, "malformed">,
  nowMs = Date.now(),
): Record<string, unknown> {
  if (scenario === "empty") {
    return {
      timestampMs: nowMs,
      bids: [],
      asks: [],
    };
  }

  if (scenario === "stale") {
    return {
      timestampMs: Date.parse("2020-01-01T00:00:00.000Z"),
      bids: [{ price: "0.48", size: "100" }],
      asks: [{ price: "0.52", size: "100" }],
    };
  }

  if (scenario === "wide_spread") {
    return {
      timestampMs: nowMs,
      bids: [{ price: "0.20", size: "100" }],
      asks: [{ price: "0.82", size: "100" }],
    };
  }

  if (scenario === "shallow_depth") {
    return {
      timestampMs: nowMs,
      bids: [{ price: "0.48", size: "2" }],
      asks: [{ price: "0.52", size: "2" }],
    };
  }

  return {
    timestampMs: nowMs,
    market: "fixture-paper-live",
    asset_id: "fixture-token-id",
    bids: [
      { price: "0.48", size: "100" },
      { price: "0.47", size: "50" },
    ],
    asks: [
      { price: "0.52", size: "90" },
      { price: "0.53", size: "40" },
    ],
  };
}

export async function createPaperLiveFixtureServer(
  options: {
    scenario?: PaperLiveFixtureScenario;
    host?: string;
    port?: number;
    nowMs?: number;
  } = {},
): Promise<PaperLiveFixtureServer> {
  const scenario = options.scenario ?? "valid";
  const host = options.host ?? "127.0.0.1";
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, readOnly: true }));
      return;
    }

    if (url.pathname !== "/book") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    const requestedScenario = url.searchParams.get("scenario") ?? scenario;
    const selectedScenario = isPaperLiveFixtureScenario(requestedScenario)
      ? requestedScenario
      : scenario;
    const fixture = paperLiveFixtureResponse(selectedScenario, options.nowMs ?? Date.now());
    response.writeHead(fixture.status, { "content-type": fixture.contentType });
    response.end(fixture.body);
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, host, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("paper-live fixture server did not bind to a TCP port");
  }

  return {
    server,
    url: `http://${host}:${address.port}/book?scenario=${scenario}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isMainModule()) {
  const scenario = isPaperLiveFixtureScenario(process.env.PAPER_FIXTURE_SCENARIO)
    ? process.env.PAPER_FIXTURE_SCENARIO
    : "valid";
  const port = Number(process.env.PAPER_FIXTURE_PORT ?? 3090);
  const fixture = await createPaperLiveFixtureServer({ scenario, port });
  console.log(JSON.stringify({
    level: "info",
    server: "paper_live_fixture",
    readOnly: true,
    scenario,
    url: fixture.url,
  }));
}
