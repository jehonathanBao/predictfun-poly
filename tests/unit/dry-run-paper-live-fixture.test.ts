import { afterEach, describe, expect, it } from "vitest";
import {
  createPaperLiveFixtureServer,
  isPaperLiveFixtureScenario,
  paperLiveFixtureOrderBook,
  paperLiveFixtureResponse,
  type PaperLiveFixtureServer,
} from "../../src/workers/dry-run-paper-live-fixture.js";

let fixtureServer: PaperLiveFixtureServer | undefined;

afterEach(async () => {
  await fixtureServer?.close();
  fixtureServer = undefined;
});

describe("paper-live orderbook fixture", () => {
  it("serves a valid read-only orderbook over local HTTP", async () => {
    fixtureServer = await createPaperLiveFixtureServer({
      scenario: "valid",
      nowMs: Date.parse("2026-06-05T00:00:00.000Z"),
    });

    const response = await fetch(fixtureServer.url);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      timestampMs: Date.parse("2026-06-05T00:00:00.000Z"),
      bids: [
        { price: "0.48", size: "100" },
        { price: "0.47", size: "50" },
      ],
      asks: [
        { price: "0.52", size: "90" },
        { price: "0.53", size: "40" },
      ],
    });
  });

  it("can switch scenarios through the query string", async () => {
    fixtureServer = await createPaperLiveFixtureServer({ scenario: "valid" });

    const url = new URL(fixtureServer.url);
    url.searchParams.set("scenario", "wide_spread");
    const response = await fetch(url);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      bids: [{ price: "0.20", size: "100" }],
      asks: [{ price: "0.82", size: "100" }],
    });
  });

  it("returns malformed JSON for malformed scenarios", () => {
    expect(paperLiveFixtureResponse("malformed")).toMatchObject({
      status: 200,
      body: "{not-json",
      contentType: "application/json",
    });
  });

  it("covers valid and warning scenario payload shapes", () => {
    expect(paperLiveFixtureOrderBook("empty")).toMatchObject({ bids: [], asks: [] });
    expect(paperLiveFixtureOrderBook("stale").timestampMs).toBe(Date.parse("2020-01-01T00:00:00.000Z"));
    expect(paperLiveFixtureOrderBook("shallow_depth")).toMatchObject({
      bids: [{ price: "0.48", size: "2" }],
      asks: [{ price: "0.52", size: "2" }],
    });
  });

  it("validates fixture scenario names", () => {
    expect(isPaperLiveFixtureScenario("valid")).toBe(true);
    expect(isPaperLiveFixtureScenario("wide_spread")).toBe(true);
    expect(isPaperLiveFixtureScenario("live")).toBe(false);
  });
});
