# Opencode Personal Assistant

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com)
[![OpenCode](https://img.shields.io/badge/Powered%20by-OpenCode-black)](https://opencode.ai)
[![OpenClaw Skills](https://img.shields.io/badge/OpenClaw-Skills%20compatible-orange)](https://github.com/topics/openclaw-skills)

A fully-featured **personal AI assistant** running in Telegram, powered by [OpenCode](https://opencode.ai) and the free `big-pickle` model (Claude Sonnet). No subscriptions, no API costs — completely free to run.

Deploy in minutes with a single guided setup script. Everything runs locally on your machine or server.

---

## Credits

This project is a fork of **[grinev/opencode-telegram-bot](https://github.com/grinev/opencode-telegram-bot)** by [Ruslan Grinev](https://github.com/grinev) — an excellent Telegram client for OpenCode. All original features are preserved and the core architecture is entirely his work.

This fork extends the original bot to turn it into a **personal assistant** with persistent memory, skills, cron jobs, and more. If you only need a coding bot without the personal assistant features, use the original repo.

---

## What's New in This Fork

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

Install skills directly from Telegram with one command:
```
/skill_install https://raw.githubusercontent.com/alirezarezvani/claude-skills/main/engineering/git-worktree-manager/SKILL.md
```

### Cron Jobs — Three Types
Beyond the original scheduled tasks, this fork adds two new cron types via `memory/cron.yml`:

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
An interactive `setup.sh` script guides you through the full configuration in 11 steps — no manual `.env` editing needed.

### Two Installation Modes
| Mode | Recommended for | Description |
|---|---|---|
| **Full Docker** | VPS, servers, any environment | OpenCode + Bot both in Docker, fully isolated |
| **Bot-only** | Your personal PC (trusted env) | Bot in Docker, OpenCode installed as a system service (systemd/launchd) |

---

## Quick Start

```bash
git clone https://github.com/JohanYP/Opencode-Assistant.git
cd Opencode-Assistant
./setup.sh
```

The wizard will ask for:
1. Installation mode (Full Docker / Bot-only)
2. Bot language (en/es/de/fr/ru/zh)
3. Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
4. Your Telegram User ID (from [@userinfobot](https://t.me/userinfobot))
5. AI model (`big-pickle` free by default)
6. TTS provider (Speechify recommended — free)
7. STT provider (Groq Whisper recommended — free)
8. Timezone (auto-detected)
9. Assistant personality (name, tone, instructions)
10. Interface options (thinking messages, footer)
11. Optional OpenClaw skills to install from GitHub

At the end it generates `.env`, all memory files, and launches Docker automatically.

---

## Prerequisites

- **Docker** with Compose v2 — [install](https://docs.docker.com/get-docker/)
- **Telegram Bot** — created via [@BotFather](https://t.me/BotFather) during setup
- **OpenCode** — only needed for bot-only mode (setup.sh installs it automatically)

No Node.js needed on your machine — everything runs inside Docker.

---

## Features

All original features from [grinev/opencode-telegram-bot](https://github.com/grinev/opencode-telegram-bot) plus:

### Original Features
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

### Added in This Fork
- **Persistent memory** across sessions (soul, memory, context, session summary)
- **OpenClaw SKILL.md compatibility** — install any skill from GitHub
- **`/skill_install <url>`** — install skills directly from Telegram
- **Speechify TTS** — free, natural voices, sent as voice notes
- **TTS accumulation** — one audio per complete response
- **STT hide text** — silently transcribe voice without showing text
- **`type: reminder`** cron — direct Telegram messages, zero tokens
- **`type: backup`** cron — automatic memory file backups
- **`memory/cron.yml`** — define cron jobs as a file, synced with `/task`
- **Hidden thinking + footer** by default for cleaner UX
- **Bot-only mode** with systemd/launchd auto-install

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
| `/skills` | Browse and run OpenCode skills |
| `/mcps` | Browse and toggle MCP servers |
| `/task` | Create a scheduled task |
| `/tasklist` | Browse and delete scheduled tasks |
| `/opencode_start` | Start the local OpenCode server |
| `/opencode_stop` | Stop the local OpenCode server |
| `/help` | Show available commands |

### New Commands (This Fork)
| Command | Description |
|---|---|
| `/soul` | View assistant personality (soul.md) |
| `/memory [text]` | View or append to long-term memory |
| `/context [text]` | View or update project context |
| `/memfiles` | List all memory files with sizes |
| `/skills_list` | List available skills with metadata |
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
| `OPENCODE_API_URL` | `http://opencode:4096` | Full Docker; use `http://localhost:4096` for bot-only |
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

## Installation Modes

### Full Docker (Recommended)

Everything runs in Docker. Best for VPS, servers, or any environment where you want full isolation.

```bash
docker compose --profile full up -d
```

### Bot-only (Trusted environments — your personal PC)

The bot runs in Docker, OpenCode runs as a system service on your machine. You can edit files locally and OpenCode sees them in real time.

> **Warning:** OpenCode runs with access to your file system. Only use this mode on your personal machine.

`setup.sh` installs OpenCode as a system service automatically (systemd on Linux, launchd on macOS).

```bash
docker compose up -d
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
- Full Docker: make sure you used `--profile full` when starting
- Bot-only: check OpenCode service is running (`systemctl status opencode` or check Activity Monitor on macOS)
- Verify `OPENCODE_API_URL` is correct for your mode

**Memory not injected**
- Check `MEMORY_INJECT_ENABLED=true` in `.env`
- Check the `memory/soul.md` file exists and is not empty

**TTS not working**
- Speechify: verify `SPEECHIFY_API_KEY` is set and valid
- Check `TTS_PROVIDER` matches the credentials you configured

**Skills not showing**
- Place `.md` files in `memory/skills/`
- Use `/skills_list` to verify they are detected

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

- **[grinev/opencode-telegram-bot](https://github.com/grinev/opencode-telegram-bot)** by [Ruslan Grinev](https://github.com/grinev) — the original bot this project is based on. All core Telegram/OpenCode integration, session management, SSE event handling, and architecture are his work.
- **[OpenCode](https://opencode.ai)** by [SST](https://github.com/sst/opencode) — the AI coding agent powering everything.
- **[OpenClaw Skills ecosystem](https://github.com/topics/openclaw-skills)** — for the SKILL.md standard and the thousands of skills compatible with this format.
- **[Speechify](https://api.speechify.ai)** — for the free TTS API.
- **[Groq](https://console.groq.com)** — for the free Whisper STT API.
