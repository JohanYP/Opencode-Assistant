import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDbInstance } from "../../src/memory/db.js";
import { addFact } from "../../src/memory/repositories/facts.js";
import {
  startMcpHttpServer,
  type McpHttpServerHandle,
} from "../../src/mcp/http-server.js";
import { ErrorCode } from "../../src/mcp/transport.js";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

async function postJson(url: string, body: unknown): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.text() };
}

describe("mcp/http-server", () => {
  let tempDir: string;
  let handle: McpHttpServerHandle | null = null;
  let baseUrl: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-mcp-http-test-"));
    process.env.MEMORY_DIR = tempDir;
    resetDbInstance();

    handle = await startMcpHttpServer({ port: 0, host: "127.0.0.1" });
    const address = handle.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to read server address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = null;
    }
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MEMORY_DIR;
  });

  it("responds 200 on GET / health probe", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it("returns the tool catalog on POST /mcp tools/list", async () => {
    const { status, body } = await postJson(`${baseUrl}/mcp`, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(status).toBe(200);
    const response = JSON.parse(body) as JsonRpcResponse;
    expect(response.id).toBe(1);
    const result = response.result as { tools: Array<{ name: string }> };
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("memory_read");
    expect(names).toContain("fact_add");
  });

  it("dispatches a tool call end-to-end via HTTP", async () => {
    addFact({ content: "via http", category: "test" });

    const { status, body } = await postJson(`${baseUrl}/mcp`, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "fact_search", arguments: { query: "via http" } },
    });
    expect(status).toBe(200);
    const response = JSON.parse(body) as JsonRpcResponse;
    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ text: string }> };
    const decoded = JSON.parse(result.content[0].text) as {
      count: number;
      results: Array<{ content: string }>;
    };
    expect(decoded.count).toBe(1);
    expect(decoded.results[0].content).toBe("via http");
  });

  it("returns ParseError for invalid JSON", async () => {
    const { status, body } = await postJson(`${baseUrl}/mcp`, "not-json");
    expect(status).toBe(200);
    const response = JSON.parse(body) as JsonRpcResponse;
    expect(response.error?.code).toBe(ErrorCode.ParseError);
  });

  it("returns InvalidRequest for messages without method", async () => {
    const { status, body } = await postJson(`${baseUrl}/mcp`, {
      jsonrpc: "2.0",
      id: 3,
    });
    expect(status).toBe(200);
    const response = JSON.parse(body) as JsonRpcResponse;
    expect(response.error?.code).toBe(ErrorCode.InvalidRequest);
  });

  it("converts thrown RpcError from handlers into JSON-RPC error", async () => {
    const { status, body } = await postJson(`${baseUrl}/mcp`, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "memory_write", arguments: { name: "soul", content: "x" } },
    });
    expect(status).toBe(200);
    const response = JSON.parse(body) as JsonRpcResponse;
    expect(response.error?.code).toBe(ErrorCode.InvalidParams);
  });

  it("rejects non-POST methods with 405", async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: "PUT" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("rejects unknown paths with 404", async () => {
    const { status } = await postJson(`${baseUrl}/elsewhere`, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/list",
    });
    expect(status).toBe(404);
  });

  it("returns 204 for notifications (no id)", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping" }),
    });
    expect(res.status).toBe(204);
  });

  it("supports JSON-RPC batch requests", async () => {
    const { status, body } = await postJson(`${baseUrl}/mcp`, [
      { jsonrpc: "2.0", id: 10, method: "ping" },
      { jsonrpc: "2.0", id: 11, method: "tools/list" },
    ]);
    expect(status).toBe(200);
    const responses = JSON.parse(body) as JsonRpcResponse[];
    expect(responses).toHaveLength(2);
    expect(responses[0].id).toBe(10);
    expect(responses[1].id).toBe(11);
    expect((responses[1].result as { tools: unknown[] }).tools.length).toBeGreaterThan(0);
  });

  it("rejects payloads larger than 1 MiB with 413", async () => {
    const huge = "x".repeat(2 * 1024 * 1024);
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: huge,
    });
    expect(res.status).toBe(413);
  });
});
