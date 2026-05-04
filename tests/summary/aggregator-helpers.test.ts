import { describe, expect, it } from "vitest";
import {
  countDiffChangesFromText,
  extractFirstUpdatedFileFromTitle,
  normalizeSnapshotValue,
} from "../../src/summary/aggregator-helpers.js";

describe("summary/aggregator-helpers", () => {
  describe("extractFirstUpdatedFileFromTitle", () => {
    it("returns the first path on a status-prefixed line", () => {
      const title = "M src/foo.ts\nA src/bar.ts";
      expect(extractFirstUpdatedFileFromTitle(title)).toBe("src/foo.ts");
    });

    it("recognizes all of A, M, D, U, R, C status codes", () => {
      for (const code of ["A", "M", "D", "U", "R", "C"]) {
        expect(extractFirstUpdatedFileFromTitle(`${code} path/to/file.ts`)).toBe("path/to/file.ts");
      }
    });

    it("skips lines that don't start with a status code + space", () => {
      const title = "Header line\nM src/found.ts\nX src/skipped.ts";
      expect(extractFirstUpdatedFileFromTitle(title)).toBe("src/found.ts");
    });

    it("returns empty string when no line matches", () => {
      expect(extractFirstUpdatedFileFromTitle("")).toBe("");
      expect(extractFirstUpdatedFileFromTitle("just a header")).toBe("");
      expect(extractFirstUpdatedFileFromTitle("XX no.ts")).toBe("");
    });

    it("trims surrounding whitespace from lines and paths", () => {
      const title = "  M   src/with-spaces.ts  ";
      expect(extractFirstUpdatedFileFromTitle(title)).toBe("src/with-spaces.ts");
    });
  });

  describe("countDiffChangesFromText", () => {
    it("counts additions and deletions ignoring hunk headers", () => {
      const diff = [
        "--- a/foo.ts",
        "+++ b/foo.ts",
        "@@ -1,3 +1,3 @@",
        "-old line",
        "+new line",
        " unchanged",
        "+another addition",
      ].join("\n");

      expect(countDiffChangesFromText(diff)).toEqual({ additions: 2, deletions: 1 });
    });

    it("returns zeros for empty or non-diff text", () => {
      expect(countDiffChangesFromText("")).toEqual({ additions: 0, deletions: 0 });
      expect(countDiffChangesFromText("plain text\nno diff\nat all")).toEqual({
        additions: 0,
        deletions: 0,
      });
    });

    it("ignores triple-prefixed lines exactly", () => {
      const diff = "+++ a\n--- b\n+real add\n-real del";
      expect(countDiffChangesFromText(diff)).toEqual({ additions: 1, deletions: 1 });
    });
  });

  describe("normalizeSnapshotValue", () => {
    it("returns primitives unchanged", () => {
      expect(normalizeSnapshotValue(42)).toBe(42);
      expect(normalizeSnapshotValue("hi")).toBe("hi");
      expect(normalizeSnapshotValue(null)).toBe(null);
      expect(normalizeSnapshotValue(true)).toBe(true);
      expect(normalizeSnapshotValue(undefined)).toBe(undefined);
    });

    it("preserves array order while normalizing each element", () => {
      const input = [{ b: 2, a: 1 }, { d: 4, c: 3 }];
      const result = normalizeSnapshotValue(input);
      expect(JSON.stringify(result)).toBe('[{"a":1,"b":2},{"c":3,"d":4}]');
    });

    it("sorts object keys alphabetically", () => {
      const input = { z: 1, a: 2, m: 3 };
      expect(JSON.stringify(normalizeSnapshotValue(input))).toBe('{"a":2,"m":3,"z":1}');
    });

    it("normalizes nested objects and arrays recursively", () => {
      const input = {
        beta: [{ y: 1, x: 2 }, "literal"],
        alpha: { gamma: { z: 9, a: 0 } },
      };
      const result = normalizeSnapshotValue(input);
      expect(JSON.stringify(result)).toBe(
        '{"alpha":{"gamma":{"a":0,"z":9}},"beta":[{"x":2,"y":1},"literal"]}',
      );
    });

    it("produces equal snapshots for objects with same content but different key order", () => {
      const a = { foo: { x: 1, y: 2 }, bar: [1, 2] };
      const b = { bar: [1, 2], foo: { y: 2, x: 1 } };
      expect(JSON.stringify(normalizeSnapshotValue(a))).toBe(
        JSON.stringify(normalizeSnapshotValue(b)),
      );
    });
  });
});
