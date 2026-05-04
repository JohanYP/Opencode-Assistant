import { getDb } from "../db.js";

/**
 * Reserved document names. The `soul` and `agents` documents define the
 * assistant's identity and agent-selection rules; they are typically
 * read-only at runtime and should be edited deliberately. The `context`
 * and `session-summary` documents change frequently and are meant to be
 * mutated by OpenCode through MCP tools.
 */
export type DocumentName = "soul" | "agents" | "context" | "session-summary";

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
