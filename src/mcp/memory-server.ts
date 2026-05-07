import { logger } from "../utils/logger.js";
import {
  ErrorCode,
  RpcError,
  type JsonRpcRequest,
  type RequestHandler,
  type TransportHandle,
  type TransportOptions,
  startStdioServer,
} from "./transport.js";
import { migrateFromFiles } from "../memory/migrate-from-files.js";
import {
  addFact,
  deleteFact,
  getRecentFacts,
  searchFacts,
} from "../memory/repositories/facts.js";
import { searchFactsByVector } from "../memory/repositories/facts-vector.js";
import { getEmbeddingDriver } from "../memory/embedding-driver.js";
import { getEffectiveTtsConfig } from "../tts/config-resolver.js";
import { listEdgeVoices } from "../tts/edge.js";
import { STATIC_VOICES } from "../tts/voices.js";
import {
  getCurrentModel,
  getCurrentProject,
  getUiPreferences,
  isTtsEnabled,
  setTtsEnabled,
  setUiPreferences,
} from "../settings/manager.js";
import type { TtsProvider } from "../config.js";
import { config } from "../config.js";
import {
  buildScheduledTask,
  getScheduledTaskLimit,
  TaskBuilderError,
  type BuildSchedule,
  type BuildTaskType,
} from "../scheduled-task/builder.js";
import {
  addScheduledTask,
  listScheduledTasks,
  removeScheduledTask,
} from "../scheduled-task/store.js";
import { scheduledTaskRuntime } from "../scheduled-task/runtime.js";
import {
  getSkill,
  installSkill,
  listSkills,
  removeSkill,
} from "../memory/repositories/skills.js";
import {
  assertValidSkillName,
  writeSkillFile,
  removeSkillFile,
} from "../memory/skill-files.js";
import {
  getDocument,
  setDocument,
  type DocumentName,
} from "../memory/repositories/documents.js";
import { appendAudit, getAudit } from "../memory/repositories/audit.js";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "opencode-assistant-memory";
const SERVER_VERSION = "0.1.0";

const READ_ONLY_DOCUMENT_NAMES = new Set<DocumentName>(["soul", "agents"]);
const WRITABLE_DOCUMENT_NAMES = new Set<DocumentName>([
  "context",
  "session-summary",
  "personality",
]);

/**
 * Definitions of the tools this server exposes to OpenCode.
 *
 * Schemas are conservative — only required fields are marked as such.
 * Names use snake_case for compatibility with how MCP clients typically
 * surface tool calls.
 */
