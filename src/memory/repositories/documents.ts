import { getDb } from "../db.js";

/**
 * Reserved document names.
 * - `soul`, `agents`: assistant identity and agent-selection rules. They
 *   ship with the project and are mirrored to SQLite at startup from
 *   their .md files. Read-only at the MCP layer.
 * - `context`: current project context. Mutated by OpenCode through MCP.
 * - `session-summary`: cross-session continuity, MCP-writable.
 * - `personality`: user-editable behavior rules (how to address the user,
 *   tone, language, response style). Editable both via Telegram
 *   (/personality) and OpenCode MCP (memory_write).
 */
export type DocumentName =
  | "soul"
  | "agents"
  | "context"
  | "session-summary"
  | "personality";

export interface Document {
  name: DocumentName;
  content: string;
  updatedAt: string;
}

interface DocumentRow {
  name: DocumentName;
  content: string;
  updatedAt: string;
}

export function getDocument(name: DocumentName): Document | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT name, content, updated_at as updatedAt FROM documents WHERE name = ?",
    )
    .get(name) as DocumentRow | undefined;
  return row ?? null;
}

export function setDocument(name: DocumentName, content: string): Document {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO documents (name, content, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
  ).run(name, content, now);

  return { name, content, updatedAt: now };
}

export function listDocuments(): Document[] {
  const db = getDb();
  return db
    .prepare("SELECT name, content, updated_at as updatedAt FROM documents ORDER BY name")
    .all() as Document[];
}

export function deleteDocument(name: DocumentName): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM documents WHERE name = ?").run(name);
  return result.changes > 0;
}
