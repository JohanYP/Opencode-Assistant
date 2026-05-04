# Opencode-Assistant

> 🤖 **Self-hosted personal AI assistant on Telegram** — powered by [OpenCode](https://opencode.ai) and the free Claude Sonnet model. [OpenClaw](https://github.com/topics/openclaw-skills) skills compatible · SQLite + MCP live memory · optional vector memory with [Ollama](https://ollama.com).

> 🤖 **Asistente personal de IA en Telegram, auto-alojado** — impulsado por [OpenCode](https://opencode.ai) y el modelo Claude Sonnet gratis. Compatible con skills de [OpenClaw](https://github.com/topics/openclaw-skills) · memoria viva SQLite + MCP · memoria vectorial opcional con [Ollama](https://ollama.com).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![npm](https://img.shields.io/npm/v/opencode-assistant?label=npm)](https://www.npmjs.com/package/opencode-assistant)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?logo=docker&logoColor=white)](https://github.com/JohanYP/Opencode-Assistant/pkgs/container/opencode-assistant)
[![OpenCode](https://img.shields.io/badge/Powered%20by-OpenCode-black)](https://opencode.ai)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-Skills%20compatible-orange)](https://github.com/topics/openclaw-skills)
[![MCP](https://img.shields.io/badge/MCP-server%20%2B%20client-green)](https://modelcontextprotocol.io)
[![Vector memory](https://img.shields.io/badge/Vector%20memory-Ollama%20%2F%20OpenAI-blue)](docs/VECTOR_MEMORY.md)

Talk to your personal coding/research assistant from your phone, with persistent cross-session memory, voice replies, scheduled tasks, and the same OpenClaw `SKILL.md` ecosystem as Claude Desktop. Everything runs in Docker on your machine or VPS — no subscriptions, no API costs (the default `big-pickle` model is free).

Habla con tu asistente personal de programación/investigación desde el celular, con memoria persistente entre sesiones, respuestas por voz, tareas programadas y el mismo ecosistema de skills `SKILL.md` de OpenClaw que usa Claude Desktop. Todo corre en Docker en tu equipo o VPS — sin suscripciones, sin costos de API (el modelo `big-pickle` por defecto es gratis).

---

## Architecture / Arquitectura

```
┌──────────────┐                ┌────────────────────────────┐
│  Telegram    │  Bot API       │       bot container        │
│  (mobile)    │ ◀────────────▶ │  grammY · MCP HTTP :4097   │
└──────────────┘                │  SQLite memory (data.db)   │
                                └─────────────┬──────────────┘
                                              │ HTTP /mcp (memory tools)
                                              ▼
                                ┌────────────────────────────┐
                                │     opencode container     │
                                │  opencode serve :4096      │
                                │  big-pickle (Claude Sonnet)│
                                └─────────────┬──────────────┘
                                              │ optional /v1/embeddings
                                              ▼
                              ┌──────────────────────────────────┐
                              │  Ollama (host) or OpenAI (cloud) │
                              │  embeddings for vector memory    │
                              └──────────────────────────────────┘
```

The bot owns SQLite memory and exposes it to OpenCode via a local MCP server, so the assistant can read **and write** memory at any point during a session — not just receive a snapshot at session start. With an optional embedding provider configured, `fact_search` ranks results by semantic similarity instead of plain LIKE matching.

---

# 🇬🇧 English

## What is this?

`Opencode-Assistant` is a Telegram bot that turns [**OpenCode**](https://opencode.ai) into a mobile-first personal AI assistant. You get:

- 🧠 **Persistent memory** — facts, preferences, project context, session summaries, all stored in SQLite and live-queryable via MCP tools
- 🔍 **Optional semantic search** — embed your facts with [Ollama](https://ollama.com) (local, free) or OpenAI/Groq/Together (cloud), so the assistant finds *"I prefer light blue"* when you ask *"what colour do I like?"*
- 🪄 **OpenClaw SKILL.md compatibility** — drop any `SKILL.md` from the [openclaw-skills](https://github.com/topics/openclaw-skills) ecosystem and it works
- ⏰ **Scheduled tasks** — three types (run an OpenCode session, send a reminder, back up memory)
- 🎙️ **Voice in/out** — Whisper STT + Speechify/OpenAI/Edge TTS, sent as Telegram voice notes
- 🔒 **Single-user, self-hosted** — strict whitelist; your data, your VPS
- 🌍 **Localized in 6 languages** — en / es / de / fr / ru / zh

## Why use it?

If you already use OpenCode on your laptop, this is the same agent on your phone, with cross-session memory and skills. If you've used Claude Desktop / OpenClaw runtime, this is the self-hosted, free, mobile-friendly version with the same skill format.

## Requirements

### Minimum (without vector memory)
- 1 GB RAM, 5 GB disk
- Docker 20.10+ with Compose v2
- A Telegram account
- A bot token from [@BotFather](https://t.me/BotFather)
- Your numeric Telegram user ID from [@userinfobot](https://t.me/userinfobot)

### Recommended (with Ollama vector memory)
- 2 GB RAM, 7 GB disk
- Same Docker requirements
- [Ollama](https://ollama.com) installed on the host (Linux: native package; macOS/Windows: Ollama Desktop)
- ~270 MB extra disk for the `nomic-embed-text` embedding model
- No GPU needed — embeddings run fast on CPU

## Quick install — Linux (Ubuntu/Debian/Fedora/Arch)

```bash
# 1. Clone
git clone https://github.com/JohanYP/Opencode-Assistant.git
cd Opencode-Assistant

# 2. Install Docker if you don't have it
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# 3. Run the guided setup wizard
./setup.sh
```

The wizard asks for:
1. Bot language (en/es/de/fr/ru/zh)
2. Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
3. Your Telegram User ID (from [@userinfobot](https://t.me/userinfobot))
4. AI model (`big-pickle` free by default — Claude Sonnet)
5. TTS provider (Speechify recommended — 50K chars/month free)
6. STT provider (Groq Whisper recommended — generous free tier)
7. Timezone (auto-detected)
8. Assistant personality (name, tone, instructions)
9. Interface options
10. Optional OpenClaw skills to install from GitHub

At the end it generates `.env`, all memory files, and launches Docker automatically. Open Telegram, talk to your bot. Done.

### Manual install (no wizard)

```bash
git clone https://github.com/JohanYP/Opencode-Assistant.git
cd Opencode-Assistant
cp .env.example .env
# Edit .env: TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_ID
docker compose up -d
docker compose logs -f bot
```

## Quick install — Windows (Git Bash)

> All commands use Git Bash (not CMD/PowerShell). Install Git for Windows first if you don't have it: https://git-scm.com/download/win.

```bash
# 1. Install Docker Desktop for Windows
# Download from https://docs.docker.com/desktop/install/windows-install/
# Make sure WSL 2 backend is enabled (default since 2022).

# 2. In Git Bash:
git clone https://github.com/JohanYP/Opencode-Assistant.git
cd Opencode-Assistant
./setup.sh

# 3. If setup.sh fails on Windows (some bash features differ),
#    use the manual flow:
cp .env.example .env
# Edit .env in any editor (Notepad, VS Code, ...)
docker compose up -d
docker compose logs -f bot
```

> Windows note: `host.docker.internal` already works natively on Docker Desktop, so the optional Ollama setup below works without extra config.

## Optional: vector memory with Ollama (recommended)

Vector memory makes `fact_search` semantic instead of substring-based — *"what colour do I like?"* finds *"I prefer light blue"*. The default install uses LIKE matching; turn vectors on with three steps.

### Linux

```bash
# 1. Install Ollama on the host (not inside the bot container)
curl -fsSL https://ollama.com/install.sh | sh

# 2. Make Ollama listen on all interfaces so Docker can reach it
sudo mkdir -p /etc/systemd/system/ollama.service.d
echo '[Service]'                              | sudo tee /etc/systemd/system/ollama.service.d/override.conf
echo 'Environment="OLLAMA_HOST=0.0.0.0:11434"' | sudo tee -a /etc/systemd/system/ollama.service.d/override.conf
sudo systemctl daemon-reload && sudo systemctl restart ollama

# 3. Block 11434 from the public internet (security)
sudo ufw deny 11434/tcp 2>/dev/null || true

# 4. Pull the embedding model (~270 MB)
ollama pull nomic-embed-text

# 5. Tell the bot about it (.env)
cat >> .env <<'EOF'
EMBEDDING_BASE_URL=http://host.docker.internal:11434/v1
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_API_KEY=
EOF

# 6. Restart and backfill embeddings for existing facts
docker compose restart bot
# In Telegram: /memory_reembed
```

### Windows (Ollama Desktop)

```bash
# 1. Download and install Ollama Desktop
#    https://ollama.com/download/windows
#    It runs as a system tray app.

# 2. Open PowerShell as admin (one-time, to expose to Docker)
#    setx OLLAMA_HOST "0.0.0.0:11434"
#    Then restart Ollama from the tray.

# 3. In Git Bash:
ollama pull nomic-embed-text

# 4. Edit .env:
echo "EMBEDDING_BASE_URL=http://host.docker.internal:11434/v1" >> .env
echo "EMBEDDING_MODEL=nomic-embed-text" >> .env
echo "EMBEDDING_API_KEY=" >> .env

# 5. Restart bot, backfill in Telegram with /memory_reembed
docker compose restart bot
```

### Cloud provider alternative (OpenAI, Groq, ...)

If you'd rather use OpenAI's `text-embedding-3-small` (~$0.0001 per fact) or any other `/v1/embeddings`-compatible API:

```env
EMBEDDING_BASE_URL=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=sk-...
```

Full guide and troubleshooting: [`docs/VECTOR_MEMORY.md`](./docs/VECTOR_MEMORY.md).

## Updating

```bash
git pull
docker compose up -d --build
```

That's it. Memory persists in `./memory/` (mounted volume), so updates never lose state.

## Bot commands

### Core
| Command | Description |
|---|---|
| `/status` | Server, project, session, model info |
| `/new` · `/abort` · `/sessions` | Session management |
| `/projects` · `/worktree` · `/open` | Project switching |
| `/tts` · `/rename` · `/help` | Misc |
| `/task` · `/tasklist` | Scheduled tasks |
| `/commands` · `/mcps` | OpenCode commands and MCP servers |

### Memory & skills
| Command | Description |
|---|---|
| `/memory <text>` | Save a fact |
| `/memory_search <query>` | Search saved facts (vector if enabled, LIKE otherwise) |
| `/memory_remove <id>` | Delete a fact by id |
| `/memory_export` | Dump everything to markdown files |
| `/memory_reembed` | Recompute embeddings (run after enabling vectors or switching model) |
| `/inline_facts <on\|off\|N>` | Tune how many facts get inlined at session start |
| `/personality [text]` | View/set user-defined behaviour rules ("always address me as ‘sir’", etc.) |
| `/show_tools <on\|off>` | Toggle tool-call messages in chat |
| `/listskill` · `/skill <name>` | Browse skills |
| `/skill_install <url>` · `/skill_update` · `/skill_remove` · `/skill_verify` | Skill lifecycle |

## Comparison

|  | Opencode-Assistant | Claude Desktop / OpenClaw runtime | OpenCode TUI/CLI |
|---|---|---|---|
| Surface | Telegram (mobile-first) | Native desktop / web | Local terminal |
| AI engine | OpenCode + free `big-pickle` | Claude API or Claw runtime | OpenCode |
| Memory | SQLite + MCP, vectors optional | Built-in long-term in some clients | Per-session only |
| Skills | OpenClaw `SKILL.md`, sha256-verified | OpenClaw `SKILL.md` | Custom commands |
| Scheduled tasks | Three types (task/reminder/backup) | None native | None native |
| Voice | Whisper STT + multi-provider TTS | Some clients only | None |
| Cost | $0 (free model + free TTS/STT tiers) | Subscription | Whatever model you wire |
| Setup | `./setup.sh` then `docker compose up -d` | App install | `npm install -g opencode-ai` |

## Documentation

- [`docs/QUICK_DEMO.md`](./docs/QUICK_DEMO.md) — first 5 minutes after install
- [`docs/MCP_INTEGRATION.md`](./docs/MCP_INTEGRATION.md) — how memory tools wire into OpenCode
- [`docs/VECTOR_MEMORY.md`](./docs/VECTOR_MEMORY.md) — full vector memory guide
- [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md) — symptom → fix
- [`docs/RELEASE_CHECKLIST.md`](./docs/RELEASE_CHECKLIST.md) — maintainer release flow
- [`PRODUCT.md`](./PRODUCT.md) and [`CONCEPT.md`](./CONCEPT.md) — vision and boundaries

## Acknowledgments

Built on top of the open-source ecosystem:

- **[OpenCode](https://opencode.ai)** by [SST](https://github.com/sst/opencode) — the AI coding agent under the hood.
- **[OpenClaw skills ecosystem](https://github.com/topics/openclaw-skills)** — the `SKILL.md` standard and community skills.
- **[Ollama](https://ollama.com)** — local embedding inference.
- **[Speechify](https://api.speechify.ai)** — free TTS API.
- **[Groq](https://console.groq.com)** — free Whisper STT API.
- **[grammY](https://grammy.dev)** — Telegram bot framework.
- **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** — synchronous SQLite for Node.

## License

[MIT](LICENSE) — your data, your setup, your rules.

---

# 🇪🇸 Español

## Qué es

`Opencode-Assistant` es un bot de Telegram que convierte a [**OpenCode**](https://opencode.ai) en un asistente personal de IA mobile-first. Te da:

- 🧠 **Memoria persistente** — datos, preferencias, contexto de proyectos, resúmenes de sesión, todo en SQLite y consultable en vivo vía herramientas MCP
- 🔍 **Búsqueda semántica opcional** — embebe tus datos con [Ollama](https://ollama.com) (local, gratis) u OpenAI/Groq/Together (cloud), así el asistente encuentra *"prefiero el celeste"* cuando preguntas *"qué color me gusta?"*
- 🪄 **Compatibilidad con SKILL.md de OpenClaw** — pega cualquier `SKILL.md` del ecosistema [openclaw-skills](https://github.com/topics/openclaw-skills) y funciona
- ⏰ **Tareas programadas** — tres tipos (correr una sesión OpenCode, mandar un recordatorio, hacer backup de memoria)
- 🎙️ **Voz** — STT con Whisper + TTS con Speechify/OpenAI/Edge, enviado como nota de voz de Telegram
- 🔒 **Single-user, auto-alojado** — whitelist estricta; tus datos, tu VPS
- 🌍 **Localizado en 6 idiomas** — en / es / de / fr / ru / zh

## Por qué usarlo

Si ya usas OpenCode en tu laptop, este es el mismo agente desde el celular, con memoria entre sesiones y skills. Si has usado Claude Desktop / OpenClaw runtime, esta es la versión auto-alojada, gratis, mobile-friendly, con el mismo formato de skill.

## Requisitos

### Mínimos (sin memoria vectorial)
- 1 GB RAM, 5 GB de disco
- Docker 20.10+ con Compose v2
- Una cuenta de Telegram
- Un token de bot de [@BotFather](https://t.me/BotFather)
- Tu user ID numérico de [@userinfobot](https://t.me/userinfobot)

### Recomendados (con memoria vectorial Ollama)
- 2 GB RAM, 7 GB de disco
- Mismos requisitos de Docker
- [Ollama](https://ollama.com) instalado en el host (Linux: paquete nativo; macOS/Windows: Ollama Desktop)
- ~270 MB extra para el modelo `nomic-embed-text`
- Sin GPU — los embeddings son rápidos en CPU

## Instalación rápida — Linux (Ubuntu/Debian/Fedora/Arch)

```bash
# 1. Clonar
git clone https://github.com/JohanYP/Opencode-Assistant.git
cd Opencode-Assistant

# 2. Instalar Docker si no lo tienes
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# 3. Correr el wizard interactivo
./setup.sh
```

El wizard pregunta:
1. Idioma del bot (en/es/de/fr/ru/zh)
2. Token del bot de Telegram (de [@BotFather](https://t.me/BotFather))
3. Tu user ID de Telegram (de [@userinfobot](https://t.me/userinfobot))
4. Modelo de IA (`big-pickle` por default — Claude Sonnet, gratis)
5. Proveedor TTS (Speechify recomendado — 50K caracteres/mes gratis)
6. Proveedor STT (Groq Whisper recomendado — tier gratis generoso)
7. Zona horaria (autodetectada)
8. Personalidad del asistente (nombre, tono, instrucciones)
9. Opciones de interfaz
10. Skills opcionales de OpenClaw para instalar desde GitHub

Al final genera `.env`, todos los archivos de memoria, y arranca Docker automáticamente. Abres Telegram, hablas con tu bot. Listo.

### Instalación manual (sin wizard)

```bash
git clone https://github.com/JohanYP/Opencode-Assistant.git
cd Opencode-Assistant
cp .env.example .env
# Editar .env: TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_ID
docker compose up -d
docker compose logs -f bot
```

## Instalación rápida — Windows (Git Bash)

> Todos los comandos van en Git Bash (no CMD ni PowerShell). Si no lo tienes: https://git-scm.com/download/win.

```bash
# 1. Instalar Docker Desktop para Windows
# Descarga: https://docs.docker.com/desktop/install/windows-install/
# Asegúrate de que el backend WSL 2 esté activo (default desde 2022).

# 2. En Git Bash:
git clone https://github.com/JohanYP/Opencode-Assistant.git
cd Opencode-Assistant
./setup.sh

# 3. Si setup.sh falla en Windows (algunas features de bash difieren),
#    usa el flujo manual:
cp .env.example .env
# Edita .env en cualquier editor (Notepad, VS Code, ...)
docker compose up -d
docker compose logs -f bot
```

> Nota Windows: `host.docker.internal` ya funciona nativamente con Docker Desktop, así que el setup opcional de Ollama de abajo funciona sin configuración extra.

## Opcional: memoria vectorial con Ollama (recomendado)

La memoria vectorial hace que `fact_search` sea semántica en vez de búsqueda por substring — *"qué color me gusta?"* encuentra *"prefiero el celeste"*. El install por default usa búsqueda LIKE; activa los vectores con tres pasos.

### Linux

```bash
# 1. Instalar Ollama en el host (no dentro del contenedor del bot)
curl -fsSL https://ollama.com/install.sh | sh

# 2. Hacer que Ollama escuche en todas las interfaces para que Docker pueda alcanzarlo
sudo mkdir -p /etc/systemd/system/ollama.service.d
echo '[Service]'                              | sudo tee /etc/systemd/system/ollama.service.d/override.conf
echo 'Environment="OLLAMA_HOST=0.0.0.0:11434"' | sudo tee -a /etc/systemd/system/ollama.service.d/override.conf
sudo systemctl daemon-reload && sudo systemctl restart ollama

# 3. Bloquear 11434 desde internet (seguridad)
sudo ufw deny 11434/tcp 2>/dev/null || true

# 4. Bajar el modelo de embeddings (~270 MB)
ollama pull nomic-embed-text

# 5. Decirle al bot dónde está (.env)
cat >> .env <<'EOF'
EMBEDDING_BASE_URL=http://host.docker.internal:11434/v1
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_API_KEY=
EOF

# 6. Reiniciar y backfill de los facts existentes
docker compose restart bot
# En Telegram: /memory_reembed
```

### Windows (Ollama Desktop)

```bash
# 1. Descargar e instalar Ollama Desktop
#    https://ollama.com/download/windows
#    Corre como app de la bandeja del sistema.

# 2. Abrir PowerShell como admin (una vez, para exponerlo a Docker)
#    setx OLLAMA_HOST "0.0.0.0:11434"
#    Después reinicia Ollama desde la bandeja.

# 3. En Git Bash:
ollama pull nomic-embed-text

# 4. Editar .env:
echo "EMBEDDING_BASE_URL=http://host.docker.internal:11434/v1" >> .env
echo "EMBEDDING_MODEL=nomic-embed-text" >> .env
echo "EMBEDDING_API_KEY=" >> .env

# 5. Reiniciar el bot, backfill en Telegram con /memory_reembed
docker compose restart bot
```

### Alternativa cloud (OpenAI, Groq, ...)

Si prefieres usar `text-embedding-3-small` de OpenAI (~$0.0001 por fact) o cualquier otra API compatible con `/v1/embeddings`:

```env
EMBEDDING_BASE_URL=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=sk-...
```

Guía completa y troubleshooting: [`docs/VECTOR_MEMORY.md`](./docs/VECTOR_MEMORY.md).

## Actualizar

```bash
git pull
docker compose up -d --build
```

Eso es todo. La memoria persiste en `./memory/` (volumen montado), las actualizaciones nunca pierden estado.

## Comandos del bot

### Núcleo
| Comando | Descripción |
|---|---|
| `/status` | Estado del servidor, proyecto, sesión, modelo |
| `/new` · `/abort` · `/sessions` | Gestión de sesiones |
| `/projects` · `/worktree` · `/open` | Cambio de proyecto |
| `/tts` · `/rename` · `/help` | Misceláneos |
| `/task` · `/tasklist` | Tareas programadas |
| `/commands` · `/mcps` | Comandos OpenCode y servidores MCP |

### Memoria y skills
| Comando | Descripción |
|---|---|
| `/memory <texto>` | Guardar un dato |
| `/memory_search <consulta>` | Buscar (vectores si están activos, LIKE si no) |
| `/memory_remove <id>` | Borrar un dato por id |
| `/memory_export` | Volcar todo a archivos markdown |
| `/memory_reembed` | Recalcular embeddings (después de activar vectores o cambiar modelo) |
| `/inline_facts <on\|off\|N>` | Cuántos datos inyectar al iniciar sesión |
| `/personality [texto]` | Reglas de comportamiento definidas por ti ("dime siempre señor", etc.) |
| `/show_tools <on\|off>` | Mostrar/ocultar mensajes de herramientas en el chat |
| `/listskill` · `/skill <nombre>` | Explorar skills |
| `/skill_install <url>` · `/skill_update` · `/skill_remove` · `/skill_verify` | Gestión de skills |

## Comparativa

|  | Opencode-Assistant | Claude Desktop / OpenClaw runtime | OpenCode TUI/CLI |
|---|---|---|---|
| Superficie | Telegram (mobile-first) | App nativa / web | Terminal local |
| Motor IA | OpenCode + `big-pickle` gratis | Claude API o Claw runtime | OpenCode |
| Memoria | SQLite + MCP, vectores opcionales | Long-term en algunos clientes | Solo por sesión |
| Skills | `SKILL.md` de OpenClaw, verificada con sha256 | `SKILL.md` de OpenClaw | Comandos custom |
| Tareas programadas | Tres tipos (tarea/recordatorio/backup) | No nativo | No nativo |
| Voz | STT Whisper + TTS multi-proveedor | Solo algunos clientes | Ninguno |
| Costo | $0 (modelo gratis + TTS/STT con tier free) | Suscripción | Lo que cablees |
| Setup | `./setup.sh` y `docker compose up -d` | Instalar app | `npm install -g opencode-ai` |

## Documentación

- [`docs/QUICK_DEMO.md`](./docs/QUICK_DEMO.md) — primeros 5 minutos
- [`docs/MCP_INTEGRATION.md`](./docs/MCP_INTEGRATION.md) — cómo se conecta MCP a OpenCode
- [`docs/VECTOR_MEMORY.md`](./docs/VECTOR_MEMORY.md) — guía completa de memoria vectorial
- [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md) — síntoma → solución
- [`docs/RELEASE_CHECKLIST.md`](./docs/RELEASE_CHECKLIST.md) — flujo de release del mantenedor
- [`PRODUCT.md`](./PRODUCT.md) y [`CONCEPT.md`](./CONCEPT.md) — visión y límites

## Agradecimientos

Construido sobre el ecosistema open-source:

- **[OpenCode](https://opencode.ai)** de [SST](https://github.com/sst/opencode) — el agente de IA bajo el capó.
- **[Ecosistema OpenClaw skills](https://github.com/topics/openclaw-skills)** — el estándar `SKILL.md` y skills de la comunidad.
- **[Ollama](https://ollama.com)** — inferencia local de embeddings.
- **[Speechify](https://api.speechify.ai)** — API TTS gratis.
- **[Groq](https://console.groq.com)** — API STT Whisper gratis.
- **[grammY](https://grammy.dev)** — framework de bots de Telegram.
- **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** — SQLite síncrono para Node.

## Licencia

[MIT](LICENSE) — tus datos, tu setup, tus reglas.

---

**Keywords:** OpenCode · OpenClaw · Claude Sonnet · MCP · Model Context Protocol · Ollama · vector memory · semantic search · embeddings · Telegram bot · AI assistant · self-hosted · personal AI · claude-skills · SKILL.md · big-pickle · cron jobs · Whisper STT · Speechify TTS · SQLite · openclaw-skills · sst/opencode
