export interface Alert {
  level: "info" | "warning" | "error";
  message: string;
  createdAt: string;
  eventType?: string;
  reasonCode?: string;
  hedgeId?: string;
  orderId?: string;
  pauseReason?: string;
  raw?: Record<string, unknown>;
}

export interface AlertSink {
  send(alert: Alert): Promise<void>;
}

export class InMemoryAlertSink implements AlertSink {
  readonly alerts: Alert[] = [];

  async send(alert: Alert): Promise<void> {
    this.alerts.push(alert);
  }
}

export function alert(level: Alert["level"], message: string): Alert {
  return {
    level,
    message,
    createdAt: new Date().toISOString()
  };
}

export class WebhookAlertSink implements AlertSink {
  constructor(private readonly url: string, private readonly headers: Record<string, string> = {}) {}

  async send(alert: Alert): Promise<void> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.headers
      },
      body: JSON.stringify(alert)
    });
    if (!response.ok) {
      throw new Error(`webhook alert failed: ${response.status}`);
    }
  }
}

export class TelegramAlertSink implements AlertSink {
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
    private readonly apiBase = "https://api.telegram.org"
  ) {}

  async send(alert: Alert): Promise<void> {
    const response = await fetch(`${this.apiBase}/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: formatTelegramAlert(alert),
        disable_web_page_preview: true
      })
    });
    if (!response.ok) {
      throw new Error(`telegram alert failed: ${response.status}`);
    }
  }
}

function formatTelegramAlert(input: Alert): string {
  const fields = [
    `[${input.level.toUpperCase()}] ${input.message}`,
    input.eventType ? `event=${input.eventType}` : undefined,
    input.reasonCode ? `reason=${input.reasonCode}` : undefined,
    input.hedgeId ? `hedge_id=${input.hedgeId}` : undefined,
    input.orderId ? `order_id=${input.orderId}` : undefined,
    input.pauseReason ? `pause=${input.pauseReason}` : undefined
  ].filter((value): value is string => Boolean(value));
  return fields.join("\n");
}
