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
import {
  getDocument,
  setDocument,
  type DocumentName,
} from "../memory/repositories/documents.js";
import { getSkill, listSkills } from "../memory/repositories/skills.js";
import { appendAudit, getAudit } from "../memory/repositories/audit.js";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "opencode-assistant-memory";
const SERVER_VERSION = "0.1.0";

const READ_ONLY_DOCUMENT_NAMES = new Set<DocumentName>(["soul", "agents"]);

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
      "Read a memory document by name. Available documents: soul (identity), agents (agent selection rules), context (current project), session-summary (cross-session state).",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          enum: ["soul", "agents", "context", "session-summary"],
          description: "Document name",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "memory_write",
    description:
      "Write a memory document. Only context and session-summary are writable; soul and agents are read-only identity files.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          enum: ["context", "session-summary"],
          description: "Document name (context or session-summary only)",
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
      return executeToolCall(request.params as ToolCallParams);

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

function executeToolCall(params: ToolCallParams | undefined): unknown {
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
      if (name !== "context" && name !== "session-summary") {
        throw new RpcError(
          ErrorCode.InvalidParams,
          `Unknown writable document: ${name}`,
        );
      }
      const content = requireString(args, "content");
      const doc = setDocument(name, content);
      appendAudit("document_updated", { name, length: content.length });
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
      const results = searchFacts(query, { category, limit });
      return asJsonContent({ count: results.length, results });
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

    case "audit_recent": {
      const event =
        args && typeof args.event === "string" ? (args.event as string) : undefined;
      const limit = args && typeof args.limit === "number" ? (args.limit as number) : 50;
      const entries = getAudit({ event, limit });
      return asJsonContent({ count: entries.length, entries });
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
