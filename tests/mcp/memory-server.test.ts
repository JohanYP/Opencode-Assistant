import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "../../src/config.js";
import { closeDb, resetDbInstance } from "../../src/memory/db.js";
import { __resetEmbeddingDriverForTests } from "../../src/memory/embedding-driver.js";
import { setDocument } from "../../src/memory/repositories/documents.js";
import { addFact } from "../../src/memory/repositories/facts.js";
import { updateFactEmbedding } from "../../src/memory/repositories/facts-vector.js";
import { installSkill } from "../../src/memory/repositories/skills.js";
import {
  MEMORY_TOOLS,
  handleRequest,
} from "../../src/mcp/memory-server.js";
import { ErrorCode } from "../../src/mcp/transport.js";

const ORIGINAL_FETCH = globalThis.fetch;

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
    delete process.env.EMBEDDING_BASE_URL;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_API_KEY;
    resetConfigCache();
    __resetEmbeddingDriverForTests();
    globalThis.fetch = ORIGINAL_FETCH;
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
          "skill_create",
          "skill_update",
          "skill_delete",
          "tts_get_settings",
          "tts_set_settings",
          "tts_list_voices",
          "task_create",
          "task_list",
          "task_delete",
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

    it("fact_search reports mode=like when no embedding driver is configured", async () => {
      addFact({ content: "kotlin is concise" });
      const out = decode(await callTool("fact_search", { query: "kotlin" })) as {
        mode: string;
        count: number;
      };
      expect(out.mode).toBe("like");
      expect(out.count).toBe(1);
    });

    it("fact_search returns vector-ranked results when driver is configured", async () => {
      const aligned = addFact({ content: "aligned" });
      const opposite = addFact({ content: "opposite" });
      const MODEL = "test-model";
      updateFactEmbedding(aligned.id, new Float32Array([1, 0, 0, 0]), MODEL);
      updateFactEmbedding(opposite.id, new Float32Array([-1, 0, 0, 0]), MODEL);

      process.env.EMBEDDING_BASE_URL = "http://localhost:11434/v1";
      process.env.EMBEDDING_MODEL = MODEL;
      resetConfigCache();
      __resetEmbeddingDriverForTests();
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ embedding: [1, 0, 0, 0] }] }), { status: 200 }),
      ) as unknown as typeof fetch;

      const out = decode(await callTool("fact_search", { query: "anything" })) as {
        mode: string;
        results: Array<{ content: string; similarity: number }>;
      };
      expect(out.mode).toBe("vector");
      expect(out.results[0].content).toBe("aligned");
      expect(out.results[0].similarity).toBeCloseTo(1, 5);
    });

    it("fact_search falls back to LIKE when the driver throws", async () => {
      addFact({ content: "fallback hit" });

      process.env.EMBEDDING_BASE_URL = "http://localhost:11434/v1";
      resetConfigCache();
      __resetEmbeddingDriverForTests();
      globalThis.fetch = vi.fn(async () => {
        throw new TypeError("connection refused");
      }) as unknown as typeof fetch;

      const out = decode(await callTool("fact_search", { query: "fallback" })) as {
        mode: string;
        count: number;
      };
      expect(out.mode).toBe("like");
      expect(out.count).toBe(1);
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

    it("skill_create writes both SQLite and the .md file", async () => {
      const out = decode(
        await callTool("skill_create", {
          name: "fresh-skill",
          content: "# Fresh\n\nDoes a thing.",
          description: "fresh demo",
          category: "demo",
        }),
      ) as { ok: boolean; name: string };

      expect(out.ok).toBe(true);
      expect(out.name).toBe("fresh-skill");

      // SQLite row
      const list = decode(await callTool("skill_list", {})) as {
        skills: Array<{ name: string; description: string | null }>;
      };
      expect(list.skills.find((s) => s.name === "fresh-skill")?.description).toBe("fresh demo");

      // .md file on disk
      const filePath = path.join(tempDir, "skills", "fresh-skill.md");
      const content = await fs.promises.readFile(filePath, "utf-8");
      expect(content).toBe("# Fresh\n\nDoes a thing.");
    });

    it("skill_create rejects when the name already exists", async () => {
      installSkill({ name: "taken", content: "old" });
      await expect(
        callTool("skill_create", { name: "taken", content: "new" }),
      ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    });

    it("skill_create rejects invalid names", async () => {
      await expect(
        callTool("skill_create", { name: "../escape", content: "x" }),
      ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
      await expect(
        callTool("skill_create", { name: "Has Spaces", content: "x" }),
      ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    });

    it("skill_update replaces content and rewrites the .md", async () => {
      installSkill({ name: "evolving", content: "v1", description: "old desc" });

      const out = decode(
        await callTool("skill_update", {
          name: "evolving",
          content: "v2",
        }),
      ) as { ok: boolean };
      expect(out.ok).toBe(true);

      const read = decode(await callTool("skill_read", { name: "evolving" })) as {
        content: string;
        description: string | null;
      };
      expect(read.content).toBe("v2");
      // description preserved when not provided
      expect(read.description).toBe("old desc");

      const filePath = path.join(tempDir, "skills", "evolving.md");
      expect(await fs.promises.readFile(filePath, "utf-8")).toBe("v2");
    });

    it("skill_update errors when the skill doesn't exist", async () => {
      await expect(
        callTool("skill_update", { name: "ghost", content: "x" }),
      ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    });

    it("skill_delete removes both row and file", async () => {
      installSkill({ name: "doomed", content: "bye" });
      // Pre-write the file the way skill_create would
      const filePath = path.join(tempDir, "skills", "doomed.md");
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, "bye", "utf-8");

      const out = decode(await callTool("skill_delete", { name: "doomed" })) as {
        ok: boolean;
      };
      expect(out.ok).toBe(true);

      await expect(fs.promises.access(filePath)).rejects.toThrow();
      const list = decode(await callTool("skill_list", {})) as {
        skills: Array<{ name: string }>;
      };
      expect(list.skills.find((s) => s.name === "doomed")).toBeUndefined();
    });

    it("skill_delete errors when the skill doesn't exist", async () => {
      await expect(callTool("skill_delete", { name: "ghost" })).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
      });
    });
  });

  describe("tts tools", () => {
    it("tts_get_settings returns current effective config", async () => {
      const out = decode(await callTool("tts_get_settings", {})) as {
        provider: string;
        voice: string;
        speed: number;
        enabled: boolean;
        source: { provider: string; voice: string };
      };
      expect(out.provider).toBeDefined();
      expect(out.voice).toBeDefined();
      expect(out.speed).toBeGreaterThan(0);
      expect(out.source.provider).toBeDefined();
    });

    it("tts_set_settings switches to edge (no creds needed)", async () => {
      const out = decode(
        await callTool("tts_set_settings", { provider: "edge" }),
      ) as { ok: boolean; provider: string };
      expect(out.ok).toBe(true);
      expect(out.provider).toBe("edge");

      // Verify persistence via tts_get_settings
      const after = decode(await callTool("tts_get_settings", {})) as {
        provider: string;
        source: { provider: string };
      };
      expect(after.provider).toBe("edge");
      expect(after.source.provider).toBe("override");
    });

    it("tts_set_settings rejects invalid provider", async () => {
      await expect(
        callTool("tts_set_settings", { provider: "fake" }),
      ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    });

    it("tts_set_settings rejects out-of-range speed", async () => {
      await expect(
        callTool("tts_set_settings", { speed: 5 }),
      ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
      await expect(
        callTool("tts_set_settings", { speed: 0.1 }),
      ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    });

    it("tts_set_settings with valid voice for speechify (with creds stubbed)", async () => {
      // Speechify validates voice against the static catalog. Stub the
      // creds so we don't get rejected by the no-credentials guard.
      process.env.SPEECHIFY_API_KEY = "test-key";
      resetConfigCache();
      try {
        const out = decode(
          await callTool("tts_set_settings", {
            provider: "speechify",
            voice: "henry",
          }),
        ) as { ok: boolean; voice: string };
        expect(out.ok).toBe(true);
        expect(out.voice).toBe("henry");

        // Bogus voice for the same provider rejects.
        await expect(
          callTool("tts_set_settings", {
            provider: "speechify",
            voice: "completely-fake-voice",
          }),
        ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
      } finally {
        delete process.env.SPEECHIFY_API_KEY;
        resetConfigCache();
      }
    });

    it("tts_list_voices returns the static catalog for non-edge", async () => {
      const out = decode(
        await callTool("tts_list_voices", { provider: "openai" }),
      ) as {
        provider: string;
        total: number;
        voices: Array<{ id: string }>;
      };
      expect(out.provider).toBe("openai");
      expect(out.total).toBeGreaterThan(0);
      expect(out.voices.map((v) => v.id)).toContain("alloy");
    });

    it("tts_list_voices filters by locale prefix", async () => {
      const out = decode(
        await callTool("tts_list_voices", { provider: "google", locale: "es" }),
      ) as { voices: Array<{ locale: string }> };
      for (const v of out.voices) {
        expect(v.locale.toLowerCase()).toMatch(/^es/);
      }
    });

    it("tts_list_voices respects limit", async () => {
      const out = decode(
        await callTool("tts_list_voices", { provider: "openai", limit: 2 }),
      ) as { voices: unknown[] };
      expect(out.voices.length).toBeLessThanOrEqual(2);
    });
  });

  describe("task tools", () => {
    beforeEach(async () => {
      // Tasks need a current project + model; install them via the
      // settings manager (the MCP tool reads getCurrentProject/Model).
      const settings = await import("../../src/settings/manager.js");
      settings.setCurrentProject({
        id: "proj-test",
        worktree: "D:/Projects/Test",
      });
      settings.setCurrentModel({
        providerID: "test-provider",
        modelID: "test-model",
        variant: undefined,
      });
    });

    it("task_create with cron creates a task and registers it", async () => {
      const out = decode(
        await callTool("task_create", {
          type: "reminder",
          cron: "0 9 * * *",
          prompt: "morning check",
        }),
      ) as { ok: boolean; id: string; type: string; nextRunAt: string };

      expect(out.ok).toBe(true);
      expect(out.type).toBe("reminder");
      expect(out.id).toBeTruthy();
      expect(out.nextRunAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      // Confirm it shows up in task_list
      const list = decode(await callTool("task_list", {})) as {
        count: number;
        tasks: Array<{ id: string; prompt: string }>;
      };
      expect(list.count).toBe(1);
      expect(list.tasks[0].prompt).toBe("morning check");

      // Cleanup so the next test starts empty
      await callTool("task_delete", { id: out.id });
    });

    it("task_create with runAt accepts ISO datetimes in the future", async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const out = decode(
        await callTool("task_create", {
          type: "reminder",
          runAt: future,
          prompt: "one-shot",
        }),
      ) as { ok: boolean; id: string; kind: string };
      expect(out.ok).toBe(true);
      expect(out.kind).toBe("once");

      await callTool("task_delete", { id: out.id });
    });

    it("task_create rejects past runAt", async () => {
      const past = new Date(Date.now() - 60 * 1000).toISOString();
      await expect(
        callTool("task_create", { type: "reminder", runAt: past, prompt: "late" }),
      ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    });

    it("task_create rejects cron firing more often than every 5 min", async () => {
      await expect(
        callTool("task_create", {
          type: "reminder",
          cron: "*/2 * * * *",
          prompt: "too fast",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    });

    it("task_create requires exactly one of cron|runAt", async () => {
      await expect(
        callTool("task_create", { type: "reminder", prompt: "x" }),
      ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });

      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await expect(
        callTool("task_create", {
          type: "reminder",
          cron: "0 9 * * *",
          runAt: future,
          prompt: "x",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    });

    it("task_create requires prompt for type=task and type=reminder", async () => {
      await expect(
        callTool("task_create", { type: "reminder", cron: "0 9 * * *" }),
      ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    });

    it("task_list filters by type", async () => {
      const r1 = decode(
        await callTool("task_create", {
          type: "reminder",
          cron: "0 9 * * *",
          prompt: "rem",
        }),
      ) as { id: string };
      const r2 = decode(
        await callTool("task_create", {
          type: "backup",
          cron: "0 0 * * 0",
        }),
      ) as { id: string };

      const reminders = decode(await callTool("task_list", { type: "reminder" })) as {
        count: number;
      };
      expect(reminders.count).toBe(1);
      const backups = decode(await callTool("task_list", { type: "backup" })) as {
        count: number;
      };
      expect(backups.count).toBe(1);

      await callTool("task_delete", { id: r1.id });
      await callTool("task_delete", { id: r2.id });
    });

    it("task_delete removes the row and returns ok", async () => {
      const created = decode(
        await callTool("task_create", {
          type: "reminder",
          cron: "0 9 * * *",
          prompt: "delme",
        }),
      ) as { id: string };

      const del = decode(await callTool("task_delete", { id: created.id })) as {
        ok: boolean;
      };
      expect(del.ok).toBe(true);

      const list = decode(await callTool("task_list", {})) as { count: number };
      expect(list.count).toBe(0);
    });

    it("task_delete errors when id does not exist", async () => {
      await expect(
        callTool("task_delete", { id: "does-not-exist" }),
      ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
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
