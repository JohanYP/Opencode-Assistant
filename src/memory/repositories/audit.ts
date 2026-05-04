import { getDb } from "../db.js";

export type AuditEvent =
  | "skill_installed"
  | "skill_updated"
  | "skill_removed"
  | "skill_integrity_failed"
  | "fact_added"
  | "fact_deleted"
  | "memory_imported"
  | "memory_exported"
  | "document_updated";

export interface AuditEntry {
  id: number;
  ts: string;
  event: AuditEvent | string;
  payload: unknown;
}

interface AuditRow {
  id: number;
  ts: string;
  event: string;
  payload: string;
}

export function appendAudit(event: AuditEvent | string, payload: unknown): AuditEntry {
  const db = getDb();
  const ts = new Date().toISOString();
  const payloadJson = JSON.stringify(payload ?? {});
  const result = db
    .prepare("INSERT INTO audit_log (ts, event, payload) VALUES (?, ?, ?)")
    .run(ts, event, payloadJson);

  return {
    id: Number(result.lastInsertRowid),
    ts,
    event,
    payload,
  };
}

export interface AuditQueryOptions {
  event?: AuditEvent | string;
  limit?: number;
}

export function getAudit(options: AuditQueryOptions = {}): AuditEntry[] {
  const db = getDb();
  const limit = options.limit ?? 50;

  const rows = options.event
    ? (db
        .prepare(
          "SELECT id, ts, event, payload FROM audit_log WHERE event = ? ORDER BY ts DESC LIMIT ?",
        )
        .all(options.event, limit) as AuditRow[])
    : (db
        .prepare("SELECT id, ts, event, payload FROM audit_log ORDER BY ts DESC LIMIT ?")
        .all(limit) as AuditRow[]);

  return rows.map((row) => ({
    id: row.id,
    ts: row.ts,
    event: row.event,
    payload: safeParseJson(row.payload),
  }));
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
