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

### Memory & facts
| Tool | Description |
|---|---|
| `memory_read(name)` | Read `soul`, `agents`, `context`, `personality`, or `session-summary`. |
| `memory_write(name, content)` | Overwrite `context`, `session-summary`, or `personality`. `soul`/`agents` are read-only identity. |
| `fact_add(content, category?)` | Persist a long-term fact. Triggers a background embedding when a vector driver is configured. |
| `fact_search(query, category?, limit?)` | Vector-ranked search when a driver is set; LIKE substring otherwise. Returns `mode` ("vector"/"like"). |
| `fact_recent(limit?)` | Most recently updated facts. |
| `fact_delete(id)` | Remove a fact. |

### Skills
| Tool | Description |
|---|---|
| `skill_list(category?)` | List installed skills with metadata. |
| `skill_read(name)` | Full SKILL.md content for an installed skill. |
| `skill_create(name, content, description?, category?)` | Register a new skill in SQLite + write `memory/skills/<name>.md`. Errors if name is taken. |
| `skill_update(name, content, description?, category?)` | Replace an existing skill in both SQLite and the .md file. |
| `skill_delete(name)` | Remove a skill (SQLite row + .md file). Auxiliary files in `memory/skills/<name>/` left intact. |

### TTS settings (runtime mutable)
| Tool | Description |
|---|---|
| `tts_get_settings()` | Current effective config (provider, voice, speed, enabled, source of each). |
| `tts_set_settings({provider?, voice?, speed?, enabled?})` | Persist override into `settings.json`. Validates provider (rejects unconfigured), voice catalog (when applicable), speed range. |
| `tts_list_voices({provider?, locale?, limit?})` | Voice catalog. For `edge` it's live-fetched from Microsoft (~400 voices); other providers return curated lists. |

### Scheduled tasks
| Tool | Description |
|---|---|
| `task_create({type, cron|runAt, prompt?, projectId?, projectWorktree?, timezone?, scheduleSummary?})` | Create a `task` (LLM run), `reminder` (Telegram message), or `backup` (memory snapshot). Pass exactly one of `cron` or `runAt`. Cron < 5-min interval is rejected. Falls back to current project/model when not specified. |
| `task_list({type?})` | List all scheduled tasks with their next run, last status, run count. Optional type filter. |
| `task_delete({id})` | Cancel a task — removes the row and the running timer. |

### Audit
| Tool | Description |
|---|---|
| `audit_recent(event?, limit?)` | Recent memory audit log entries (skill installs, fact mutations, tts changes, task lifecycle, etc.). |

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

The entrypoint **merges** the memory MCP entry into your `opencode.json`
without touching the rest of the file, so any extra MCP servers you
add by hand (GitHub, Google Workspace, custom auth-requiring servers)
survive every container rebuild.

## Adding third-party MCP servers (with credentials)

Because the entrypoint preserves user-added servers, you can extend
the catalogue safely. Two patterns:

### A. stdio MCP server (most npm-based MCPs)

Many community MCP servers ship as `npx` packages. Example: GitHub.

1. Add the credential to `.env`:
   ```bash
   GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx...
   ```

2. Pass it through to the opencode container in `docker-compose.yml`:
   ```yaml
   services:
     opencode:
       environment:
         - ASSISTANT_MEMORY_MCP_URL=http://bot:4097/mcp
         - GITHUB_PERSONAL_ACCESS_TOKEN=${GITHUB_PERSONAL_ACCESS_TOKEN}
   ```

3. Inside the running opencode container, append the server to
   `opencode.json` once — the entrypoint won't undo this:
   ```bash
   docker compose exec opencode sh -c '
   jq ".mcp.github = {
     type: \"local\",
     command: [\"npx\", \"-y\", \"@modelcontextprotocol/server-github\"],
     env: { GITHUB_PERSONAL_ACCESS_TOKEN: \"$GITHUB_PERSONAL_ACCESS_TOKEN\" }
   }" /root/.config/opencode/opencode.json > /tmp/oc.json && mv /tmp/oc.json /root/.config/opencode/opencode.json'
   docker compose restart opencode
   ```

4. Verify in the opencode logs that the server is loaded; from a
   Telegram session ask the assistant to use the new tools.

### B. Remote (HTTP) MCP server

If the third-party server runs as its own service and exposes an HTTP
endpoint:

```bash
docker compose exec opencode sh -c '
jq ".mcp[\"my-remote\"] = {
  type: \"remote\",
  url: \"https://my-mcp.example.com/mcp\"
}" /root/.config/opencode/opencode.json > /tmp/oc.json && mv /tmp/oc.json /root/.config/opencode/opencode.json'
docker compose restart opencode
```

### Things to watch for

- **OAuth flows**: most MCP servers that integrate with Google
  Workspace etc. require a one-time browser login to mint a refresh
  token, then store it. Run that login on the host or in a separate
  step before configuring the MCP server in the container.
- **Token rotation**: if a token expires, the assistant will start
  getting "invalid tool" or auth errors. Re-issue the token, update
  `.env`, and restart.
- **No native bot UX yet**: there's no `/mcp_install` command in
  Telegram. Adding/removing third-party servers is a host-side
  operation. A guided flow is on the roadmap.

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
