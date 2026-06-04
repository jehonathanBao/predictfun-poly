export interface AuditEvent {
  eventType: string;
  message: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}

export class InMemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
}

export function auditEvent(eventType: string, message: string, data?: Record<string, unknown>): AuditEvent {
  return {
    eventType,
    message,
    data,
    createdAt: new Date().toISOString()
  };
}

