import { getDb } from "../db.js";
import { getEmbeddingDriver } from "../embedding-driver.js";
import { embedAndStore } from "./facts-vector.js";

export interface Fact {
  id: number;
  category: string | null;
  content: string;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AddFactInput {
  category?: string | null;
  content: string;
  source?: string | null;
}

interface FactRow {
  id: number;
  category: string | null;
  content: string;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

const SELECT_COLUMNS = `
  id,
  category,
  content,
  source,
  created_at as createdAt,
  updated_at as updatedAt
`;

export function addFact(input: AddFactInput): Fact {
  const db = getDb();

  // Defensive de-duplication on the (content, category) tuple. Without
  // this, a model re-prompting for "what color do I like?" across
  // sessions could accumulate "me gusta el azul" entries indefinitely.
  // Same content with a different category is intentionally NOT a
  // duplicate — different categorization is a deliberate distinction.
  const trimmed = input.content.trim();
  if (trimmed) {
    const existing = (
      input.category == null
        ? (db
            .prepare(
              `SELECT ${SELECT_COLUMNS} FROM facts WHERE content = ? AND category IS NULL ORDER BY id DESC LIMIT 1`,
            )
            .get(trimmed) as FactRow | undefined)
        : (db
            .prepare(
              `SELECT ${SELECT_COLUMNS} FROM facts WHERE content = ? AND category = ? ORDER BY id DESC LIMIT 1`,
            )
            .get(trimmed, input.category) as FactRow | undefined)
    );

    if (existing) {
      return existing;
    }
  }

  const now = new Date().toISOString();
  const result = db
    .prepare(
      "INSERT INTO facts (category, content, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(input.category ?? null, input.content, input.source ?? null, now, now);

  const fact = getFactById(Number(result.lastInsertRowid));
  if (!fact) {
    throw new Error(`Failed to read back fact with id=${result.lastInsertRowid}`);
  }

  // Fire-and-forget background embed when a driver is configured. Swallows
  // its own errors (see embedAndStore) so a flaky provider can't make
  // fact_add fail. Re-run /memory_reembed to backfill anything missed.
  const driver = getEmbeddingDriver();
  if (driver) {
    void embedAndStore(driver, fact.id, fact.content);
  }

  return fact;
}

export function getFactById(id: number): Fact | null {
  const db = getDb();
  const row = db.prepare(`SELECT ${SELECT_COLUMNS} FROM facts WHERE id = ?`).get(id) as
    | FactRow
    | undefined;
  return row ?? null;
}

export interface SearchFactsOptions {
  category?: string;
  limit?: number;
}

export function searchFacts(query: string, options: SearchFactsOptions = {}): Fact[] {
  const db = getDb();
  const limit = options.limit ?? 50;
  const pattern = `%${query}%`;

  if (options.category) {
    return db
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM facts WHERE content LIKE ? AND category = ? ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(pattern, options.category, limit) as Fact[];
  }
  return db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM facts WHERE content LIKE ? ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(pattern, limit) as Fact[];
}

export function getRecentFacts(limit = 20): Fact[] {
  const db = getDb();
  return db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM facts ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as Fact[];
}

export function deleteFact(id: number): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM facts WHERE id = ?").run(id);
  return result.changes > 0;
}

export function countFacts(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as c FROM facts").get() as { c: number };
  return row.c;
}
