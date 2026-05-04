import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDbInstance } from "../../src/memory/db.js";
import { setDocument } from "../../src/memory/repositories/documents.js";
import { addFact } from "../../src/memory/repositories/facts.js";
import { installSkill } from "../../src/memory/repositories/skills.js";
import {
  MEMORY_TOOLS,
  handleRequest,
} from "../../src/mcp/memory-server.js";
import { ErrorCode } from "../../src/mcp/transport.js";

interface ToolContent {
  content: Array<{ type: "text"; text: string }>;
}

function callTool(name: string, args?: Record<string, unknown>): Promise<unknown> {
  return Promise.resolve(
    handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  );
}

function decode(result: unknown): unknown {
  const r = result as ToolContent;
  expect(r.content).toBeDefined();
  expect(r.content).toHaveLength(1);
  return JSON.parse(r.content[0].text);
}

describe("mcp/memory-server", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-mcp-test-"));
    process.env.MEMORY_DIR = tempDir;
    resetDbInstance();
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MEMORY_DIR;
  });

  describe("MCP protocol scaffolding", () => {
    it("returns server info on initialize", async () => {
      const result = (await handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      })) as {
        protocolVersion: string;
        capabilities: { tools: object };
        serverInfo: { name: string; version: string };
      };

      expect(result.protocolVersion).toBeTypeOf("string");
      expect(result.capabilities.tools).toBeDefined();
      expect(result.serverInfo.name).toBe("opencode-assistant-memory");
      expect(result.serverInfo.version).toBeTypeOf("string");
    });

    it("returns the tool catalog on tools/list", async () => {
      const result = (await handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      })) as { tools: Array<{ name: string }> };

      const names = result.tools.map((t) => t.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "memory_read",
          "memory_write",
          "fact_add",
          "fact_search",
          "fact_recent",
          "fact_delete",
          "skill_list",
          "skill_read",
          "audit_recent",
        ]),
      );
      expect(result.tools.length).toBe(MEMORY_TOOLS.length);
    });

    it("responds to ping with empty object", async () => {
      const result = await handleRequest({ jsonrpc: "2.0", id: 1, method: "ping" });
      expect(result).toEqual({});
    });

    it("rejects unknown methods with MethodNotFound", async () => {
      await expect(
        handleRequest({ jsonrpc: "2.0", id: 1, method: "totally/fake" }),
      ).rejects.toMatchObject({
        code: ErrorCode.MethodNotFound,
      });
    });
  });

  describe("memory_read / memory_write", () => {
    it("returns the document content for an existing document", async () => {
      setDocument("context", "current project: alpha");
      const decoded = decode(await callTool("memory_read", { name: "context" })) as {
        content: string;
      };
      expect(decoded.content).toBe("current project: alpha");
    });

    it("returns missing=true for a missing document", async () => {
      const decoded = decode(await callTool("memory_read", { name: "context" })) as {
        missing: boolean;
        content: string;
      };
      expect(decoded.missing).toBe(true);
      expect(decoded.content).toBe("");
    });

    it("rejects memory_write to soul (read-only)", async () => {
      await expect(callTool("memory_write", { name: "soul", content: "hijack" })).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
      });
    });

    it("rejects memory_write to agents (read-only)", async () => {
      await expect(
        callTool("memory_write", { name: "agents", content: "hijack" }),
      ).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
      });
    });

    it("writes context successfully and confirms", async () => {
      const decoded = decode(
        await callTool("memory_write", {
          name: "context",
          content: "now working on phase 1.4",
        }),
      ) as { ok: boolean; name: string };
      expect(decoded.ok).toBe(true);
      expect(decoded.name).toBe("context");
    });

    it("writes session-summary successfully", async () => {
      const decoded = decode(
        await callTool("memory_write", {
          name: "session-summary",
          content: "session summary content",
        }),
      ) as { ok: boolean };
      expect(decoded.ok).toBe(true);
    });
  });

  describe("fact tools", () => {
    it("adds and searches a fact end-to-end", async () => {
      const added = decode(
        await callTool("fact_add", { content: "uses TypeScript", category: "preference" }),
      ) as { id: number; content: string };
      expect(added.id).toBeGreaterThan(0);

      const searched = decode(await callTool("fact_search", { query: "TypeScript" })) as {
        count: number;
        results: Array<{ content: string }>;
      };
      expect(searched.count).toBe(1);
      expect(searched.results[0].content).toBe("uses TypeScript");
    });

    it("respects fact_search category filter", async () => {
      addFact({ content: "rust is great", category: "lang" });
      addFact({ content: "rust analyzer is good", category: "tool" });

      const decoded = decode(
        await callTool("fact_search", { query: "rust", category: "lang" }),
      ) as { count: number };
      expect(decoded.count).toBe(1);
    });

    it("returns recent facts via fact_recent", async () => {
      addFact({ content: "first" });
      addFact({ content: "second" });
      const decoded = decode(await callTool("fact_recent", {})) as {
        count: number;
        results: Array<{ content: string }>;
      };
      expect(decoded.count).toBe(2);
    });

    it("deletes a fact via fact_delete", async () => {
      const fact = addFact({ content: "ephemeral" });
      const decoded = decode(await callTool("fact_delete", { id: fact.id })) as {
        deleted: boolean;
      };
      expect(decoded.deleted).toBe(true);
    });
  });

  describe("skill tools", () => {
    it("lists installed skills", async () => {
      installSkill({ name: "alpha", content: "a", description: "alpha skill", category: "x" });
      installSkill({ name: "beta", content: "b", description: "beta skill", category: "y" });

      const decoded = decode(await callTool("skill_list", {})) as {
        count: number;
        skills: Array<{ name: string; description: string }>;
      };
      expect(decoded.count).toBe(2);
      expect(decoded.skills.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);
    });

    it("filters skill_list by category", async () => {
      installSkill({ name: "a", content: "a", category: "engineering" });
      installSkill({ name: "b", content: "b", category: "engineering" });
      installSkill({ name: "c", content: "c", category: "marketing" });

      const decoded = decode(
        await callTool("skill_list", { category: "engineering" }),
      ) as { count: number };
      expect(decoded.count).toBe(2);
    });

    it("reads a skill's full content", async () => {
      installSkill({ name: "x", content: "# X\n\nbody" });
      const decoded = decode(await callTool("skill_read", { name: "x" })) as {
        name: string;
        content: string;
      };
      expect(decoded.name).toBe("x");
      expect(decoded.content).toBe("# X\n\nbody");
    });

    it("throws InvalidParams for missing skill", async () => {
      await expect(callTool("skill_read", { name: "nope" })).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
      });
    });
  });

  describe("audit_recent", () => {
    it("returns audit entries for tool calls that mutate", async () => {
      await callTool("fact_add", { content: "audited fact" });

      const decoded = decode(await callTool("audit_recent", {})) as {
        count: number;
        entries: Array<{ event: string }>;
      };
      const events = decoded.entries.map((e) => e.event);
      expect(events).toContain("fact_added");
    });
  });

  describe("error handling", () => {
    it("throws InvalidParams when tools/call has no name", async () => {
      await expect(
        handleRequest({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {},
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
      });
    });

    it("throws InvalidParams for fact_add without content", async () => {
      await expect(callTool("fact_add", {})).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
      });
    });

    it("throws MethodNotFound for unknown tool name", async () => {
      await expect(callTool("nonexistent_tool", {})).rejects.toMatchObject({
        code: ErrorCode.MethodNotFound,
      });
    });
  });
});
