# MCP Memory Server — Integration Guide

The bot exposes a local **MCP server** that surfaces the SQLite-backed
memory layer to OpenCode as tools. With this in place OpenCode reads
and writes memory **at any point during a session**, instead of
receiving a one-shot snapshot at session start.

## Architecture

```
┌──────────────────────────┐         ┌────────────────────────────┐
│   bot container          │         │   opencode container       │
│                          │         │                            │
│  Telegram <-> grammY     │         │   opencode serve           │
│      │                   │         │      │                     │
│      ▼                   │         │      ▼                     │
│  SQLite (memory/data.db) │         │   reads ~/.config/opencode │
│      ▲                   │         │     /mcp.json              │
│      │                   │         │      │                     │
│  MCP HTTP server :4097   │ <─────  │   POST  http://bot:4097/mcp│
│  (handleRequest dispatch)│  HTTP   │   (JSON-RPC 2.0)           │
└──────────────────────────┘         └────────────────────────────┘

Both containers share the docker compose network. Port 4097 is
exposed only on that network — it is NOT forwarded to the host.
```

The bot runs the MCP server as an HTTP endpoint inside the bot
process, sharing the same SQLite connection used by the bot commands.
The opencode container's entrypoint script writes
`~/.config/opencode/opencode.json` from the `ASSISTANT_MEMORY_MCP_URL`
environment variable, so OpenCode discovers the server automatically
through its native config format (top-level `mcp` key, entries with
`type: "remote"` for HTTP transport).

## Protocol

- Spec: <https://spec.modelcontextprotocol.io>
- Transport: plain HTTP POST + JSON-RPC 2.0 (path: `/mcp`)
- Health probe: `GET /` returns `{"ok":true}`
- Protocol version reported in `initialize`: `2024-11-05`

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

## Configuration

In Docker compose (default):

- The bot listens on `0.0.0.0:4097/mcp` inside its container.
  Customizable via env vars on the bot:
  - `MCP_HTTP_ENABLED=true` (default `true`)
  - `MCP_HTTP_PORT=4097` (default `4097`)
  - `MCP_HTTP_HOST=0.0.0.0` (default `0.0.0.0`)
- The opencode container receives `ASSISTANT_MEMORY_MCP_URL=http://bot:4097/mcp`
  via `docker-compose.yml`, and `docker/opencode-entrypoint.sh` writes the
  matching `opencode.json` on container start. The format follows the
  OpenCode v1.14+ schema:
  ```json
  {
    "mcp": {
      "opencode-assistant-memory": {
        "type": "remote",
        "url": "http://bot:4097/mcp"
      }
    }
  }
  ```

If you provide your own `opencode.json` in the `opencode-config` volume,
the entrypoint will leave it alone — your config wins.

## Verifying the wiring

After `docker compose up -d --build`:

1. Confirm both containers are healthy:
   ```bash
   docker compose ps
   docker compose logs --tail 20 bot | grep "MCP/HTTP"
   ```
   The bot log should contain
   `[MCP/HTTP] Memory MCP server listening on http://0.0.0.0:4097/mcp`.

2. From the host, prove the MCP endpoint is reachable from inside the
   compose network:
   ```bash
   docker compose exec opencode \
     curl -s -X POST http://bot:4097/mcp \
       -H 'Content-Type: application/json' \
       -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```
   Expect a JSON-RPC response listing the nine tools above.

3. Confirm OpenCode picked up the config:
   ```bash
   docker compose exec opencode cat /root/.config/opencode/opencode.json
   ```

4. Open a Telegram session and ask the assistant something that
   needs persistent memory ("¿qué sabes de mí?", "lista mis skills
   instaladas"). It should call `fact_recent` or `skill_list` instead of
   replying that it has no memory.

## Stand-alone (legacy stdio) usage

Independent of the HTTP server, the bot still ships a stdio MCP server
binary (`opencode-assistant-memory-mcp` → `dist/mcp/main.js`) for tools
that can spawn an MCP server as a child process. After `npm run build`:

```bash
# Smoke test:
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  MEMORY_DIR=./memory node dist/mcp/main.js
```

The HTTP path is preferred for the in-Docker integration; the stdio
binary is mostly there for compatibility with MCP clients that only
support spawn-based servers.

## Troubleshooting

- **OpenCode does not see the memory tools**:
  - `docker compose logs bot | grep MCP/HTTP` — should show "listening on …".
    If missing, the bot did not start the server (check for `MCP_HTTP_ENABLED=false`
    in `.env`).
  - `docker compose exec opencode cat /root/.config/opencode/opencode.json`
    — should contain a top-level `mcp.opencode-assistant-memory` entry
    with `type: "remote"`. If missing, re-check `ASSISTANT_MEMORY_MCP_URL`
    in `docker-compose.yml`.
  - If you upgraded from an earlier version that wrote `mcp.json` instead
    of `opencode.json`: the entrypoint cleans the legacy file up
    automatically on next start. If for some reason it persists, delete
    it manually: `docker compose exec opencode rm -f /root/.config/opencode/mcp.json`.
  - `docker compose exec opencode wget -qO- http://bot:4097/` —
    should print `{"ok":true}`. If it fails, the compose network is not
    routing as expected.
- **Schema errors after upgrading the bot**: `data.db` may have been
  written with an older schema. Move it aside and let the migration
  re-import from the markdown sources:
  ```bash
  mv memory/data.db memory/data.db.old
  # restart the bot; the markdown source files are re-imported.
  ```
- **`memory.md` edits not picked up after migration**: by design,
  re-running the migration on a populated DB is a no-op. Use
  `/memory_export` and `/memory_import` to round-trip through markdown
  when needed.
- **Health probe returns 200 but tool calls return 404**: you are
  hitting a different path. The handler is mounted at `/mcp`. Adjust
  `ASSISTANT_MEMORY_MCP_URL` to include the path.
