# Quick Demo — first 5 minutes after install

Once `./setup.sh` finishes and `docker compose ps` shows both services
`Up`, walk through this 5-minute tour to verify everything works
end-to-end and to see what the assistant can do.

## 0 — Sanity check (30 s)

In Telegram, message your bot and send:

```
/help
```

You should get the command catalog. If nothing comes back, jump to
[TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — "Bot doesn't respond".

## 1 — Talk to the assistant (1 min)

Pick a project on your machine that OpenCode can see (it lives inside
the `opencode` container's workspace mount). Then in Telegram:

```
/new
hola, ¿qué proyectos tengo disponibles?
```

The assistant should respond. It's connected to OpenCode's `big-pickle`
free model by default, and it sees the projects from
`docker compose exec opencode opencode project list`.

## 2 — Save and recall a fact (1 min)

```
/memory recordame que prefiero TypeScript estricto
```

The bot replies `Saved fact #N: recordame que prefiero TypeScript estricto`.

Now open a brand-new session and ask the assistant:

```
/new
¿qué lenguaje prefiero?
```

It should answer with TypeScript. It got that fact from the
`<known_facts_about_user>` block automatically inlined into the system
prompt — no tool call needed.

## 3 — Install a skill from the OpenClaw ecosystem (1 min)

Pick any SKILL.md from <https://github.com/alirezarezvani/claude-skills>.
For example, the git-worktree-manager skill:

```
/skill_install https://raw.githubusercontent.com/alirezarezvani/claude-skills/main/engineering/git-worktree-manager/SKILL.md
```

You should see `Skill installed: git-worktree-manager`. Then:

```
/listskill
```

It is now grouped under the `engineering` category with a `✓` flag.
Try its functionality:

```
/new
list my git worktrees
```

The assistant should follow the skill's procedure.

## 4 — See your memory grow (30 s)

```
/memfiles
```

You'll see counts of documents (4 — soul, agents, context, session-summary),
facts (≥1 from step 2), and skills (≥1 from step 3).

```
/memory_search Type
```

Returns the fact you saved.

## 5 — Confirm the MCP HTTP wiring (1 min)

This is the magic that lets OpenCode update memory mid-session. Run
**on the host** (the machine where docker compose runs):

```bash
docker compose exec opencode curl -s -X POST http://bot:4097/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | head -c 200
```

You should see `{"jsonrpc":"2.0","id":1,"result":{"tools":[…` — the bot
is exposing 9 memory tools and OpenCode can reach them.

## What to do next

- **Customize the assistant's identity** by editing `memory/soul.md` on
  the host, then `docker compose restart bot`. Personality, tone, hard
  rules — all live there.
- **Schedule recurring tasks** with `/task`. Examples: a daily summary,
  a weekly memory backup, a reminder.
- **Read [`MCP_INTEGRATION.md`](./MCP_INTEGRATION.md)** if you want to
  understand or extend the memory tools the assistant has.
- **Read [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)** when something
  breaks.

If any of the five steps above failed, the troubleshooting guide has
the symptom-to-fix lookup table.
