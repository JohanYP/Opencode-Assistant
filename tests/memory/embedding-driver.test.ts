import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "../../src/config.js";
import {
  EmbeddingError,
  __resetEmbeddingDriverForTests,
  getEmbeddingDriver,
} from "../../src/memory/embedding-driver.js";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetchOnce(payload: { ok: boolean; status?: number; body: unknown }): void {
  globalThis.fetch = vi.fn(async () =>
    new Response(typeof payload.body === "string" ? payload.body : JSON.stringify(payload.body), {
      status: payload.status ?? (payload.ok ? 200 : 500),
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("memory/embedding-driver", () => {
  beforeEach(() => {
    delete process.env.EMBEDDING_BASE_URL;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_API_KEY;
    resetConfigCache();
    __resetEmbeddingDriverForTests();
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.EMBEDDING_BASE_URL;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_API_KEY;
    resetConfigCache();
    __resetEmbeddingDriverForTests();
  });

  it("returns null when EMBEDDING_BASE_URL is unset", () => {
    expect(getEmbeddingDriver()).toBeNull();
  });

  it("returns null when EMBEDDING_BASE_URL is empty/whitespace", () => {
    process.env.EMBEDDING_BASE_URL = "   ";
    resetConfigCache();
    __resetEmbeddingDriverForTests();
    expect(getEmbeddingDriver()).toBeNull();
  });

  it("creates a driver and infers dimensions from model name", () => {
    process.env.EMBEDDING_BASE_URL = "http://localhost:11434/v1";
    process.env.EMBEDDING_MODEL = "nomic-embed-text";
    resetConfigCache();
    __resetEmbeddingDriverForTests();
    const driver = getEmbeddingDriver();
    expect(driver).not.toBeNull();
    expect(driver?.model).toBe("nomic-embed-text");
    expect(driver?.dimensions).toBe(768);
  });

  it("defaults to 1536 dims for unknown model", () => {
    process.env.EMBEDDING_BASE_URL = "http://localhost:11434/v1";
    process.env.EMBEDDING_MODEL = "totally-made-up-model";
    resetConfigCache();
    __resetEmbeddingDriverForTests();
    expect(getEmbeddingDriver()?.dimensions).toBe(1536);
  });

  it("embedOne posts to /embeddings with the model and bearer auth", async () => {
    process.env.EMBEDDING_BASE_URL = "http://localhost:11434/v1";
    process.env.EMBEDDING_MODEL = "nomic-embed-text";
    process.env.EMBEDDING_API_KEY = "test-key";
    resetConfigCache();
    __resetEmbeddingDriverForTests();

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const driver = getEmbeddingDriver()!;
    const vec = await driver.embedOne("hello");

    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(3);
    expect(vec[0]).toBeCloseTo(0.1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/v1/embeddings");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-key");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("nomic-embed-text");
    expect(body.input).toEqual(["hello"]);
  });

  it("omits Authorization header when api key is empty (local providers)", async () => {
    process.env.EMBEDDING_BASE_URL = "http://localhost:11434/v1";
    process.env.EMBEDDING_MODEL = "nomic-embed-text";
    resetConfigCache();
    __resetEmbeddingDriverForTests();

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ embedding: [0.5] }] }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await getEmbeddingDriver()!.embedOne("hi");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("embedBatch returns one Float32Array per input", async () => {
    process.env.EMBEDDING_BASE_URL = "http://localhost:11434/v1";
    resetConfigCache();
    __resetEmbeddingDriverForTests();

    mockFetchOnce({
      ok: true,
      body: {
        data: [
          { embedding: [1, 0] },
          { embedding: [0, 1] },
          { embedding: [1, 1] },
        ],
      },
    });

    const out = await getEmbeddingDriver()!.embedBatch(["a", "b", "c"]);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual(new Float32Array([1, 0]));
    expect(out[1]).toEqual(new Float32Array([0, 1]));
    expect(out[2]).toEqual(new Float32Array([1, 1]));
  });

  it("returns empty array for empty input without calling fetch", async () => {
    process.env.EMBEDDING_BASE_URL = "http://localhost:11434/v1";
    resetConfigCache();
    __resetEmbeddingDriverForTests();

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await getEmbeddingDriver()!.embedBatch([]);
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws EmbeddingError with status on non-200 response", async () => {
    process.env.EMBEDDING_BASE_URL = "http://localhost:11434/v1";
    resetConfigCache();
    __resetEmbeddingDriverForTests();

    mockFetchOnce({ ok: false, status: 401, body: "unauthorized" });

    await expect(getEmbeddingDriver()!.embedOne("x")).rejects.toMatchObject({
      name: "EmbeddingError",
      status: 401,
    });
  });

  it("throws EmbeddingError on network failure", async () => {
    process.env.EMBEDDING_BASE_URL = "http://localhost:11434/v1";
    resetConfigCache();
    __resetEmbeddingDriverForTests();

    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch;

    await expect(getEmbeddingDriver()!.embedOne("x")).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("trims trailing slashes from base url", async () => {
    process.env.EMBEDDING_BASE_URL = "http://localhost:11434/v1//";
    resetConfigCache();
    __resetEmbeddingDriverForTests();

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ embedding: [0] }] }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await getEmbeddingDriver()!.embedOne("x");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("http://localhost:11434/v1/embeddings");
  });
});
