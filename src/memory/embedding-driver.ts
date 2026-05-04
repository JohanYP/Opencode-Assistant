import { config } from "../config.js";
import { logger } from "../utils/logger.js";

/**
 * Provider-agnostic embedding driver. Targets the OpenAI-compatible
 * `/v1/embeddings` endpoint, which is implemented by OpenAI, Ollama,
 * Groq, Together, Fireworks, Mistral, vLLM, LM Studio, and others.
 */
export interface EmbeddingDriver {
  embedOne(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  readonly model: string;
  readonly dimensions: number;
}

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

interface EmbeddingResponseItem {
  embedding: number[];
  index?: number;
}

interface EmbeddingResponse {
  data: EmbeddingResponseItem[];
}

class OpenAICompatibleDriver implements EmbeddingDriver {
  readonly model: string;
  readonly dimensions: number;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(opts: { baseUrl: string; model: string; apiKey: string }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.dimensions = inferDimensions(opts.model);
  }

  async embedOne(text: string): Promise<Float32Array> {
    const out = await this.embedBatch([text]);
    const first = out[0];
    if (!first) {
      throw new EmbeddingError("Empty embedding response from provider");
    }
    return first;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    const url = `${this.baseUrl}/embeddings`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: this.model, input: texts }),
      });
    } catch (err) {
      throw new EmbeddingError(
        `Network error reaching embedding provider at ${this.baseUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new EmbeddingError(
        `Embedding provider returned ${resp.status}: ${body.slice(0, 200)}`,
        resp.status,
      );
    }

    let parsed: EmbeddingResponse;
    try {
      parsed = (await resp.json()) as EmbeddingResponse;
    } catch (err) {
      throw new EmbeddingError(
        `Embedding provider returned non-JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (!parsed.data || parsed.data.length === 0) {
      throw new EmbeddingError("Embedding provider returned empty data array");
    }

    return parsed.data.map((d) => Float32Array.from(d.embedding));
  }
}

/**
 * Infer dimensionality from model name. Used to size the BLOB column
 * sanity-check, not to truncate vectors. Defaults to 1536 (the most
 * common dimension for OpenAI-style models) when unknown.
 */
function inferDimensions(model: string): number {
  switch (model) {
    case "text-embedding-3-small":
    case "text-embedding-ada-002":
      return 1536;
    case "text-embedding-3-large":
      return 3072;
    case "all-MiniLM-L6-v2":
    case "all-MiniLM-L12-v2":
      return 384;
    case "all-mpnet-base-v2":
    case "nomic-embed-text":
      return 768;
    case "mxbai-embed-large":
      return 1024;
    default:
      return 1536;
  }
}

let cachedDriver: EmbeddingDriver | null | undefined;

/**
 * Lazy singleton. Returns `null` when EMBEDDING_BASE_URL is not configured —
 * callers MUST treat null as "vector search disabled, use LIKE fallback".
 */
export function getEmbeddingDriver(): EmbeddingDriver | null {
  if (cachedDriver !== undefined) return cachedDriver;

  const cfg = config.embedding;
  if (!cfg.enabled) {
    cachedDriver = null;
    return null;
  }

  // Trim trailing slashes; many providers reject double-slash paths.
  const baseUrl = cfg.baseUrl.replace(/\/+$/, "");

  // Security: warn loudly when text will leave the box.
  const isLocal =
    baseUrl.includes("localhost") ||
    baseUrl.includes("127.0.0.1") ||
    baseUrl.includes("::1") ||
    baseUrl.includes("host.docker.internal");
  if (!isLocal) {
    logger.warn(
      `[Memory/Embedding] Driver configured to send text to external API at ${baseUrl} — ` +
        `fact contents will leave this machine. Set EMBEDDING_BASE_URL to a local provider ` +
        `(e.g. Ollama on http://host.docker.internal:11434/v1) to keep data local.`,
    );
  }

  cachedDriver = new OpenAICompatibleDriver({
    baseUrl,
    model: cfg.model,
    apiKey: cfg.apiKey,
  });
  logger.info(
    `[Memory/Embedding] Driver enabled (model=${cfg.model}, base=${baseUrl}, dims≈${cachedDriver.dimensions})`,
  );
  return cachedDriver;
}

/** Test-only: drop the cached driver so the next call re-reads config. */
export function __resetEmbeddingDriverForTests(): void {
  cachedDriver = undefined;
}
