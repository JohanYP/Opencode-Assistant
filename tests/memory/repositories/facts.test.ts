import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDbInstance } from "../../../src/memory/db.js";
import {
  addFact,
  countFacts,
  deleteFact,
  getFactById,
  getRecentFacts,
  searchFacts,
} from "../../../src/memory/repositories/facts.js";

describe("memory/repositories/facts", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-facts-test-"));
    process.env.MEMORY_DIR = tempDir;
    resetDbInstance();
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MEMORY_DIR;
  });

  it("adds a fact and reads it back by id", () => {
    const fact = addFact({ category: "preference", content: "uses TypeScript", source: "user" });
    expect(fact.id).toBeGreaterThan(0);
    expect(fact.content).toBe("uses TypeScript");
    expect(fact.category).toBe("preference");
    expect(fact.source).toBe("user");

    const read = getFactById(fact.id);
    expect(read).toEqual(fact);
  });

  it("returns null for a missing fact id", () => {
    expect(getFactById(99999)).toBeNull();
  });

  it("accepts facts without category or source", () => {
    const fact = addFact({ content: "naked fact" });
    expect(fact.category).toBeNull();
    expect(fact.source).toBeNull();
    expect(fact.content).toBe("naked fact");
  });

  it("searches by content substring (case-sensitive LIKE)", () => {
    addFact({ content: "loves typescript" });
    addFact({ content: "likes Python" });
    addFact({ content: "TypeScript and Python" });

    const matches = searchFacts("Python");
    expect(matches.map((f) => f.content)).toEqual(
      expect.arrayContaining(["likes Python", "TypeScript and Python"]),
    );
    expect(matches).toHaveLength(2);
  });

  it("searches with a category filter", () => {
    addFact({ category: "lang", content: "rust is great" });
    addFact({ category: "lang", content: "go is great" });
    addFact({ category: "tool", content: "rust analyzer" });

    const matches = searchFacts("rust", { category: "lang" });
    expect(matches).toHaveLength(1);
    expect(matches[0].content).toBe("rust is great");
  });

  it("respects the search limit", () => {
    for (let i = 0; i < 10; i++) {
      addFact({ content: `recurring fact ${i}` });
    }
    const matches = searchFacts("recurring", { limit: 3 });
    expect(matches).toHaveLength(3);
  });

  it("returns recent facts ordered by updated_at DESC", async () => {
    const a = addFact({ content: "first" });
    // Ensure timestamps differ — sleep 5ms.
    await new Promise((r) => setTimeout(r, 5));
    const b = addFact({ content: "second" });
    await new Promise((r) => setTimeout(r, 5));
    const c = addFact({ content: "third" });

    const recent = getRecentFacts(10);
    expect(recent.map((f) => f.id)).toEqual([c.id, b.id, a.id]);
  });

  it("deletes a fact by id", () => {
    const fact = addFact({ content: "ephemeral" });
    expect(deleteFact(fact.id)).toBe(true);
    expect(getFactById(fact.id)).toBeNull();
    expect(deleteFact(fact.id)).toBe(false);
  });

  it("counts facts", () => {
    expect(countFacts()).toBe(0);
    addFact({ content: "a" });
    addFact({ content: "b" });
    expect(countFacts()).toBe(2);
  });
});
