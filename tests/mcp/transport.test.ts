import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  ErrorCode,
  RpcError,
  startStdioServer,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/mcp/transport.js";

interface PipeHarness {
  input: PassThrough;
  output: PassThrough;
  responses: JsonRpcResponse[];
  close: () => void;
}

function createHarness(handler: Parameters<typeof startStdioServer>[0]): PipeHarness {
  const input = new PassThrough();
  const output = new PassThrough();
  const responses: JsonRpcResponse[] = [];

  let buffer = "";
  output.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf-8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) responses.push(JSON.parse(line) as JsonRpcResponse);
    }
  });

  const handle = startStdioServer(handler, { input, output });
  return {
    input,
    output,
    responses,
    close: () => handle.close(),
  };
}

function send(harness: PipeHarness, message: object): void {
  harness.input.write(JSON.stringify(message) + "\n");
}

async function settle(): Promise<void> {
  // Allow any pending microtasks/I/O writes to flush.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("mcp/transport", () => {
  it("dispatches a request and writes a success response", async () => {
    const harness = createHarness((req) => ({ method: req.method, ok: true }));
    try {
      send(harness, { jsonrpc: "2.0", id: 1, method: "ping" });
      await settle();

      expect(harness.responses).toHaveLength(1);
      const res = harness.responses[0];
      expect(res.id).toBe(1);
      expect("result" in res ? res.result : null).toEqual({ method: "ping", ok: true });
    } finally {
      harness.close();
    }
  });

  it("does not respond to a notification (no id)", async () => {
    const harness = createHarness(() => "should not be returned");
    try {
      send(harness, { jsonrpc: "2.0", method: "notif" });
      await settle();
      expect(harness.responses).toHaveLength(0);
    } finally {
      harness.close();
    }
  });

  it("converts thrown RpcError to a JSON-RPC error response", async () => {
    const harness = createHarness(() => {
      throw new RpcError(ErrorCode.InvalidParams, "missing 'name'", { field: "name" });
    });
    try {
      send(harness, { jsonrpc: "2.0", id: 7, method: "tools/call" });
      await settle();

      expect(harness.responses).toHaveLength(1);
      const res = harness.responses[0];
      expect(res.id).toBe(7);
      expect("error" in res ? res.error : null).toEqual({
        code: ErrorCode.InvalidParams,
        message: "missing 'name'",
        data: { field: "name" },
      });
    } finally {
      harness.close();
    }
  });

  it("converts a generic Error to ErrorCode.InternalError", async () => {
    const harness = createHarness(() => {
      throw new Error("oops");
    });
    try {
      send(harness, { jsonrpc: "2.0", id: 99, method: "anything" });
      await settle();

      expect(harness.responses).toHaveLength(1);
      const res = harness.responses[0];
      expect("error" in res && res.error?.code).toBe(ErrorCode.InternalError);
      expect("error" in res && res.error?.message).toBe("oops");
    } finally {
      harness.close();
    }
  });

  it("returns ParseError for invalid JSON lines", async () => {
    const harness = createHarness(() => "not reached");
    try {
      harness.input.write("not-json\n");
      await settle();

      expect(harness.responses).toHaveLength(1);
      const res = harness.responses[0];
      expect("error" in res && res.error?.code).toBe(ErrorCode.ParseError);
      expect(res.id).toBeNull();
    } finally {
      harness.close();
    }
  });

  it("returns InvalidRequest for messages without method", async () => {
    const harness = createHarness(() => "not reached");
    try {
      // Missing 'method' field, but has id, so we should get an error response.
      send(harness, { jsonrpc: "2.0", id: 1 });
      await settle();

      expect(harness.responses).toHaveLength(1);
      expect("error" in harness.responses[0] && harness.responses[0].error?.code).toBe(
        ErrorCode.InvalidRequest,
      );
    } finally {
      harness.close();
    }
  });

  it("handles multiple requests in a single chunk", async () => {
    const counter = { n: 0 };
    const harness = createHarness((req: JsonRpcRequest) => {
      counter.n++;
      return { id: req.id, n: counter.n };
    });
    try {
      const payload =
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "a" }) +
        "\n" +
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "b" }) +
        "\n";
      harness.input.write(payload);
      await settle();

      expect(harness.responses).toHaveLength(2);
      expect(harness.responses.map((r) => r.id)).toEqual([1, 2]);
    } finally {
      harness.close();
    }
  });

  it("supports async handlers", async () => {
    const harness = createHarness(async (req: JsonRpcRequest) => {
      await new Promise((r) => setImmediate(r));
      return { method: req.method, async: true };
    });
    try {
      send(harness, { jsonrpc: "2.0", id: 5, method: "delayed" });
      await new Promise((r) => setTimeout(r, 5));
      await settle();

      expect(harness.responses).toHaveLength(1);
      expect("result" in harness.responses[0] ? harness.responses[0].result : null).toEqual({
        method: "delayed",
        async: true,
      });
    } finally {
      harness.close();
    }
  });

  it("close() stops processing further input", async () => {
    const harness = createHarness(() => "ok");
    harness.close();
    send(harness, { jsonrpc: "2.0", id: 1, method: "ping" });
    await settle();
    expect(harness.responses).toHaveLength(0);
  });
});
