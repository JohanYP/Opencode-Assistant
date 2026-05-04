/**
 * Cosine similarity for embedding vectors.
 *
 * Returns a value in [-1, 1] where 1 = identical direction, 0 = orthogonal,
 * -1 = opposite direction. Returns 0 when lengths differ or either vector
 * is empty so vectors with mismatched dimensions (e.g. after switching
 * embedding models) sort to the bottom of search results instead of throwing.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom < Number.EPSILON) {
    return 0;
  }
  return dot / denom;
}
