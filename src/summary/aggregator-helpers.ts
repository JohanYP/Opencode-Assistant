/**
 * Pure helpers used by the summary aggregator. Kept here so they can be
 * unit-tested without instantiating the aggregator and to keep
 * aggregator.ts focused on the SSE event state machine.
 */

/**
 * Reads a "git status"-style title and returns the first updated path.
 *
 * Lines start with a one-character status code (A/M/D/U/R/C), a single
 * space, and the path. Anything else is skipped.
 */
export function extractFirstUpdatedFileFromTitle(title: string): string {
  for (const rawLine of title.split("\n")) {
    const line = rawLine.trim();
    if (line.length >= 3 && line[1] === " " && /[AMDURC]/.test(line[0])) {
      return line.slice(2).trim();
    }
  }
  return "";
}

/**
 * Counts added and removed lines in a unified diff body. Hunk headers
 * (`+++` and `---`) are excluded.
 */
export function countDiffChangesFromText(text: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;

  for (const line of text.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions++;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      deletions++;
    }
  }

  return { additions, deletions };
}

/**
 * Recursively normalizes a value for stable JSON snapshotting:
 * object keys are sorted, arrays preserve order, primitives pass through.
 * Used to detect "no real change" between subagent state snapshots.
 */
export function normalizeSnapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSnapshotValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, normalizeSnapshotValue(entryValue)]),
    );
  }

  return value;
}
