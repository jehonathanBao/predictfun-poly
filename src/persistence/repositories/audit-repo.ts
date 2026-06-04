export interface AuditEventRecord {
  id?: string;
  eventType: string;
  severity: string;
  entityType?: string;
  entityId?: string;
  message: string;
  rawJson?: Record<string, unknown>;
}

export interface AuditRepo {
  record(event: AuditEventRecord): Promise<void>;
}
