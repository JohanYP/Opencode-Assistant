import { Readable, Writable } from "node:stream";
import { logger } from "../utils/logger.js";

/**
 * Minimal JSON-RPC 2.0 framing over a newline-delimited stream, which is
 * what the MCP stdio transport mandates. We hand-roll this rather than
 * pulling in `@modelcontextprotocol/sdk` because the surface we expose is
 * tiny and we want full control over error handling and lifecycle.
 *
 * Spec: https://spec.modelcontextprotocol.io/specification/basic/transports/
 *   - "JSON-RPC messages MUST be delimited by newlines"
 *   - "JSON-RPC messages MUST NOT contain embedded newlines"
 */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: number | string | null;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: number | string | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

export type RequestHandler = (
  request: JsonRpcRequest,
) => Promise<unknown> | unknown;

export interface TransportHandle {
  /** Detach listeners and stop reading from stdin. */
  close(): void;
}

export interface TransportOptions {
  /** Defaults to process.stdin. */
  input?: Readable;
  /** Defaults to process.stdout. */
  output?: Writable;
}

/**
 * Starts the JSON-RPC server. The handler receives every request and may
 * return a value (success), throw an `RpcError`, or throw a generic Error
 * which is converted to ErrorCode.InternalError.
 *
 * Notifications (requests with no id) do not get a response.
 */
export function startStdioServer(
  handler: RequestHandler,
  options: TransportOptions = {},
): TransportHandle {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  input.setEncoding?.("utf-8");

  let buffer = "";
  let closed = false;

  const onData = (chunk: Buffer | string): void => {
    if (closed) return;
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf-8");

    let nlIndex: number;
    while ((nlIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nlIndex).trim();
      buffer = buffer.slice(nlIndex + 1);
      if (!line) continue;
      void processLine(line, handler, output);
    }
  };

  const onError = (error: Error): void => {
    logger.error("[MCP/Transport] stdin error:", error);
  };

  input.on("data", onData);
  input.on("error", onError);

  return {
    close(): void {
      if (closed) return;
      closed = true;
      input.off("data", onData);
      input.off("error", onError);
    },
  };
}

async function processLine(
  line: string,
  handler: RequestHandler,
  output: Writable,
): Promise<void> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    writeResponse(output, {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: ErrorCode.ParseError,
        message: "Invalid JSON",
      },
    });
    return;
  }

  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    if (request.id !== undefined) {
      writeResponse(output, {
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: {
          code: ErrorCode.InvalidRequest,
          message: "Invalid JSON-RPC request",
        },
      });
    }
    return;
  }

  // Notifications have no id and should not get a response.
  const isNotification = request.id === undefined || request.id === null;

  try {
    const result = await handler(request);
    if (!isNotification) {
      writeResponse(output, {
        jsonrpc: "2.0",
        id: request.id ?? null,
        result,
      });
    }
  } catch (error) {
    if (isNotification) return;

    if (error instanceof RpcError) {
      writeResponse(output, {
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: {
          code: error.code,
          message: error.message,
          data: error.data,
        },
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    writeResponse(output, {
      jsonrpc: "2.0",
      id: request.id ?? null,
      error: {
        code: ErrorCode.InternalError,
        message,
      },
    });
  }
}

function writeResponse(output: Writable, response: JsonRpcResponse): void {
  output.write(JSON.stringify(response) + "\n");
}

/**
 * Throw this from a request handler to send a structured JSON-RPC error.
 */
export class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }
}
