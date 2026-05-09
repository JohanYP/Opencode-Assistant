import { describe, expect, it } from "vitest";
import { formatNumberedMenu, parseNumberedReply } from "../../../src/whatsapp/ui/menu.js";

describe("formatNumberedMenu", () => {
  it("renders title, body, options and hint in order", () => {
    const out = formatNumberedMenu({
      title: "Permission",
      body: "Tool: bash",
      options: ["Allow once", "Always", "Reject"],
      hint: "Reply 1, 2 or 3",
    });

    expect(out).toContain("*Permission*");
    expect(out).toContain("Tool: bash");
    expect(out).toContain("1️⃣ Allow once");
    expect(out).toContain("2️⃣ Always");
    expect(out).toContain("3️⃣ Reject");
    expect(out).toContain("_Reply 1, 2 or 3_");
  });

  it("falls back to plain numbers past 10 options", () => {
    const out = formatNumberedMenu({
      options: Array.from({ length: 12 }, (_, i) => `Item ${i + 1}`),
    });
    expect(out).toContain("🔟 Item 10");
    expect(out).toContain("11. Item 11");
    expect(out).toContain("12. Item 12");
  });
});

describe("parseNumberedReply", () => {
  it("parses bare digits", () => {
    expect(parseNumberedReply("3", 5)).toBe(3);
  });

  it("parses digits in a sentence", () => {
    expect(parseNumberedReply("la opción 2 por favor", 5)).toBe(2);
  });

  it("accepts number emoji replies", () => {
    expect(parseNumberedReply("1️⃣", 3)).toBe(1);
    expect(parseNumberedReply("3️⃣ please", 3)).toBe(3);
  });

  it("rejects out-of-range numbers", () => {
    expect(parseNumberedReply("9", 3)).toBeNull();
    expect(parseNumberedReply("0", 3)).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(parseNumberedReply("hola", 5)).toBeNull();
    expect(parseNumberedReply("", 5)).toBeNull();
  });

  it("does not mistake substrings of larger numbers for the first match", () => {
    // "12 cosas" must NOT parse as 1 — it should parse as 12 and then fail
    // because 12 is out of range.
    expect(parseNumberedReply("12 cosas", 5)).toBeNull();
  });
});