export const MEMORY_TOOLS = [
  {
    name: "memory_read",
    description:
      "Read a memory document by name. Available documents: soul (identity, read-only), agents (agent selection rules, read-only), context (current project, writable), session-summary (cross-session state, writable), personality (user-defined behaviour rules like preferred tone / formality / language, writable).",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          enum: ["soul", "agents", "context", "session-summary", "personality"],
          description: "Document name",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "memory_write",
    description:
      "Write a memory document. Writable documents: context, session-summary, personality. soul and agents are read-only identity files. Use 'personality' to persist user-defined behaviour rules (e.g. \"dime siempre señor\", \"contesta en inglés\", \"responses ≤ 3 lines\") — those are NOT facts and should NOT be saved with fact_add.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          enum: ["context", "session-summary", "personality"],
          description: "Document name (context, session-summary, or personality)",
        },
        content: {
          type: "string",
          description: "Full document content (replaces existing)",
        },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "fact_add",
    description:
      "Persist an atomic fact about the user (a preference, project detail, person, or general fact). Stored in long-term memory and available to future sessions.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The fact text" },
        category: {
          type: "string",
          description:
            "Optional category like 'preference', 'project', 'person', 'fact', 'reminder'.",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "fact_search",
    description:
      "Search the long-term memory for facts whose content matches a substring. Use before answering anything that could depend on user-specific context.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring to search for" },
        category: { type: "string", description: "Optional category filter" },
        limit: { type: "number", description: "Max results (default 50)" },
      },
      required: ["query"],
    },
  },
  {
    name: "fact_recent",
    description:
      "List the most recently updated facts. Useful at the start of a session to get a picture of what the user has been working on.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
  },
  {
    name: "fact_delete",
    description: "Delete a fact by id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Fact id" },
      },
      required: ["id"],
    },
  },
  {
    name: "skill_list",
    description: "List installed skills with their description and category.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Optional category filter" },
      },
    },
  },
  {
    name: "skill_read",
    description: "Read the full SKILL.md content of an installed skill by name.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name (slug)" },
      },
      required: ["name"],
    },
  },
  {
    name: "skill_create",
    description:
      "Create a new skill from markdown content. Writes both the SQLite row and memory/skills/<name>.md so it appears in /listskill, gets inlined in future sessions, and survives DB resets. " +
      "Use this when the user asks you to create or learn a new skill. If the skill needs auxiliary files (e.g. a Python script), use Bash/Write tools to put them next to the .md at memory/skills/<name>/<file>. " +
      "Returns 'already_exists' when the name is taken — call skill_update instead.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Slug-style identifier (lowercase letters, digits, '-' or '_'). 1-64 chars.",
        },
        content: {
          type: "string",
          description:
            "Full SKILL.md content including YAML frontmatter (name, description, optional category/version) and the instructions body.",
        },
        description: {
          type: "string",
          description: "Optional short description (mirrors the frontmatter).",
        },
        category: {
          type: "string",
          description: "Optional category (e.g. 'engineering', 'research').",
        },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "skill_update",
    description:
      "Replace the content of an existing skill. Updates both the SQLite row and memory/skills/<name>.md. Errors when the skill doesn't exist — call skill_create instead.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name (slug)" },
        content: { type: "string", description: "Replacement SKILL.md content." },
        description: {
          type: "string",
          description: "Optional updated short description.",
        },
        category: { type: "string", description: "Optional updated category." },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "skill_delete",
    description:
      "Remove a skill from the registry. Deletes the SQLite row and memory/skills/<name>.md. Auxiliary files in memory/skills/<name>/ are NOT touched — delete them manually if no longer needed.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name (slug)" },
      },
      required: ["name"],
    },
  },
  {
    name: "tts_get_settings",
    description:
      "Read the current TTS configuration (provider, voice, speed, enabled). Use this when the user asks 'what voice is configured?' or before changing any setting so you know the current state.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "tts_set_settings",
    description:
      "Update TTS settings at runtime (persists in settings.json, no restart needed). Use this when the user asks to change voice, speed, provider, or to enable/disable audio replies. " +
      "Validate voice IDs against tts_list_voices first when possible. Edge is the recommended free, no-API-key provider.",
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: ["edge", "openai", "speechify", "google"],
          description:
            "Switch TTS provider. Edge is free with neural voices; the others need API keys configured in .env.",
        },
        voice: {
          type: "string",
          description:
            "Voice ID for the chosen provider. For Edge use ShortName like 'es-ES-ElviraNeural'.",
        },
        speed: {
          type: "number",
          description: "Speed multiplier (0.5..2.0). 1.0 is normal pace.",
        },
        enabled: {
          type: "boolean",
          description: "Master on/off switch for audio replies.",
        },
      },
    },
  },
  {
    name: "tts_list_voices",
    description:
      "List voices available for a TTS provider. Edge has ~400 neural voices in 140+ locales (queried live). Other providers return a curated short list. Filter by locale prefix to narrow down (e.g. 'es' for Spanish).",
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: ["edge", "openai", "speechify", "google"],
          description: "Provider to list. Defaults to current effective provider.",
        },
        locale: {
          type: "string",
          description: "Optional locale prefix (e.g. 'es', 'en-US') to filter voices.",
        },
        limit: {
          type: "number",
          description: "Max voices returned (default 30, max 100).",
        },
      },
    },
  },
  {
    name: "task_create",
    description:
      "Create a scheduled task. Three types: 'task' runs an OpenCode prompt on schedule (needs prompt + project), 'reminder' sends a Telegram message (needs prompt only), 'backup' snapshots memory (no extra args). " +
      "Schedule MUST be either a 5-field cron expression (e.g. '0 9 * * 1-5' for weekdays at 9am) or an ISO datetime for one-shot runs ('2026-05-08T10:00:00'). " +
      "DO NOT pass natural language like 'every 5 minutes' — convert to cron yourself first. " +
      "Cron schedules with intervals < 5 minutes are rejected.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["task", "reminder", "backup"],
        },
        cron: {
          type: "string",
          description:
            "Five-field cron expression. Use this OR runAt, not both. Example: '0 9 * * *'.",
        },
        runAt: {
          type: "string",
          description:
            "ISO 8601 datetime for one-shot tasks. Use this OR cron. Example: '2026-05-08T10:00:00'.",
        },
        timezone: {
          type: "string",
          description:
            "IANA timezone (e.g. 'America/Bogota'). Defaults to system timezone.",
        },
        prompt: {
          type: "string",
          description:
            "For type=task: the prompt to send to OpenCode. For type=reminder: the message text shown to the user.",
        },
        scheduleSummary: {
          type: "string",
          description:
            "Optional human-readable label shown in /tasklist. Defaults to a derived summary.",
        },
        projectId: {
          type: "string",
          description:
            "OpenCode project id. Optional for type=reminder/backup; required for type=task unless a current project is selected in settings.",
        },
        projectWorktree: {
          type: "string",
          description:
            "Filesystem path of the project worktree. Same constraints as projectId.",
        },
      },
      required: ["type"],
    },
  },
  {
    name: "task_list",
    description:
      "List all scheduled tasks with their next run, type, schedule summary, and prompt/message.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["task", "reminder", "backup"],
          description: "Optional type filter.",
        },
      },
    },
  },
  {
    name: "task_delete",
    description: "Cancel a scheduled task by id. Removes both the stored row and the running timer.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "audit_recent",
    description: "List the most recent memory audit log entries (installs, fact changes, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        event: { type: "string", description: "Optional event type filter" },
        limit: { type: "number", description: "Max results (default 50)" },
      },
    },
  },
] as const;

interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export const handleRequest: RequestHandler = async (request: JsonRpcRequest) => {
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      };

    case "initialized":
    case "notifications/initialized":
      // Notifications: no return value (handled by transport).
      return undefined;

    case "ping":
      return {};

    case "tools/list":
      return { tools: MEMORY_TOOLS };

    case "tools/call":
      return await executeToolCall(request.params as ToolCallParams);

    default:
      throw new RpcError(ErrorCode.MethodNotFound, `Method not found: ${request.method}`);
  }
};

function asJsonContent(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function requireString(args: Record<string, unknown> | undefined, key: string): string {
  if (!args || typeof args[key] !== "string") {
    throw new RpcError(ErrorCode.InvalidParams, `Missing required string argument: ${key}`);
  }
  return args[key] as string;
}

function requireNumber(args: Record<string, unknown> | undefined, key: string): number {
  if (!args || typeof args[key] !== "number") {
    throw new RpcError(ErrorCode.InvalidParams, `Missing required number argument: ${key}`);
  }
  return args[key] as number;
}

async function executeToolCall(params: ToolCallParams | undefined): Promise<unknown> {
  if (!params || typeof params.name !== "string") {
    throw new RpcError(ErrorCode.InvalidParams, "tools/call requires a 'name' parameter");
  }

  const args = params.arguments;

  switch (params.name) {
    case "memory_read": {
      const name = requireString(args, "name") as DocumentName;
      const doc = getDocument(name);
      return asJsonContent(doc ?? { name, content: "", missing: true });
    }

    case "memory_write": {
      const name = requireString(args, "name") as DocumentName;
      if (READ_ONLY_DOCUMENT_NAMES.has(name)) {
        throw new RpcError(
          ErrorCode.InvalidParams,
          `Document '${name}' is read-only and cannot be written via memory_write`,
        );
      }
      if (!WRITABLE_DOCUMENT_NAMES.has(name)) {
        throw new RpcError(
          ErrorCode.InvalidParams,
          `Unknown writable document: ${name}`,
        );
      }
      const content = requireString(args, "content");
      const doc = setDocument(name, content);
      appendAudit("document_updated", { name, length: content.length, source: "mcp" });
      return asJsonContent({ ok: true, name: doc.name, updatedAt: doc.updatedAt });
    }

    case "fact_add": {
      const content = requireString(args, "content");
      const category =
        args && typeof args.category === "string" ? (args.category as string) : null;
      const fact = addFact({ content, category, source: "opencode" });
      appendAudit("fact_added", { id: fact.id, category: fact.category });
      return asJsonContent(fact);
    }

    case "fact_search": {
      const query = requireString(args, "query");
      const category =
        args && typeof args.category === "string" ? (args.category as string) : undefined;
      const limit = args && typeof args.limit === "number" ? (args.limit as number) : undefined;

      const driver = getEmbeddingDriver();
      if (driver) {
        try {
          const queryVec = await driver.embedOne(query);
          const results = searchFactsByVector(queryVec, { limit, category });
          return asJsonContent({ count: results.length, results, mode: "vector" });
        } catch (err) {
          logger.warn(
            `[MCP] Vector search failed, falling back to LIKE: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      const results = searchFacts(query, { category, limit });
      return asJsonContent({ count: results.length, results, mode: "like" });
    }

    case "fact_recent": {
      const limit = args && typeof args.limit === "number" ? (args.limit as number) : 20;
      const results = getRecentFacts(limit);
      return asJsonContent({ count: results.length, results });
    }

    case "fact_delete": {
      const id = requireNumber(args, "id");
      const ok = deleteFact(id);
      appendAudit("fact_deleted", { id, deleted: ok });
      return asJsonContent({ id, deleted: ok });
    }

    case "skill_list": {
      const category =
        args && typeof args.category === "string" ? (args.category as string) : undefined;
      const items = listSkills({ category }).map((s) => ({
        name: s.name,
        description: s.description,
        category: s.category,
        version: s.version,
        sourceUrl: s.sourceUrl,
        requiresEnv: s.requiresEnv,
        requiresBins: s.requiresBins,
      }));
      return asJsonContent({ count: items.length, skills: items });
    }

    case "skill_read": {
      const name = requireString(args, "name");
      const skill = getSkill(name);
      if (!skill) {
        throw new RpcError(ErrorCode.InvalidParams, `Skill not found: ${name}`);
      }
      return asJsonContent(skill);
    }

    case "skill_create": {
      const name = requireString(args, "name");
      const content = requireString(args, "content");
      const description =
        args && typeof args.description === "string" ? (args.description as string) : null;
      const category =
        args && typeof args.category === "string" ? (args.category as string) : null;

      try {
        assertValidSkillName(name);
      } catch (err) {
        throw new RpcError(
          ErrorCode.InvalidParams,
          err instanceof Error ? err.message : String(err),
        );
      }

      if (getSkill(name)) {
        throw new RpcError(
          ErrorCode.InvalidParams,
          `Skill "${name}" already exists. Use skill_update to replace it.`,
        );
      }

      const skill = installSkill({ name, content, description, category });
      await writeSkillFile(name, content);
      appendAudit("skill_installed", { name, source: "opencode_mcp", category });
      return asJsonContent({
        ok: true,
        name: skill.name,
        installedAt: skill.installedAt,
        sha256: skill.sha256,
      });
    }

    case "skill_update": {
      const name = requireString(args, "name");
      const content = requireString(args, "content");
      const description =
        args && typeof args.description === "string" ? (args.description as string) : null;
      const category =
        args && typeof args.category === "string" ? (args.category as string) : null;

      try {
        assertValidSkillName(name);
      } catch (err) {
        throw new RpcError(
          ErrorCode.InvalidParams,
          err instanceof Error ? err.message : String(err),
        );
      }

      const existing = getSkill(name);
      if (!existing) {
        throw new RpcError(
          ErrorCode.InvalidParams,
          `Skill "${name}" not found. Use skill_create to add it.`,
        );
      }

      const skill = installSkill({
        name,
        content,
        description: description ?? existing.description,
        category: category ?? existing.category,
      });
      await writeSkillFile(name, content);
      appendAudit("skill_updated", { name, source: "opencode_mcp" });
      return asJsonContent({
        ok: true,
        name: skill.name,
        updatedAt: skill.updatedAt,
        sha256: skill.sha256,
      });
    }

    case "skill_delete": {
      const name = requireString(args, "name");

      try {
        assertValidSkillName(name);
      } catch (err) {
        throw new RpcError(
          ErrorCode.InvalidParams,
          err instanceof Error ? err.message : String(err),
        );
      }

      const removed = removeSkill(name);
      if (!removed) {
        throw new RpcError(ErrorCode.InvalidParams, `Skill "${name}" not found.`);
      }
      await removeSkillFile(name);
      appendAudit("skill_removed", { name, source: "opencode_mcp" });
      return asJsonContent({ ok: true, name });
    }

    case "task_create": {
      const type = requireString(args, "type") as BuildTaskType;
      if (!["task", "reminder", "backup"].includes(type)) {
        throw new RpcError(
          ErrorCode.InvalidParams,
          `type must be one of: task, reminder, backup`,
        );
      }

      const cron =
        args && typeof args.cron === "string" ? (args.cron as string) : undefined;
      const runAt =
        args && typeof args.runAt === "string" ? (args.runAt as string) : undefined;
      const timezone =
        args && typeof args.timezone === "string" ? (args.timezone as string) : undefined;
      const prompt =
        args && typeof args.prompt === "string" ? (args.prompt as string) : undefined;
      const scheduleSummary =
        args && typeof args.scheduleSummary === "string"
          ? (args.scheduleSummary as string)
          : undefined;
      const explicitProjectId =
        args && typeof args.projectId === "string" ? (args.projectId as string) : undefined;
      const explicitProjectWorktree =
        args && typeof args.projectWorktree === "string"
          ? (args.projectWorktree as string)
          : undefined;

      if ((cron && runAt) || (!cron && !runAt)) {
        throw new RpcError(
          ErrorCode.InvalidParams,
          "Provide exactly one of `cron` or `runAt`.",
        );
      }

      // For type=task we need a real project + model. For reminder/backup
      // we still pass them through (the runtime expects them on the row),
      // but we accept the current values as fallback.
      const project = getCurrentProject();
      const projectId = explicitProjectId ?? project?.id;
      const projectWorktree = explicitProjectWorktree ?? project?.worktree;
      if (!projectId || !projectWorktree) {
        throw new RpcError(
          ErrorCode.InvalidParams,
          "No project selected. Pass projectId + projectWorktree, or have the user run /projects first.",
        );
      }

      const currentModel = getCurrentModel();
      if (!currentModel) {
        throw new RpcError(
          ErrorCode.InvalidParams,
          "No model selected. Have the user run /model first.",
        );
      }

      // Enforce the global task limit before doing the (cheap) build.
      const existing = listScheduledTasks();
      if (existing.length >= getScheduledTaskLimit()) {
        throw new RpcError(
          ErrorCode.InvalidParams,
          `Task limit reached (${existing.length}/${getScheduledTaskLimit()}). Delete an old task first.`,
        );
      }

      const schedule: BuildSchedule = cron
        ? { kind: "cron", cron, timezone }
        : { kind: "once", runAt: runAt as string, timezone };

      let task;
      try {
        task = buildScheduledTask({
          type,
          schedule,
          projectId,
          projectWorktree,
          model: {
            providerID: currentModel.providerID,
            modelID: currentModel.modelID,
            variant: currentModel.variant ?? null,
          },
          prompt,
          scheduleSummary,
        });
      } catch (err) {
        if (err instanceof TaskBuilderError) {
          throw new RpcError(ErrorCode.InvalidParams, err.message);
        }
        throw err;
      }

      await addScheduledTask(task);
      scheduledTaskRuntime.registerTask(task);
      appendAudit("task_created", {
        id: task.id,
        type: task.type,
        kind: task.kind,
        nextRunAt: task.nextRunAt,
        source: "opencode_mcp",
      });

      return asJsonContent({
        ok: true,
        id: task.id,
        type: task.type,
        scheduleSummary: task.scheduleSummary,
        nextRunAt: task.nextRunAt,
        kind: task.kind,
      });
    }

    case "task_list": {
      const filter =
        args && typeof args.type === "string"
          ? (args.type as BuildTaskType)
          : undefined;
      const all = listScheduledTasks();
      const filtered = filter ? all.filter((t) => t.type === filter) : all;
      return asJsonContent({
        count: filtered.length,
        tasks: filtered.map((t) => ({
          id: t.id,
          type: t.type,
          kind: t.kind,
          scheduleSummary: t.scheduleSummary,
          nextRunAt: t.nextRunAt,
          lastRunAt: t.lastRunAt,
          lastStatus: t.lastStatus,
          runCount: t.runCount,
          prompt: t.prompt,
        })),
      });
    }

    case "task_delete": {
      const id = requireString(args, "id");
      const removed = await removeScheduledTask(id);
      if (!removed) {
        throw new RpcError(ErrorCode.InvalidParams, `Task not found: ${id}`);
      }
      scheduledTaskRuntime.removeTask(id);
      appendAudit("task_deleted", { id, source: "opencode_mcp" });
      return asJsonContent({ ok: true, id });
    }

    case "audit_recent": {
      const event =
        args && typeof args.event === "string" ? (args.event as string) : undefined;
      const limit = args && typeof args.limit === "number" ? (args.limit as number) : 50;
      const entries = getAudit({ event, limit });
      return asJsonContent({ count: entries.length, entries });
    }

    case "tts_get_settings": {
      const eff = getEffectiveTtsConfig();
      return asJsonContent({
        enabled: isTtsEnabled(),
        provider: eff.provider,
        voice: eff.voice,
        speed: eff.speed,
        source: eff.source,
      });
    }

    case "tts_set_settings": {
      const allowed: Set<TtsProvider> = new Set([
        "edge",
        "openai",
        "speechify",
        "google",
      ]);

      const provider =
        args && typeof args.provider === "string"
          ? (args.provider as TtsProvider)
          : undefined;
      const voice =
        args && typeof args.voice === "string" ? (args.voice as string) : undefined;
      const speed =
        args && typeof args.speed === "number" ? (args.speed as number) : undefined;
      const enabled =
        args && typeof args.enabled === "boolean" ? (args.enabled as boolean) : undefined;

      if (provider !== undefined && !allowed.has(provider)) {
        throw new RpcError(
          ErrorCode.InvalidParams,
          `Invalid provider "${provider}". Valid: edge, openai, speechify, google.`,
        );
      }

      if (provider !== undefined) {
        // Block silently-broken providers (no credentials) so the model
        // doesn't pick e.g. "speechify" on an install with no key.
        const hasCreds =
          provider === "edge"
            ? true
            : provider === "google"
              ? Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS)
              : provider === "speechify"
                ? Boolean(config.tts.speechifyApiKey)
                : Boolean(config.tts.apiUrl && config.tts.apiKey);
        if (!hasCreds) {
          throw new RpcError(
            ErrorCode.InvalidParams,
            `Provider "${provider}" has no credentials configured. Use "edge" for a free fallback.`,
          );
        }
      }

      if (speed !== undefined && (!Number.isFinite(speed) || speed < 0.5 || speed > 2.0)) {
        throw new RpcError(
          ErrorCode.InvalidParams,
          "speed must be a finite number between 0.5 and 2.0",
        );
      }

      if (voice !== undefined) {
        const targetProvider = provider ?? getEffectiveTtsConfig().provider;
        let known: string[] = [];
        if (targetProvider === "edge") {
          try {
            known = (await listEdgeVoices()).map((v) => v.id);
          } catch {
            known = [];
          }
        } else if (targetProvider !== "openai") {
          known = STATIC_VOICES[targetProvider].map((v) => v.id);
        }
        // openai accepts arbitrary voice ids → don't validate.
        if (
          targetProvider !== "openai" &&
          known.length > 0 &&
          !known.includes(voice)
        ) {
          throw new RpcError(
            ErrorCode.InvalidParams,
            `Voice "${voice}" not found for provider "${targetProvider}". Use tts_list_voices to discover valid IDs.`,
          );
        }
      }

      const current = getUiPreferences().tts ?? {};
      const next = {
        ...current,
        ...(provider !== undefined ? { provider } : {}),
        ...(voice !== undefined ? { voice } : {}),
        ...(speed !== undefined ? { speed } : {}),
      };
      await setUiPreferences({ tts: next });

      if (enabled !== undefined) {
        await setTtsEnabled(enabled);
      }

      const eff = getEffectiveTtsConfig();
      appendAudit("tts_settings_updated", {
        provider: eff.provider,
        voice: eff.voice,
        speed: eff.speed,
        enabled: isTtsEnabled(),
        source: "opencode_mcp",
      });
      return asJsonContent({
        ok: true,
        enabled: isTtsEnabled(),
        provider: eff.provider,
        voice: eff.voice,
        speed: eff.speed,
      });
    }

    case "tts_list_voices": {
      const provider =
        args && typeof args.provider === "string"
          ? (args.provider as TtsProvider)
          : getEffectiveTtsConfig().provider;
      const localePrefix =
        args && typeof args.locale === "string"
          ? (args.locale as string).toLowerCase()
          : undefined;
      const requestedLimit =
        args && typeof args.limit === "number" ? (args.limit as number) : 30;
      const limit = Math.max(1, Math.min(100, requestedLimit));

      let voices: { id: string; name: string; locale: string; gender: string }[];
      if (provider === "edge") {
        try {
          voices = await listEdgeVoices();
        } catch (err) {
          throw new RpcError(
            ErrorCode.InternalError,
            `Failed to fetch Edge voices: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        voices = STATIC_VOICES[provider];
      }

      let filtered = voices;
      if (localePrefix) {
        filtered = voices.filter((v) => v.locale.toLowerCase().startsWith(localePrefix));
      }
      const truncated = filtered.slice(0, limit);
      return asJsonContent({
        provider,
        total: filtered.length,
        returned: truncated.length,
        voices: truncated,
      });
    }

    default:
      throw new RpcError(ErrorCode.MethodNotFound, `Unknown tool: ${params.name}`);
  }
}

/**
 * Boots the MCP server: runs migration if needed, starts the JSON-RPC loop.
 * Used by the CLI entrypoint (`dist/mcp/memory-server.js`).
 */
export async function startMemoryMcpServer(
  options: TransportOptions = {},
): Promise<TransportHandle> {
  await migrateFromFiles();
  const handle = startStdioServer(handleRequest, options);
  logger.info(
    `[MCP/Memory] Server ready: ${SERVER_NAME} v${SERVER_VERSION} (protocol ${MCP_PROTOCOL_VERSION})`,
  );
  return handle;
}
