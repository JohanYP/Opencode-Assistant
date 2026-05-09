// WhatsApp accepts very long text messages, but readability degrades past
// a few thousand chars and clients lazy-load very long messages anyway. We
// chunk at paragraph boundaries first, then sentences, then on whitespace,
// falling back to a hard split only when a single chunk has no break at
// all (e.g. a giant code block).

const DEFAULT_CHUNK_LIMIT = 3500;
const MIN_CHUNK_LIMIT = 200;

export interface ChunkOptions {
  limit?: number;
}

export function chunkForWhatsApp(text: string, options: ChunkOptions = {}): string[] {
  const limit = Math.max(options.limit ?? DEFAULT_CHUNK_LIMIT, MIN_CHUNK_LIMIT);
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= limit) return [trimmed];

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < trimmed.length) {
    if (trimmed.length - cursor <= limit) {
      chunks.push(trimmed.slice(cursor).trim());
      break;
    }

    const window = trimmed.slice(cursor, cursor + limit);

    // Prefer a paragraph break (\n\n), then a sentence end, then whitespace.
    // Last resort: hard split at the limit so we always make progress.
    const cutAt =
      lastIndexOfAny(window, ["\n\n"]) ??
      lastIndexOfAny(window, [". ", "? ", "! ", ".\n", "?\n", "!\n"]) ??
      lastIndexOfAny(window, ["\n", " "]) ??
      limit;

    const piece = trimmed.slice(cursor, cursor + cutAt).trim();
    if (piece.length > 0) chunks.push(piece);
    cursor += cutAt;
  }

  return chunks;
}

function lastIndexOfAny(text: string, needles: string[]): number | null {
  let best = -1;
  for (const needle of needles) {
    const idx = text.lastIndexOf(needle);
    if (idx > best) best = idx + needle.length;
  }
  return best > 0 ? best : null;
}
