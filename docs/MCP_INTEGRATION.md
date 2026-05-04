# MCP Memory Server — Integration Guide

The bot ships a local **MCP server** (`opencode-assistant-memory-mcp`) that
exposes the SQLite-backed memory to OpenCode as tools. With this in place,
OpenCode can read and write memory **at any point during a session**,
instead of receiving a one-shot snapshot at session start.

> **Status (as of writing):** the MCP server is fully implemented and tested.
> Dockerized wiring between the OpenCode container and the bot's MCP server
> is intentionally **NOT wired up yet** — that work is tracked as the next
> step in the project roadmap. This guide documents both how to use the
> server stand-alone today and how the Dockerized wiring will look.

## Protocol

- Spec: <https://spec.modelcontextprotocol.io>
- Transport: stdio (newline-delimited JSON-RPC 2.0)
- Protocol version: `2024-11-05`

## Tools exposed

| Tool | Description |
|---|---|
| `memory_read(name)` | Read `soul`, `agents`, `context`, or `session-summary`. |
| `memory_write(name, content)` | Overwrite `context` or `session-summary`. `soul` and `agents` are read-only. |
| `fact_add(content, category?)` | Persist a long-term fact. |
| `fact_search(query, category?, limit?)` | Substring search over facts. |
| `fact_recent(limit?)` | Most recently updated facts. |
| `fact_delete(id)` | Remove a fact. |
| `skill_list(category?)` | List installed skills with metadata. |
| `skill_read(name)` | Full SKILL.md content for an installed skill. |
| `audit_recent(event?, limit?)` | Recent memory audit log entries. |

## Stand-alone usage

After `npm run build`, the server is available as a binary:

```bash
# Start the server bound to stdio (it reads requests on stdin, writes on stdout):
MEMORY_DIR=./memory node dist/mcp/main.js
```

A first-run on an existing markdown-based memory directory automatically
imports `soul.md` / `agents.md` / `context.md` / `session-summary.md` /
`memory.md` (split into facts) / `skills/*.md` / `cron.yml` into
`memory/data.db`. A backup of the source files is created at
`memory/.pre-sqlite-backup/`.

## OpenCode configuration (planned)

OpenCode discovers MCP servers through `~/.config/opencode/mcp.json`. The
intended configuration once the Dockerized wiring is finalized:

```json
{
  "mcpServers": {
    "opencode-assistant-memory": {
      "command": "node",
      "args": ["/app/dist/mcp/main.js"],
      "env": {
        "MEMORY_DIR": "/workspace/memory"
      }
    }
  }
}
```

The bot's `setup.sh` will populate this file automatically as part of the
guided install (Phase 3 of the roadmap).

## Docker wiring (TODO)

The OpenCode container needs access to:

1. **Node + the MCP server binary**. Options under consideration:
   - Bind-mount the bot's `dist/mcp/` into the OpenCode container.
   - Or build a custom `opencode` image that includes Node + the binary.
2. **Shared `MEMORY_DIR`** between the bot, the MCP server, and the
   OpenCode container so SQLite is the single source of truth.

When this wiring is in place, the migration to SQLite-backed memory
becomes seamless for adopters.

## Manual smoke test

The server can be smoke-tested manually with a JSON-RPC roundtrip on the
command line:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  MEMORY_DIR=/tmp/test-memory node dist/mcp/main.js
```

The output is a single JSON-RPC response listing the 9 tools above.

## Troubleshooting

- **OpenCode does not see the memory tools**: verify that the server
  process actually started by checking the OpenCode log for
  `[MCP/Memory] Server ready`. If the log does not appear, OpenCode is
  probably not invoking the server at all — review `mcp.json`.
- **Schema errors after upgrading the bot**: `data.db` may have been
  written with an older schema. Move it aside and let the migration
  re-import from the markdown sources:
  ```bash
  mv memory/data.db memory/data.db.old
  # restart the bot; the markdown source files are re-imported.
  ```
- **`memory.md` edits not picked up after migration**: by design,
  re-running the migration on a populated DB is a no-op. Use
  `/memory_export` and `/memory_import` (Phase 1.7) to round-trip
  through markdown when needed.
