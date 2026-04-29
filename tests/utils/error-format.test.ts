import { describe, expect, it } from "vitest";
import { formatErrorDetails } from "../../src/utils/error-format.js";

describe("utils/error-format", () => {
  it("formats Error instances using stack or message", () => {
    const error = new Error("boom");
    const details = formatErrorDetails(error);

    expect(details).toContain("boom");
  });

  it("returns fallback text for empty object-like errors", () => {
    expect(formatErrorDetails({})).toBe("unknown error");
  });

  it("clips very long error details", () => {
    const details = formatErrorDetails("x".repeat(100), 16);

    expect(details).toHaveLength(16);
    expect(details.endsWith("...")).toBe(true);
  });
});
