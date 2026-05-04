import http from "node:http";
import { logger } from "../utils/logger.js";
import { handleRequest } from "./memory-server.js";
import {
  ErrorCode,
  RpcError,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./transport.js";

export interface McpHttpServerOptions {
  port: number;
  host?: string;
  /** Path the server responds on. Defaults to `/mcp`. */
  path?: string;
}

export interface McpHttpServerHandle {
  server: http.Server;
  close(): Promise<void>;
}

const MAX_BODY_SIZE_BYTES = 1024 * 1024; // 1 MiB — generous; tools/list responses are tiny.

/**
 * Starts an HTTP MCP server that accepts JSON-RPC 2.0 requests via POST and
 * dispatches them to `handleRequest` from memory-server.ts. Used so a
 * separate OpenCode container (in the same docker compose network) can
 * reach the bot's memory tools without sharing a process tree.
 *
 * Spec note: this is the simplest variant of MCP's HTTP transport — plain
 * request/response, no SSE streaming. Sufficient for the synchronous
 * read/write tools we expose. If we later need server-initiated
 * notifications, we'll add an SSE endpoint.
 */
export function startMcpHttpServer(
  options: McpHttpServerOptions,
): Promise<McpHttpServerHandle> {
  const path = options.path ?? "/mcp";
  const host = options.host ?? "0.0.0.0";

  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" }).end();
      return;
    }

    const url = req.url ?? "";
    if (url !== path && url !== `${path}/`) {
      res.writeHead(404).end();
      return;
    }

    let body = "";
    let aborted = false;

    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      body += chunk.toString("utf-8");
      if (body.length > MAX_BODY_SIZE_BYTES) {
        aborted = true;
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: ErrorCode.InvalidRequest, message: "Request body too large" },
          }),
        );
      }
    });

    req.on("end", () => {
      if (aborted) return;
      void handleSingleRequest(body, res);
    });

    req.on("error", (err) => {
      if (aborted) return;
      logger.error("[MCP/HTTP] Request stream error:", err);
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => {
      logger.info(
        `[MCP/HTTP] Memory MCP server listening on http://${host}:${options.port}${path}`,
      );
      server.off("error", reject);
      resolve({
        server,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

async function handleSingleRequest(body: string, res: http.ServerResponse): Promise<void> {
  if (!body.trim()) {
    sendJson(res, 200, errorResponse(null, ErrorCode.InvalidRequest, "Empty request body"));
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(res, 200, errorResponse(null, ErrorCode.ParseError, "Invalid JSON"));
    return;
  }

  // Batch requests — dispatch each independently and return an array.
  if (Array.isArray(parsed)) {
    const responses: JsonRpcResponse[] = [];
    for (const entry of parsed) {
      const r = await dispatchOne(entry);
      if (r) responses.push(r);
    }
    sendJson(res, 200, responses);
    return;
  }

  const response = await dispatchOne(parsed);
  if (response) {
    sendJson(res, 200, response);
  } else {
    // Notification (no id) — return 204 No Content.
    res.writeHead(204).end();
  }
}

async function dispatchOne(value: unknown): Promise<JsonRpcResponse | null> {
  if (!isJsonRpcRequest(value)) {
    return errorResponse(null, ErrorCode.InvalidRequest, "Invalid JSON-RPC request");
  }

  const request = value as JsonRpcRequest;
  const isNotification = request.id === undefined || request.id === null;

  try {
    const result = await handleRequest(request);
    if (isNotification) return null;
    return { jsonrpc: "2.0", id: request.id ?? null, result };
  } catch (error) {
    if (isNotification) return null;
    if (error instanceof RpcError) {
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: {
          code: error.code,
          message: error.message,
          data: error.data,
        },
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(request.id ?? null, ErrorCode.InternalError, message);
  }
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as { jsonrpc?: unknown; method?: unknown };
  return v.jsonrpc === "2.0" && typeof v.method === "string";
}

function errorResponse(
  id: number | string | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}
