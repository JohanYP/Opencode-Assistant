import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "../../src/memory/cosine.js";

describe("memory/cosine", () => {
  it("returns 1 for identical vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it("returns ~0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(Math.abs(cosineSimilarity(a, b))).toBeLessThan(1e-6);
  });

  it("returns -1 for opposite vectors", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it("ranks similar vectors above dissimilar ones", () => {
    const a = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const b = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const c = new Float32Array([0.4, 0.3, 0.2, 0.1]);
    const simSelf = cosineSimilarity(a, b);
    const simReversed = cosineSimilarity(a, c);
    expect(simSelf).toBeGreaterThan(simReversed);
    expect(simReversed).toBeGreaterThan(0);
    expect(simReversed).toBeLessThan(1);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity(new Float32Array(), new Float32Array())).toBe(0);
  });

  it("returns 0 when lengths differ (mixed embedding models)", () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("returns 0 when one vector is zero (avoids NaN)", () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});
