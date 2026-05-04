import { cosineSimilarity } from "../cosine.js";
import { getDb } from "../db.js";
import { bufferToEmbedding, embeddingToBuffer } from "../embedding-codec.js";
import type { EmbeddingDriver } from "../embedding-driver.js";
import { logger } from "../../utils/logger.js";
import type { Fact } from "./facts.js";

const SELECT_COLUMNS_WITH_EMBEDDING = `
  id,
  category,
  content,
  source,
  created_at as createdAt,
  updated_at as updatedAt,
  embedding,
  embedding_model as embeddingModel
`;

interface FactRowWithEmbedding {
  id: number;
  category: string | null;
  content: string;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  embedding: Buffer | null;
  embeddingModel: string | null;
}

export interface FactWithScore extends Fact {
  similarity: number;
}

export interface SearchFactsByVectorOptions {
  limit?: number;
  category?: string;
  /** Drop candidates below this cosine score. Default 0. */
  minSimilarity?: number;
}

/**
 * Vector-ranked search. Prefetch a wide slice (limit*10, min 100) ordered
 * by recency, score in JS, sort, truncate. Mirrors openfang's design — no
 * ANN index, brute-force is fine while fact counts stay under tens of
 * thousands.
 */
export function searchFactsByVector(
  queryVec: Float32Array,
  options: SearchFactsByVectorOptions = {},
): FactWithScore[] {
  const limit = options.limit ?? 50;
  const minSim = options.minSimilarity ?? 0;
  const fetchLimit = Math.max(limit * 10, 100);
  const db = getDb();

  let sql = `
    SELECT ${SELECT_COLUMNS_WITH_EMBEDDING}
    FROM facts
    WHERE embedding IS NOT NULL
  `;
  const params: unknown[] = [];
  if (options.category) {
    sql += " AND category = ?";
    params.push(options.category);
  }
  sql += " ORDER BY updated_at DESC LIMIT ?";
  params.push(fetchLimit);

  const rows = db.prepare(sql).all(...params) as FactRowWithEmbedding[];

  const scored: FactWithScore[] = [];
  for (const row of rows) {
    if (!row.embedding) continue;
    const vec = bufferToEmbedding(row.embedding);
    const sim = cosineSimilarity(queryVec, vec);
    if (sim < minSim) continue;
    scored.push({
      id: row.id,
      category: row.category,
      content: row.content,
      source: row.source,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      similarity: sim,
    });
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

export function updateFactEmbedding(id: number, vec: Float32Array, model: string): void {
  const db = getDb();
  db.prepare("UPDATE facts SET embedding = ?, embedding_model = ? WHERE id = ?").run(
    embeddingToBuffer(vec),
    model,
    id,
  );
}

/**
 * Facts whose embedding is missing OR was produced by a different model.
 * Used by /memory_reembed to backfill or upgrade vectors.
 */
export function getFactsMissingEmbedding(currentModel: string, limit = 1000): Fact[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, category, content, source,
              created_at as createdAt, updated_at as updatedAt
       FROM facts
       WHERE embedding IS NULL
          OR embedding_model IS NULL
          OR embedding_model != ?
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(currentModel, limit) as Fact[];
}

export function countFactsMissingEmbedding(currentModel: string): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) as c FROM facts
       WHERE embedding IS NULL
          OR embedding_model IS NULL
          OR embedding_model != ?`,
    )
    .get(currentModel) as { c: number };
  return row.c;
}

/**
 * Embed a single fact and persist the result. Designed for fire-and-forget
 * use after `addFact()`: failures log a warning but never throw.
 */
export async function embedAndStore(
  driver: EmbeddingDriver,
  factId: number,
  content: string,
): Promise<void> {
  try {
    const vec = await driver.embedOne(content);
    updateFactEmbedding(factId, vec, driver.model);
  } catch (err) {
    logger.warn(
      `[Memory/FactsVector] Failed to embed fact id=${factId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
