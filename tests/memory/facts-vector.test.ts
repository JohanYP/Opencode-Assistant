import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb, resetDbInstance } from "../../src/memory/db.js";
import type { EmbeddingDriver } from "../../src/memory/embedding-driver.js";
import { addFact } from "../../src/memory/repositories/facts.js";
import {
  countFactsMissingEmbedding,
  embedAndStore,
  getFactsMissingEmbedding,
  searchFactsByVector,
  updateFactEmbedding,
} from "../../src/memory/repositories/facts-vector.js";

const MODEL = "test-model";

function mockDriver(opts: {
  vecFor?: (text: string) => Float32Array;
  rejectFor?: (text: string) => Error | null;
}): EmbeddingDriver {
  return {
    model: MODEL,
    dimensions: 4,
    async embedOne(text: string) {
      const err = opts.rejectFor?.(text);
      if (err) throw err;
      return opts.vecFor ? opts.vecFor(text) : new Float32Array([0.5, 0.5, 0.5, 0.5]);
    },
    async embedBatch(texts: string[]) {
      return Promise.all(texts.map((t) => this.embedOne(t)));
    },
  };
}

describe("memory/repositories/facts-vector", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "facts-vec-test-"));
    process.env.MEMORY_DIR = tempDir;
    resetDbInstance();
    getDb();
  });

  afterEach(() => {
    closeDb();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    delete process.env.MEMORY_DIR;
  });

  it("ranks rust-direction fact above python-direction fact for rust-like query", () => {
    const rust = addFact({ content: "Rust is a systems language", category: "tech" });
    const python = addFact({ content: "Python is interpreted", category: "tech" });
    const mixed = addFact({ content: "Both are popular", category: "tech" });

    updateFactEmbedding(rust.id, new Float32Array([0.9, 0.1, 0, 0]), MODEL);
    updateFactEmbedding(python.id, new Float32Array([0, 0, 0.9, 0.1]), MODEL);
    updateFactEmbedding(mixed.id, new Float32Array([0.5, 0.5, 0, 0]), MODEL);

    const out = searchFactsByVector(new Float32Array([0.85, 0.15, 0, 0]), { limit: 3 });
    expect(out).toHaveLength(3);
    expect(out[0].content).toBe(rust.content);
    expect(out[2].content).toBe(python.content);
    expect(out[0].similarity).toBeGreaterThan(out[1].similarity);
    expect(out[1].similarity).toBeGreaterThan(out[2].similarity);
  });

  it("excludes facts without an embedding", () => {
    const withVec = addFact({ content: "I have a vector" });
    const noVec = addFact({ content: "I don't" });
    updateFactEmbedding(withVec.id, new Float32Array([1, 0, 0, 0]), MODEL);

    const out = searchFactsByVector(new Float32Array([1, 0, 0, 0]));
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(withVec.id);
    expect(out.find((r) => r.id === noVec.id)).toBeUndefined();
  });

  it("respects category filter", () => {
    const a = addFact({ content: "alpha", category: "x" });
    const b = addFact({ content: "beta", category: "y" });
    updateFactEmbedding(a.id, new Float32Array([1, 0, 0, 0]), MODEL);
    updateFactEmbedding(b.id, new Float32Array([1, 0, 0, 0]), MODEL);

    const out = searchFactsByVector(new Float32Array([1, 0, 0, 0]), { category: "x" });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(a.id);
  });

  it("respects limit", () => {
    for (let i = 0; i < 5; i++) {
      const f = addFact({ content: `fact-${i}` });
      updateFactEmbedding(f.id, new Float32Array([1, 0, 0, 0]), MODEL);
    }
    const out = searchFactsByVector(new Float32Array([1, 0, 0, 0]), { limit: 2 });
    expect(out).toHaveLength(2);
  });

  it("filters by minSimilarity", () => {
    const close = addFact({ content: "close" });
    const far = addFact({ content: "far" });
    updateFactEmbedding(close.id, new Float32Array([1, 0, 0, 0]), MODEL);
    updateFactEmbedding(far.id, new Float32Array([0, 1, 0, 0]), MODEL);

    const out = searchFactsByVector(new Float32Array([1, 0, 0, 0]), {
      minSimilarity: 0.5,
    });
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("close");
  });

  it("returns 0 similarity (and so deranks) for vectors with mismatched dims", () => {
    const aligned = addFact({ content: "aligned" });
    const mismatched = addFact({ content: "mismatched" });
    updateFactEmbedding(aligned.id, new Float32Array([1, 0, 0, 0]), MODEL);
    updateFactEmbedding(mismatched.id, new Float32Array([1, 0]), "old-model");

    const out = searchFactsByVector(new Float32Array([1, 0, 0, 0]));
    expect(out[0].content).toBe("aligned");
    const mismatchEntry = out.find((r) => r.content === "mismatched");
    expect(mismatchEntry?.similarity ?? 0).toBe(0);
  });

  it("getFactsMissingEmbedding returns null embeddings + wrong-model rows", () => {
    const noVec = addFact({ content: "no embedding" });
    const oldVec = addFact({ content: "stale embedding" });
    const goodVec = addFact({ content: "current embedding" });
    updateFactEmbedding(oldVec.id, new Float32Array([1, 0]), "OLD-MODEL");
    updateFactEmbedding(goodVec.id, new Float32Array([1, 0, 0, 0]), MODEL);

    const missing = getFactsMissingEmbedding(MODEL);
    const ids = missing.map((m) => m.id);
    expect(ids).toContain(noVec.id);
    expect(ids).toContain(oldVec.id);
    expect(ids).not.toContain(goodVec.id);

    expect(countFactsMissingEmbedding(MODEL)).toBe(2);
  });

  it("embedAndStore stores the vector returned by the driver", async () => {
    const fact = addFact({ content: "hello world" });
    const driver = mockDriver({ vecFor: () => new Float32Array([0.1, 0.2, 0.3, 0.4]) });

    await embedAndStore(driver, fact.id, fact.content);

    const out = searchFactsByVector(new Float32Array([0.1, 0.2, 0.3, 0.4]));
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(fact.id);
    expect(out[0].similarity).toBeCloseTo(1, 5);
  });

  it("embedAndStore swallows errors so fire-and-forget is safe", async () => {
    const fact = addFact({ content: "hello" });
    const driver = mockDriver({ rejectFor: () => new Error("provider down") });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(embedAndStore(driver, fact.id, fact.content)).resolves.toBeUndefined();
    warn.mockRestore();

    // No embedding stored
    expect(countFactsMissingEmbedding(MODEL)).toBe(1);
  });
});
