export const POLYMARKET_CLOB_HEARTBEAT_INTERVAL_MS = 5_000;
export const POLYMARKET_CLOB_HEARTBEAT_TIMEOUT_MS = 15_000;

export interface PolymarketClobHeartbeatResponse {
  heartbeat_id: string;
}

export interface PolymarketClobHeartbeatClient {
  postHeartbeat(heartbeatId: string): Promise<PolymarketClobHeartbeatResponse>;
}

export function nextPolymarketHeartbeatId(response: PolymarketClobHeartbeatResponse): string {
  return response.heartbeat_id;
}
