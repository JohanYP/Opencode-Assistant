import { describe, expect, it } from "vitest";
import { chunkForWhatsApp } from "../../../src/whatsapp/utils/chunking.js";

describe("chunkForWhatsApp", () => {
  it("returns an empty array for empty input", () => {
    expect(chunkForWhatsApp("")).toEqual([]);
    expect(chunkForWhatsApp("   ")).toEqual([]);
  });

  it("returns a single chunk for short text", () => {
    expect(chunkForWhatsApp("hello")).toEqual(["hello"]);
  });

  it("splits at paragraph boundaries when possible", () => {
    const para = "a".repeat(150);
    const text = `${para}\n\n${para}\n\n${para}`;
    const chunks = chunkForWhatsApp(text, { limit: 200 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(220));
  });

  it("falls back to sentence boundaries when no paragraphs fit", () => {
    const sentence = "This is a complete thought. ".repeat(20);
    const chunks = chunkForWhatsApp(sentence, { limit: 200 });
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should end with sentence punctuation when split at a boundary
    chunks.slice(0, -1).forEach((c) => {
      expect([".", "!", "?"]).toContain(c[c.length - 1]);
    });
  });

  it("falls back to whitespace splits when there is no punctuation", () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkForWhatsApp(words, { limit: 300 });
    expect(chunks.length).toBeGreaterThan(1);
    // Allow a small overshoot for the trailing whitespace token of the cut.
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(320));
  });

  it("hard-splits when no break exists in the window", () => {
    const giant = "x".repeat(2000);
    const chunks = chunkForWhatsApp(giant, { limit: 500 });
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(500));
    expect(chunks.join("").length).toBe(2000);
  });

  it("clamps absurdly small limits to a sane minimum", () => {
    // Asking for limit=10 shouldn't produce 1-char chunks; the helper
    // applies a floor so the output stays usable.
    const chunks = chunkForWhatsApp("a ".repeat(500).trim(), { limit: 10 });
    chunks.forEach((c) => expect(c.length).toBeGreaterThan(10));
  });
});
