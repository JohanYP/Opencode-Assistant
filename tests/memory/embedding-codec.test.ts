import { describe, expect, it } from "vitest";
import {
  bufferToEmbedding,
  embeddingToBuffer,
} from "../../src/memory/embedding-codec.js";

describe("memory/embedding-codec", () => {
  it("roundtrips a typical embedding without precision loss", () => {
    const vec = new Float32Array([0.1, -0.5, 1.23456, 0, -0.001, 0.999]);
    const buf = embeddingToBuffer(vec);
    const back = bufferToEmbedding(buf);
    expect(back.length).toBe(vec.length);
    for (let i = 0; i < vec.length; i++) {
      expect(back[i]).toBeCloseTo(vec[i], 5);
    }
  });

  it("uses 4 bytes per float", () => {
    const vec = new Float32Array(1536);
    const buf = embeddingToBuffer(vec);
    expect(buf.length).toBe(1536 * 4);
  });

  it("handles empty vectors", () => {
    const buf = embeddingToBuffer(new Float32Array());
    expect(buf.length).toBe(0);
    const back = bufferToEmbedding(buf);
    expect(back.length).toBe(0);
  });

  it("handles negative and extreme values", () => {
    const vec = new Float32Array([-1e10, 1e10, -1e-10, 1e-10]);
    const back = bufferToEmbedding(embeddingToBuffer(vec));
    expect(back[0]).toBeCloseTo(-1e10, -5);
    expect(back[1]).toBeCloseTo(1e10, -5);
    expect(back[2]).toBeCloseTo(-1e-10, 12);
    expect(back[3]).toBeCloseTo(1e-10, 12);
  });

  it("tolerates buffer length not divisible by 4 (truncates)", () => {
    const buf = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0]); // 9 bytes = 2 full floats + 1 stray
    const back = bufferToEmbedding(buf);
    expect(back.length).toBe(2);
  });
});
