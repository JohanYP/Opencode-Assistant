# `opencode-assistant` CLI

A small bash wrapper installed as `/usr/local/bin/opencode-assistant` by
`setup.sh`. Works from anywhere on the host — it locates the repo from
the symlink target, so you don't have to `cd` into the project to use it.

If `setup.sh` couldn't install the symlink (no sudo at the time), do it
manually once:

```bash
sudo ln -sf $(pwd)/bin/opencode-assistant /usr/local/bin/opencode-assistant
```

## Quick reference

| Command | What it does |
|---|---|
| `opencode-assistant --version` | Show repo + container versions, flag pending updates |
| `opencode-assistant --update` | Smart update: backup → fetch → rebuild only what changed |
| `opencode-assistant --status` | Containers up/down + MCP connectivity + memory size |
| `opencode-assistant --logs [service] [--tail N]` | Tail logs (`bot`, `opencode`, `workspace-mcp`) |
| `opencode-assistant --backup` | Snapshot memory + configs to `backups/` |
| `opencode-assistant --restore <file>` | Restore from a `.tar.gz` snapshot |
| `opencode-assistant --doctor` | Run automatic diagnostics, surface what's broken |
| `opencode-assistant --help` | This summary |

## `--update` — smart update

What it does, in order:

1. Creates a safety backup automatically (same as `--backup --quiet`).
2. `git fetch origin`.
3. Compares your `HEAD` to `origin/main` and decides what to rebuild:
   - Changed `src/`, `package*.json`, `tsconfig.json`, `Dockerfile`, or `docker-compose.yml` → rebuild **bot**.
   - Changed `Dockerfile.opencode` or `docker/opencode-entrypoint.sh` → rebuild **opencode**.
   - Changed `Dockerfile.workspace-mcp` (if you have the side-car) → rebuild **workspace-mcp**.
   - Changed `src/mcp/` (new MCP tools added) → restart **opencode** (no rebuild) so it re-fetches the tool list.
   - Anything else (docs, README, GitHub Actions) → no rebuild needed.
4. `git pull --ff-only`.
5. Rebuilds only the services that need it (`docker compose up -d --build <service>` for each).
6. Waits a few seconds and verifies the bot came back up.

What it deliberately doesn't do:
- ❌ It does **not** run `docker compose down`. The other services keep running through the update.
- ❌ It does **not** prompt for confirmation on docs-only or minor changes.
- ❌ It does **not** touch your `.env`, your memory directory, or your MCP credentials.

If the post-update healthcheck fails, the script tells you and the auto-backup is sitting in `backups/` ready for `--restore`.

## `--version` — what's installed

```
Opencode-Assistant v0.19.0 (commit abc1234)

  Bot:           ✓ running
  OpenCode:      ✓ running (1.14.33)
  Workspace MCP: ✓ running (v3.2.4)

  ⚠ 2 commit(s) ahead in origin/main — run `opencode-assistant --update`
```

The line at the bottom only appears when there's an update available. It runs `git fetch` against `origin/main` so on a fresh boot it can take a couple of seconds.

## `--status` — health snapshot

Combines what you'd otherwise get from three or four `docker compose ps`/`exec` invocations:

- Compose `ps` table (bot, opencode)
- Side-car `workspace-mcp` if installed
- MCP probes from inside the `opencode` container (memory, google-workspace) — confirms the network wiring works end-to-end
- Memory directory size + counts of facts and skills (reads SQLite directly)
- Backup directory inventory

Use it when "did my deploy survive that update" is the question.

## `--logs [service] [--tail N]`

Convenience wrapper. Defaults to `bot` and `--tail 100`.

```bash
opencode-assistant --logs                       # bot, last 100, follow
opencode-assistant --logs opencode --tail 200
opencode-assistant --logs workspace-mcp         # the side-car (separate compose)
```

Equivalent to `docker compose logs -f --tail=N <service>` (or `docker logs` for the side-car).

## `--backup` — snapshot

Generates `backups/opencode-assistant-YYYYMMDD-HHMMSS.tar.gz` containing:

- `memory/` (skills, soul, agents, the SQLite database)
- The `opencode-config` Docker volume (your `opencode.json` with all configured MCPs)
- The `workspace-mcp-data` volume if it exists (Google OAuth credentials)
- Your `.env` and `.env.workspace`

The tar uses gzip and is typically 1–10 MB depending on how much you've stored.

`--update` calls this with `--quiet` automatically, so a backup happens before every update without you thinking about it.

## `--restore <file>` — bring a snapshot back

```bash
opencode-assistant --restore backups/opencode-assistant-20260505-143200.tar.gz
```

The script:
1. Asks you to type the literal word `restore` to confirm (it's destructive).
2. `docker compose down` (and the workspace compose if it exists).
3. Extracts the tar, replaces `memory/`, restores volumes, restores `.env` files.
4. `docker compose up -d` again.

If you call it without an argument it just lists the available backups.

## `--doctor` — automatic diagnostics

A checklist that runs through the most common failure modes and flags whichever ones are broken. It checks:

- Docker installed + daemon responding
- `.env` exists with a non-empty `TELEGRAM_BOT_TOKEN`
- `bot` and `opencode` containers running
- `opencode.json` is valid JSON
- `opencode` can reach the memory MCP (`http://bot:4097/mcp/`)
- Embedding provider reachable (only if `EMBEDDING_BASE_URL` is configured)
- `workspace-mcp` reachable + has stored credentials (only if installed)

Each check prints `✓` or `✗`. At the end you get a count of failures and an actionable hint.

## Manual smoke tests

Useful drills if you change anything in the CLI itself:

```bash
# Should print versions, no errors
bin/opencode-assistant --version

# All ✓
bin/opencode-assistant --status
bin/opencode-assistant --doctor

# Backup round-trip (requires a fresh writable repo)
bin/opencode-assistant --backup
ls -lh backups/
bin/opencode-assistant --restore backups/$(ls backups/ | tail -1)

# Update with no diff: should say "Already up to date"
bin/opencode-assistant --update

# Force a synthetic update target
git reset --hard HEAD~1
bin/opencode-assistant --update     # should fetch + pull + rebuild what's needed
```

## What the CLI does NOT cover

- Initial install — `setup.sh` still owns that. The CLI assumes the repo is cloned, `.env` exists, and Docker is up.
- npm/Node operations — if you're a developer hacking on the bot, you'll still want `npm install`, `npm run build`, `npm test` directly.
- Editing `.env` — by design. Keep secrets out of the CLI.

If a workflow you'd like to automate isn't here yet, open an issue — most candidates are 30–50 LOC of bash on top of what's already in this script.
