# Troubleshooting

Practical diagnostics for the most common problems. Each entry has the
**symptom** you see, the **cause**, and a **fix** you can copy-paste.

> Convention: all commands assume you are inside the cloned repo
> directory on the host running Docker Compose.

## Quick health snapshot

Before deep diving, run this:

```bash
docker compose ps
docker compose logs --tail 30 bot opencode | head -120
```

Both services should show `Up`. Anything reporting `Restarting` or
`Exited` is the first thing to chase.

---

## Bot doesn't respond in Telegram

**Symptom:** you message the bot, no reply, no error.

**Possible causes & fixes:**

1. **Wrong `TELEGRAM_ALLOWED_USER_ID`.** The bot silently ignores anyone
   else. Get your real ID from [@userinfobot](https://t.me/userinfobot)
   and compare against `.env`. Then:
   ```bash
   docker compose logs bot 2>&1 | grep -i "Unauthorized access"
   ```
   shows attempts from IDs that didn't match.

2. **Bot token revoked or wrong.** Recreate via @BotFather, paste into
   `.env`, then `docker compose restart bot`.

3. **Telegram polling stuck.** Restart:
   ```bash
   docker compose restart bot
   ```

---

## "OpenCode server is not running" / `fetch failed`

**Symptom:** bot logs show `[Bot] Error fetching projects: TypeError: fetch failed`,
or in Telegram `OpenCode server is not available`.

**Causes:**

1. **OpenCode container is restarting.** Check:
   ```bash
   docker compose ps
   ```
   If `opencode` shows `Restarting (1)`, dig into its logs:
   ```bash
   docker compose logs --tail 80 opencode
   ```
   Common errors and their fixes are in the next section.

2. **Network configuration.** `OPENCODE_API_URL` should be
   `http://opencode:4096` (compose-network internal address). If you
   changed it to `http://localhost:4096`, the bot container can't reach
   the host's localhost — restore the default.

3. **OpenCode just took a long time to start.** First boot includes a
   one-time DB migration that takes ~30 s. Watch the log; when you see
   `opencode server listening on http://0.0.0.0:4096`, retry.

---

## `error from registry: denied` on `docker compose up`

**Symptom:**

```
[+] Running 1/1
 ✘ opencode Error error from registry: denied
Error response from daemon: error from registry: denied
```

**Cause:** an outdated install referenced `ghcr.io/sst/opencode:latest`,
which is not a published image. The current `Dockerfile.opencode`
builds OpenCode locally from the npm package.

**Fix:**
```bash
git pull
docker compose up -d --build
```

If you forked or vendored the repo, make sure `docker-compose.yml`
references `build: { dockerfile: Dockerfile.opencode }` for the
opencode service, not a registry image.

---

## OpenCode container restarts in a loop with `spawnSync … ENOENT`

**Symptom:**

```
opencode-1 | spawnSync /usr/local/lib/node_modules/opencode-ai/bin/.opencode ENOENT
```

repeating every few seconds; opencode container shows `Restarting (1)`.

**Cause:** `Dockerfile.opencode` was built on Alpine. The
`opencode-ai` npm package ships platform-specific binaries via
`optionalDependencies`; the published binaries link against glibc, so
on musl (Alpine) none match and the wrapper has nothing to spawn.

**Fix:** the project ships a glibc-based image (`node:22-slim`) since
this was identified. Make sure your local `Dockerfile.opencode`
starts with `FROM node:22-slim` (not `:alpine`), then:
```bash
git pull
docker compose down
docker compose up -d --build
```

---

## `Error: Could not locate the bindings file` (better-sqlite3)

**Symptom:** bot logs show

```
Error: Could not locate the bindings file. Tried:
 → /app/node_modules/better-sqlite3/build/Release/better_sqlite3.node
 ...
```

…and the SQLite migration fails on bot startup.

**Cause:** the bot Dockerfile previously used `npm ci --ignore-scripts`,
which skips the postinstall step that builds `better-sqlite3`'s native
`.node` binding.

**Fix:** the multi-stage `Dockerfile` has been restructured to install
build tools (`python3`, `build-essential`) and run `npm ci` with
scripts enabled. After pulling the fix, rebuild:
```bash
git pull
docker compose down
docker compose up -d --build
```

If you're hitting this in a custom build, do not pass
`--ignore-scripts` to npm install for production deps.

---

## OpenCode loads but doesn't see memory tools (`invalid tool` when using fact_add)

**Symptom:** in Telegram, the assistant says something like *"I cannot
save permanently because the memory tools aren't available in this
session"* or you see `invalid tool` errors.

**Cause:** OpenCode reads `~/.config/opencode/opencode.json` (NOT
`mcp.json`, which is a different vendor's convention). The schema
must use a top-level `mcp` key with `type: "remote"` for HTTP-based
MCP servers.

**Diagnose:**
```bash
docker compose exec opencode cat /root/.config/opencode/opencode.json
```

You should see:
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

**Fix paths:**
- If the file doesn't exist or is missing the `mcp` key, the
  entrypoint failed to write it. Check `ASSISTANT_MEMORY_MCP_URL`
  in `docker-compose.yml`. Remove the legacy `mcp.json` if it
  exists:
  ```bash
  docker compose exec opencode rm -f /root/.config/opencode/mcp.json
  docker compose restart opencode
  ```
- If the file is right but the assistant still doesn't call the
  tools, prove the HTTP endpoint is reachable from inside the
  opencode container:
  ```bash
  docker compose exec opencode \
    curl -s -X POST http://bot:4097/mcp \
      -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  ```
  Should return JSON listing 9 tools.

---

## Memory migration failed; bot continues with markdown

**Symptom:**

```
[App] Memory migration failed; continuing with markdown sources: <error>
```

**Cause:** the SQLite DB couldn't be created or opened. Most often a
permissions issue with the `memory/` mount.

**Fix:**

1. Verify the host directory is writable by the container:
   ```bash
   ls -ld memory/
   ```
2. If you're upgrading from an older install, the migration is
   idempotent: if the DB exists with rows, it skips. Delete and let
   it re-run:
   ```bash
   mv memory/data.db memory/data.db.broken
   docker compose restart bot
   docker compose logs bot 2>&1 | grep -i "Memory migrated"
   ```

---

## Assistant doesn't recall facts I saved

**Symptom:** you say *"recuérdame que prefiero TypeScript"*, the bot
saves it. In a new session, *"qué lenguaje prefiero?"* and the
assistant says it doesn't know.

**Causes & fixes:**

1. **Old session.** Each session has a cached system prompt. New facts
   only land in **new** sessions. Use `/new` to start a fresh one.
2. **Fact older than the inline window.** The first 20 facts get
   inlined into the new-session system prompt automatically. Older
   facts require the model to call `fact_search`. If yours is older,
   `/memory_search <keyword>` from your side proves it's in the DB;
   if the model still doesn't pull it, ask explicitly: *"check the
   memory tools and tell me the answer"*.
3. **Duplicates accumulating.** `addFact` deduplicates exact
   `(content, category)` matches. If category was set differently
   each time, you'll see multiple entries for the same content.
   Clean with `/memory_search azul` then `/memory_remove <id>` for the
   stale ones.

---

## Skills not appearing in `/listskill`

**Symptom:** you ran `/skill_install <url>` but `/listskill` does not
show the new skill.

**Causes:**

1. **Install failed silently.** The `/skill_install` command shows the
   slug it used; if you didn't get a confirmation, look at:
   ```bash
   docker compose logs bot 2>&1 | grep -i "skill_install"
   ```
2. **You dropped a `.md` file into `memory/skills/` directly.** That
   path is no longer the source of truth. Skills live in SQLite. Use
   `/skill_install <url>` (or copy the file content and paste into a
   raw URL host).

---

## Update flow

**To pull new bot code and rebuild:**

```bash
git pull
docker compose down
docker compose up -d --build
```

**If `git pull` rejects because you've edited a tracked file (e.g.
`memory/soul.md` with your customization):**

```bash
# 1. backup your customization
cp memory/soul.md memory/soul.md.mio.backup

# 2. discard local changes so pull works
git checkout memory/soul.md

# 3. pull
git pull

# 4. compare and re-apply your custom bits
diff memory/soul.md memory/soul.md.mio.backup
```

The startup hook resyncs `memory/soul.md` and `memory/agents.md` to
SQLite on every restart, so editing those files (and restarting) is
the supported customization path.

---

## Where to look first when something is wrong

| Where | Command |
|---|---|
| Bot startup, MCP server, memory migration | `docker compose logs --tail 100 bot` |
| OpenCode startup, MCP discovery | `docker compose logs --tail 100 opencode` |
| Real-time tail of both | `docker compose logs -f bot opencode` |
| What's in the SQLite memory | `/memfiles` and `/listskill` in Telegram |
| Audit history of memory mutations | `/memfiles` (mentions audit log), or query `audit_recent` via the MCP HTTP endpoint |

If a problem is not on this list, open an issue with:
- `docker compose ps`
- Last 80 lines of relevant logs
- The exact Telegram message that triggered the bug
