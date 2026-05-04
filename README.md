# Opencode Personal Assistant

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com)
[![OpenCode](https://img.shields.io/badge/Powered%20by-OpenCode-black)](https://opencode.ai)
[![OpenClaw Skills](https://img.shields.io/badge/OpenClaw-Skills%20compatible-orange)](https://github.com/topics/openclaw-skills)

A fully-featured **personal AI assistant** running in Telegram, powered by [OpenCode](https://opencode.ai) and the free `big-pickle` model (Claude Sonnet). No subscriptions, no API costs — completely free to run.

Persistent memory across sessions, scheduled tasks with continue/cancel buttons that inject results into your active chat, voice replies, and one-command MCP server installation. Deploy in minutes with a single guided setup script. Everything runs locally on your machine or server.

> **Roadmap note**: the project is moving toward SQLite-backed memory exposed to OpenCode through a local MCP server (memory becomes live across sessions instead of a snapshot at session start), and Docker becoming the only supported install path. See [`PRODUCT.md`](./PRODUCT.md#roadmap) and [`CONCEPT.md`](./CONCEPT.md) for the direction.

---

## Highlights

### Persistent Memory System
The assistant remembers who it is and what you've discussed across sessions. At the start of every new session it automatically receives its identity (`soul.md`), available skills, and a summary of the previous session — so it continues right where you left off, without you repeating context.

- **`memory/soul.md`** — personality, behavior rules, and skills index (read-only, you edit it)
- **`memory/memory.md`** — long-term facts and user preferences (read/write)
- **`memory/context.md`** — current project context (read/write)
- **`memory/agents.md`** — agent selection instructions (read/write)
- **`memory/session-summary.md`** — auto-updated summary of the last session (incremental, survives context overflow)
- **`memory/skills/`** — one `.md` file per skill

### OpenClaw Skills Compatibility
Drop any `SKILL.md` file from the [OpenClaw](https://github.com/topics/openclaw-skills) / [ClawHub](https://github.com/alirezarezvani/claude-skills) ecosystem into `memory/skills/` and the assistant can use it immediately. YAML frontmatter is parsed automatically to show skill names, descriptions, and categories.

Drop any `.md` file into `memory/skills/` and it will be picked up automatically, or install one directly from a GitHub URL:

```
/skill_install https://raw.githubusercontent.com/alirezarezvani/claude-skills/main/engineering/git-worktree-manager/SKILL.md
```

### Cron Jobs — Three Types
Beyond the basic scheduled tasks, three cron types are supported via `memory/cron.yml`:

| Type | Description |
|---|---|
| `task` | Creates an OpenCode session and runs a prompt (original behavior) |
| `reminder` | Sends a direct Telegram message — no tokens consumed |
| `backup` | Copies all memory files to `memory/backups/YYYY-MM-DD/` |

`memory/cron.yml` is synced bidirectionally with `/task` commands in Telegram.

### TTS Improvements
- **Speechify** provider added — 50,000 characters/month **free**, very natural voices
- Audio is sent as a **Telegram voice note** (circular waveform) instead of a file attachment
- **Single audio per response**: audio is generated only when the full response is complete (`session.idle`), not for every intermediate message

### STT Improvements
- Option to hide the transcribed text from the chat — the voice is silently sent to the assistant

### Cleaner Interface
- Thinking messages (`💭 Thinking...`) hidden by default
- Run footer (`🛠️ Build · 🤖 model · 🕒 Xs`) hidden by default
- Both can be re-enabled via environment variables

### Guided Setup Wizard
An interactive `setup.sh` script guides you through the full configuration in 10 steps — no manual `.env` editing needed.

### Single Install Path: Docker
Everything runs in Docker — bot and OpenCode together. Updates are a one-liner: `git pull && docker compose up -d --build`. No systemd, no launchd, no `host.docker.internal`.

---

## Quick Start

```bash
git clone https://github.com/JohanYP/Opencode-Assistant.git
cd Opencode-Assistant
./setup.sh
```

The wizard will ask for:
1. Bot language (en/es/de/fr/ru/zh)
2. Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
3. Your Telegram User ID (from [@userinfobot](https://t.me/userinfobot))
4. AI model (`big-pickle` free by default)
5. TTS provider (Speechify recommended — free)
6. STT provider (Groq Whisper recommended — free)
7. Timezone (auto-detected)
8. Assistant personality (name, tone, instructions)
9. Interface options (thinking messages, footer)
10. Optional OpenClaw skills to install from GitHub

At the end it generates `.env`, all memory files, and launches Docker automatically.

---

## Prerequisites

- **Docker** with Compose v2 — [install](https://docs.docker.com/get-docker/)
- **Telegram Bot** — created via [@BotFather](https://t.me/BotFather) during setup

No Node.js or OpenCode binary needed on your machine — everything runs inside Docker.

---

## Features

### Core
- **Remote coding** — send prompts to OpenCode from anywhere
- **Session management** — create, switch, and track sessions
- **Live status** — pinned message with project, model, context usage
- **Model switching** — pick from favorites and recent history
- **Agent modes** — Plan and Build modes
- **Subagent activity** — live progress of parallel agents
- **Custom Commands** — run OpenCode slash commands from Telegram
- **Interactive Q&A** — answer agent questions via inline buttons
- **Voice prompts** — send voice messages, transcribed via Whisper
- **File attachments** — images, PDFs, text files
- **Scheduled tasks** — cron jobs and one-time tasks
- **Git worktree switching** — `/worktree` command
- **Security** — strict user ID whitelist
- **Localization** — en, es, de, fr, ru, zh

### Personal Assistant Layer
- **Persistent memory** across sessions (soul, memory, context, session summary)
- **OpenClaw SKILL.md compatibility** — drop a `.md` into `memory/skills/` or install via `/skill_install <url>`
- **Speechify TTS** — free, natural voices, sent as voice notes
- **TTS accumulation** — one audio per complete response
- **STT hide text** — silently transcribe voice without showing text
- **`type: reminder`** cron — direct Telegram messages, zero tokens
- **`type: backup`** cron — automatic memory file backups
- **`memory/cron.yml`** — define cron jobs as a file, synced with `/task`
- **Hidden thinking + footer** by default for cleaner UX

---

## Bot Commands

### Original Commands
| Command | Description |
|---|---|
| `/status` | Server health, project, session, model info |
| `/new` | Create a new session |
| `/abort` | Abort current task |
| `/sessions` | Browse and switch sessions |
| `/projects` | Switch between OpenCode projects |
| `/worktree` | Switch git worktrees |
| `/open` | Add a project by browsing directories |
| `/tts` | Toggle audio replies |
| `/rename` | Rename current session |
| `/commands` | Browse and run custom commands |
| `/mcps` | Browse and toggle MCP servers |
| `/task` | Create a scheduled task |
| `/tasklist` | Browse and delete scheduled tasks |
| `/opencode_start` | Start the local OpenCode server |
| `/opencode_stop` | Stop the local OpenCode server |
| `/help` | Show available commands |

### Personal Assistant Commands
| Command | Description |
|---|---|
| `/soul` | View assistant personality (soul.md) |
| `/memory [text]` | View or append to long-term memory |
| `/context [text]` | View or update project context |
| `/memfiles` | List all memory files with sizes |
| `/listskill` | List available skills with metadata |
| `/skill <name>` | View a specific skill |
| `/skill_install <url>` | Install a skill from a GitHub URL |
| `/agents_md` | View agent selection instructions |

---

## Memory System

```
memory/
├── soul.md              ← Your assistant's identity (you edit this)
├── memory.md            ← Long-term facts and preferences
├── context.md           ← Current project context
├── agents.md            ← Agent selection instructions
├── session-summary.md   ← Auto-updated session summary
├── cron.yml             ← Scheduled jobs (synced with /task)
├── skills/
│   ├── web-search.md
│   ├── code-review.md
│   ├── daily-summary.md
│   └── <any-openclaw-skill>.md
└── backups/
    └── YYYY-MM-DD/      ← Automatic backups
```

### How Memory Works

**First message of a new session:**
The assistant receives `soul.md` + `agents.md` + skill list + `session-summary.md` prepended to your message. It knows exactly who it is, what skills it has, and what you worked on last.

**Subsequent messages in the same session:**
OpenCode manages the conversation history internally. No extra context is injected — tokens are conserved.

**Session summary updates:**
`soul.md` instructs the assistant to update `session-summary.md` incrementally during the session — when you ask it to remember something, when a task completes, or when context usage is high. This way the summary is always up to date even if the session crashes or fills up.

---

## Cron Jobs

Define scheduled tasks in `memory/cron.yml` or via `/task` in Telegram. Both are synced bidirectionally.

```yaml
crons:
  - id: daily-summary
    schedule: "0 8 * * *"
    type: task
    prompt: "Generate a daily summary using the daily-summary skill"
    timezone: "America/Bogota"

  - id: morning-reminder
    schedule: "30 7 * * 1-5"
    type: reminder
    message: "Good morning! Check your pending tasks."
    timezone: "America/Bogota"

  - id: weekly-backup
    schedule: "0 0 * * 0"
    type: backup
    timezone: "America/Bogota"
```

---

## TTS Providers

| Provider | Free | API Key | Notes |
|---|---|---|---|
| **Speechify** | 50,000 chars/month | Required (free) | Most natural, recommended |
| **Edge TTS** | Unlimited | Not required | Microsoft voices, requires local proxy |
| **OpenAI TTS** | No | Required | |
| **Google Cloud TTS** | No | Credentials required | |
| Any OpenAI-compatible | Depends | Required | |

Speechify API key: [api.speechify.ai](https://api.speechify.ai) — free registration.

---

## STT Providers

| Provider | Free | Notes |
|---|---|---|
| **Groq Whisper** | Generous free tier | Recommended — [console.groq.com](https://console.groq.com) |
| **OpenAI Whisper** | No | |
| Any Whisper-compatible | Depends | |

---

## Environment Variables

All variables are set automatically by `setup.sh`. Reference for manual configuration:

### Required
| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_ALLOWED_USER_ID` | Your numeric Telegram user ID |

### OpenCode
| Variable | Default | Description |
|---|---|---|
| `OPENCODE_API_URL` | `http://opencode:4096` | Internal compose-network address of the OpenCode container |
| `OPENCODE_MODEL_PROVIDER` | `opencode` | Model provider |
| `OPENCODE_MODEL_ID` | `big-pickle` | Model ID (`big-pickle` = Claude Sonnet, free) |
| `OPENCODE_AUTO_RESTART_ENABLED` | `false` | Auto-restart OpenCode on health check failure |

### Memory
| Variable | Default | Description |
|---|---|---|
| `MEMORY_DIR` | `./memory` | Path to memory directory |
| `MEMORY_INJECT_ENABLED` | `true` | Inject memory context into new sessions |

### TTS
| Variable | Default | Description |
|---|---|---|
| `TTS_PROVIDER` | — | `speechify`, `openai`, `google`, or empty |
| `SPEECHIFY_API_KEY` | — | Speechify API key (free tier available) |
| `TTS_VOICE` | provider-specific | Voice ID |
| `TTS_WAIT_FOR_IDLE` | `true` | Send one audio after full response |
| `TTS_API_URL` | — | OpenAI-compatible TTS base URL |
| `TTS_API_KEY` | — | OpenAI-compatible TTS API key |

### STT
| Variable | Default | Description |
|---|---|---|
| `STT_API_URL` | — | Whisper-compatible API base URL |
| `STT_API_KEY` | — | STT API key |
| `STT_MODEL` | `whisper-large-v3-turbo` | STT model name |
| `STT_HIDE_RECOGNIZED_TEXT` | `false` | Hide transcribed text from chat |

### Interface
| Variable | Default | Description |
|---|---|---|
| `HIDE_THINKING_MESSAGES` | `true` | Hide `💭 Thinking...` messages |
| `HIDE_ASSISTANT_FOOTER` | `true` | Hide `🛠️ Build · 🤖 model · 🕒 Xs` footer |
| `HIDE_TOOL_CALL_MESSAGES` | `false` | Hide tool call messages |
| `BOT_LOCALE` | `en` | Bot UI language (`en`, `es`, `de`, `fr`, `ru`, `zh`) |

### Cron
| Variable | Default | Description |
|---|---|---|
| `CRON_YML_SYNC` | `true` | Sync `memory/cron.yml` with `/task` commands |
| `CRON_BACKUP_ENABLED` | `true` | Enable automatic memory backups |
| `CRON_BACKUP_SCHEDULE` | `0 0 * * 0` | Backup cron schedule (default: Sundays) |

---

## Installation

Everything runs in Docker. Bot and OpenCode share a compose network.

```bash
docker compose up -d
```

To update later:

```bash
git pull
docker compose up -d --build
```

---

## Development

```bash
git clone https://github.com/JohanYP/Opencode-Assistant.git
cd Opencode-Assistant
npm install
cp .env.example .env
# Edit .env with your settings
npm run dev
```

Available scripts:

| Script | Description |
|---|---|
| `npm run dev` | Build and start |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled code |
| `npm run lint` | ESLint check |
| `npm run format` | Format with Prettier |
| `npm test` | Run tests (Vitest) |

---

## Troubleshooting

**Bot doesn't respond**
- Check `TELEGRAM_ALLOWED_USER_ID` matches your actual ID ([@userinfobot](https://t.me/userinfobot))
- Verify the bot token is correct

**"OpenCode server is not available"**
- Confirm both containers are up: `docker compose ps` should show `opencode` and `bot` running.
- Check the OpenCode container logs: `docker compose logs opencode`.
- Verify `OPENCODE_API_URL=http://opencode:4096` in `.env` (compose-network address).
- Restart everything: `docker compose down && docker compose up -d`.

**`setup.sh` failed to install Docker**
- Inspect the install log: `cat /tmp/opencode-setup.log`.
- Manual fallback for Docker: https://docs.docker.com/engine/install/.

**Memory not injected**
- Check `MEMORY_INJECT_ENABLED=true` in `.env`
- Check the `memory/soul.md` file exists and is not empty

**TTS not working**
- Speechify: verify `SPEECHIFY_API_KEY` is set and valid
- Check `TTS_PROVIDER` matches the credentials you configured

**Skills not showing**
- Place `.md` files in `memory/skills/`
- Use `/listskill` to verify they are detected

---

## Security

- Strict user ID whitelist — only `TELEGRAM_ALLOWED_USER_ID` can interact with the bot
- No open ports — bot communicates only with Telegram Bot API and your local OpenCode server
- Memory files contain personal data — never commit them to version control (already in `.gitignore`)
- Keep your `.env` file private

---

## License

[MIT](LICENSE)

---

## Acknowledgments

Opencode-Assistant is an independent personal-assistant project. Historically it began as work on top of an open-source Telegram bot client for OpenCode and has since evolved into its own product with a persistent memory system, OpenClaw skills, cron jobs with continue/cancel deliveries, voice TTS/STT, and a guided setup wizard.

Credit and thanks to:

- **[OpenCode](https://opencode.ai)** by [SST](https://github.com/sst/opencode) — the AI coding agent that powers everything under the hood.
- **[grinev/opencode-telegram-bot](https://github.com/grinev/opencode-telegram-bot)** by [Ruslan Grinev](https://github.com/grinev) — the upstream Telegram-to-OpenCode bridge whose Telegram/OpenCode integration, session management, and SSE event handling form the technical foundation this project was built on top of.
- **[OpenClaw Skills ecosystem](https://github.com/topics/openclaw-skills)** — for the SKILL.md standard and the thousands of skills compatible with this format.
- **[Speechify](https://api.speechify.ai)** — for the free TTS API.
- **[Groq](https://console.groq.com)** — for the free Whisper STT API.
