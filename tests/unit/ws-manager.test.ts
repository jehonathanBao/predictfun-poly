import { describe, expect, it } from "vitest";
import { WebSocketManager, defaultWsManagerPolicy } from "../../src/ws/manager.js";
import { applyPrivateOrderEventToOrderRepo } from "../../src/ws/order-events.js";
import { d } from "../../src/core/decimal.js";
import { type OrderRecord, type OrderRepo } from "../../src/persistence/repositories/order-repo.js";

describe("WebSocketManager", () => {
  it("tracks subscriptions and reconnect backoff", () => {
    const manager = new WebSocketManager(defaultWsManagerPolicy);
    manager.subscribe("asset-1");
    manager.connect(0);
    manager.markConnected(0);
    manager.markDisconnected();
    manager.markDisconnected();

    const status = manager.status(1000);

    expect(status.subscriptions).toContain("asset-1");
    expect(status.state).toBe("RECONNECTING");
    expect(status.nextReconnectDelayMs).toBe(500);
  });

  it("deduplicates events and rejects stale sequence numbers", () => {
    const manager = new WebSocketManager(defaultWsManagerPolicy);
    expect(
      manager.acceptEvent({ channel: "book", key: "event-1", sequence: 2, timestampMs: 1000, payload: {} })
    ).toBe(true);
    expect(
      manager.acceptEvent({ channel: "book", key: "event-1", sequence: 3, timestampMs: 1001, payload: {} })
    ).toBe(false);
    expect(
      manager.acceptEvent({ channel: "book", key: "event-2", sequence: 1, timestampMs: 1002, payload: {} })
    ).toBe(false);
  });

  it("marks stale data and enables REST fallback polling", () => {
    const manager = new WebSocketManager(defaultWsManagerPolicy);
    manager.markConnected(0);
    manager.acceptEvent({ channel: "book", key: "event-1", timestampMs: 0, payload: {} });

    const status = manager.status(20_000);

    expect(status.stale).toBe(true);
    expect(status.fallbackRestPolling).toBe(true);
    expect(status.state).toBe("STALE");
  });

  it("recovers liveness after pong", () => {
    const manager = new WebSocketManager(defaultWsManagerPolicy);
    manager.markConnected(0);
    expect(manager.heartbeatDue(10_000)).toBe(true);
    manager.markPong(10_000);
    expect(manager.heartbeatDue(10_001)).toBe(false);
  });

  it("applies private user order events to order records", async () => {
    let order: OrderRecord = {
      id: "o1",
      hedgeId: "h1",
      venue: "POLYMARKET",
      accountRef: "poly",
      outcome: "NO",
      side: "BUY",
      orderType: "FOK",
      limitPrice: d("0.45"),
      requestedShares: d("10"),
      status: "live"
    };
    const repo: OrderRepo = {
      async createOrder() {
        return "o1";
      },
      async updateOrder(next) {
        order = next;
      },
      async findOpenOrders() {
        return [order];
      }
    };

    const result = await applyPrivateOrderEventToOrderRepo({
      orderRepo: repo,
      existingOrder: order,
      event: {
        event_type: "order",
        id: "poly-order-1",
        status: "matched",
        size: "10",
        price: "0.44"
      }
    });

    expect(result.applied).toBe(true);
    expect(order.externalOrderId).toBe("poly-order-1");
    expect(order.status).toBe("matched");
    expect(order.filledShares?.toFixed()).toBe("10");
  });
});
