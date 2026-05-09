<div align="center">

# 🤖 Opencode-Assistant

### Tu asistente personal de IA en Telegram. Auto-alojado. Gratis. Tuyo.
### Your personal AI assistant on Telegram. Self-hosted. Free. Yours.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://github.com/JohanYP/Opencode-Assistant/pkgs/container/opencode-assistant)
[![Node.js](https://img.shields.io/badge/Node-20%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)

[![OpenCode](https://img.shields.io/badge/Powered%20by-OpenCode-black?style=flat-square)](https://opencode.ai)
[![OpenClaw Skills](https://img.shields.io/badge/OpenClaw-SKILL.md%20compatible-orange?style=flat-square)](https://github.com/topics/openclaw-skills)
[![MCP](https://img.shields.io/badge/MCP-server%20%2B%20client-green?style=flat-square)](https://modelcontextprotocol.io)
[![Vector memory](https://img.shields.io/badge/Vector-Ollama%20%2F%20OpenAI-blue?style=flat-square)](docs/VECTOR_MEMORY.md)
[![i18n](https://img.shields.io/badge/i18n-6%20languages-yellow?style=flat-square)](#)

**Cero suscripciones. Cero API keys. Cero costos.** Un agente de IA real en Telegram, con memoria persistente, voz y compatibilidad nativa con el ecosistema de skills de [OpenClaw](https://github.com/topics/openclaw-skills) — todo corriendo en tu propia máquina con un `./setup.sh` de 10 minutos.

**Zero subscriptions. Zero API keys. Zero cost.** A real AI agent on Telegram, with persistent memory, voice, and native compatibility with the [OpenClaw](https://github.com/topics/openclaw-skills) skills ecosystem — all running on your own box from a 10-minute `./setup.sh`.

</div>

---

## 🎯 ¿Por qué existe? / Why does this exist?

**ES:** Las herramientas de IA te obligan a elegir entre tres caminos: pagar suscripción (Claude Desktop, ChatGPT Plus), poner tu propia API key (CrewAI, AutoGen), o construir desde cero (LangGraph, OpenFang). Faltaba la cuarta opción: **cero costo, cero API keys, compatibilidad nativa con skills de OpenClaw, en tu celular**. Eso hace Opencode-Assistant.

**EN:** AI tools today force a choice between three paths: pay subscriptions (Claude Desktop, ChatGPT Plus), bring your own API key (CrewAI, AutoGen), or build from scratch (LangGraph, OpenFang). What was missing: a fourth option — **zero cost, zero API keys, native OpenClaw skill compatibility, on your phone**. That's what Opencode-Assistant does.

---

## 📊 Cómo se compara / How it compares

Comparativa honesta. Las casillas en negrita son donde **realmente** ganamos; el resto es contexto. Los demás frameworks son excelentes, simplemente apuntan a otra cosa.

Honest comparison. Bold cells are where we **actually** win; the rest is context. The other frameworks are excellent — they just aim at different problems.

| Feature | **Opencode-Assistant** | OpenClaw runtime | [OpenFang](https://github.com/RightNow-AI/openfang) | CrewAI | AutoGen | LangGraph | Claude Desktop |
|---|---|---|---|---|---|---|---|
| **01 Cost out of the box** | 💰 **$0 — `big-pickle` included** | API key needed | BYO model | BYO model | BYO model | BYO model | Subscription |
| **02 OpenClaw `SKILL.md`** | ✅ **Drop-in + auto-update from URL + sha256 verify** | ✅ Native | ❌ | ❌ | ❌ | ❌ | ✅ Native |
| **03 Persistent memory** | SQLite + MCP + optional vectors | File-based | SQLite + FTS5 | 4-layer | External | Checkpoints | Native long-term |
| **04 Vector / semantic search** | ✅ Ollama or OpenAI | ❌ | ✅ Built-in | ❌ | ❌ | ❌ | Some clients |
| **05 Voice in / out** | ✅ Whisper + Speechify | ❌ | ❌ | ❌ | ❌ | ❌ | Some clients |
| **06 Built-in cron / scheduling** | ✅ **3 types** (task / reminder / backup) | ❌ | Scheduled tasks | ❌ | ❌ | ❌ | ❌ |
| **07 Localization (UI)** | 🌍 **6 languages** (en/es/de/fr/ru/zh) | 🇬🇧 English | 🇬🇧 English | 🇬🇧 English | 🇬🇧 English | 🇬🇧 English | Multi |
| **08 Setup time** | ⚡ **`./setup.sh` (≈10 min)** | App install | Build from source | `pip install` | `pip install` | `pip install` | App install |
| **09 Self-hosted** | ✅ Docker, one command | ✅ | ✅ Docker | ✅ | ✅ | ✅ | ❌ Cloud |
| **10 Channel adapters** | 🟡 **Telegram + optional WhatsApp** ([setup](docs/WHATSAPP_SETUP.md)) | ~13 (Slack, Discord, etc.) | 40 (multi-channel framework) | Plugin-based | None native | None native | Native client |
| **11 Production hardening** | Single-user whitelist | Basic | 16 security layers + WASM sandbox | Docker | AES enc. | Checkpoints | Cloud-managed |
| **12 Language** | TypeScript | TypeScript | Rust | Python | Python | Python | — (closed) |
| **13 License** | MIT | MIT | MIT | MIT | Apache 2.0 | MIT | Closed |

### ⚠️ Tradeoffs honestos / Honest tradeoffs

**ES:** Otros frameworks nos ganan en **multi-canal** (Slack/Discord/WhatsApp/web) y en **hardening empresarial** (las 16 capas de seguridad y el sandbox WASM de OpenFang son impresionantes). Este proyecto cambia esa amplitud por **costo cero, sin APIs, skills de OpenClaw nativas y setup en 10 minutos para un solo usuario en Telegram**. Si necesitas agentes multi-canal a escala, mira a OpenFang o construye con CrewAI/LangGraph. Si quieres un asistente personal en tu bolsillo, esto es para ti.

**EN:** Other frameworks beat us on **multi-channel** (Slack/Discord/WhatsApp/web) and on **enterprise-grade hardening** (OpenFang's 16 security layers and WASM sandbox are genuinely impressive). This project trades that breadth for **zero cost, no APIs, native OpenClaw skills, and a 10-minute setup for a single user on Telegram**. If you need multi-channel agents at scale, look at OpenFang or build with CrewAI/LangGraph. If you want a personal assistant in your pocket, this is for you.

---

## 🏗 Arquitectura / Architecture

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

El bot expone tu memoria SQLite a OpenCode vía un servidor MCP local — el asistente puede **leer y escribir** memoria en cualquier momento de la sesión, no solo recibir un snapshot al inicio. Con un proveedor de embeddings opcional, `fact_search` rankea por similitud semántica en vez de buscar por substring.

The bot exposes your SQLite memory to OpenCode via a local MCP server — the assistant can **read and write** memory at any point during a session, not just receive a snapshot at start. With an optional embedding provider, `fact_search` ranks by semantic similarity instead of substring matching.

---

## ⚡ Quick Start

```bash
git clone https://github.com/JohanYP/Opencode-Assistant.git
cd Opencode-Assistant
./setup.sh
```

10 pasos guiados → bot funcional. Detalles abajo.

---

# 🇪🇸 Español

## Qué es

Un bot de Telegram que convierte a [**OpenCode**](https://opencode.ai) en un asistente personal de IA mobile-first. Te da:

- 🧠 **Memoria persistente** — datos, preferencias, contexto de proyectos, resúmenes de sesión, todo en SQLite y consultable en vivo vía herramientas MCP
- 🔍 **Búsqueda semántica opcional** — embebe tus datos con [Ollama](https://ollama.com) (local, gratis) u OpenAI/Groq/Together (cloud) y la búsqueda entiende paráfrasis e idiomas
- 🪄 **Compatibilidad con SKILL.md de OpenClaw** — pega cualquier `SKILL.md` del ecosistema [openclaw-skills](https://github.com/topics/openclaw-skills) y funciona
- ⏰ **Tareas programadas** — tres tipos (correr una sesión OpenCode, mandar un recordatorio, hacer backup de memoria)
- 🎙️ **Voz** — STT con Whisper + TTS con Speechify/OpenAI/Edge, enviado como nota de voz de Telegram
- 🔒 **Single-user, auto-alojado** — whitelist estricta; tus datos, tu VPS
- 🌍 **6 idiomas** — en / es / de / fr / ru / zh

## Por qué usarlo

- **No quieres pagar nada.** El modelo `big-pickle` (Claude Sonnet) viene incluido sin API key. **Edge TTS** (voces neurales de Microsoft) funciona sin key ni cuota. Speechify TTS y Groq Whisper STT tienen tier gratis suficiente. Ollama para vectores corre en tu máquina, también gratis.
- **Ya tienes skills de OpenClaw.** Pegas el `SKILL.md` en `memory/skills/` o lo instalas con `/skill_install <url>` desde GitHub — funciona igual que en Claude Desktop o el runtime de OpenClaw.
- **Quieres tu memoria, no la de OpenAI.** SQLite local, MCP standard, exportable a markdown cuando quieras irte. Sin lock-in.
- **Lo quieres en el celular.** Otros frameworks son CLI-only o desktop apps; este es Telegram desde el primer commit.

## Requisitos

### Mínimos (sin memoria vectorial)
- 1 GB RAM, 5 GB de disco
- Docker 20.10+ con Compose v2
- Cuenta de Telegram + token de [@BotFather](https://t.me/BotFather)
- Tu user ID de [@userinfobot](https://t.me/userinfobot)

### Recomendados (con memoria vectorial Ollama)
- 2 GB RAM, 7 GB de disco
- Mismos requisitos de Docker
- [Ollama](https://ollama.com) instalado en el host
- ~270 MB extra para el modelo `nomic-embed-text`
- Sin GPU — embeddings rápidos en CPU

## Instalación rápida — Linux (Ubuntu/Debian/Fedora/Arch)

```bash
# 1. Clonar
git clone https://github.com/JohanYP/Opencode-Assistant.git
cd Opencode-Assistant

# 2. Instalar Docker si no lo tienes
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# 3. Wizard interactivo (10 pasos)
./setup.sh
```

El wizard genera `.env`, todos los archivos de memoria, y arranca Docker automáticamente. Abres Telegram, hablas con tu bot. Listo.

### Instalación manual (sin wizard)

```bash
git clone https://github.com/JohanYP/Opencode-Assistant.git
cd Opencode-Assistant
cp .env.example .env
# Edita .env: TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_ID
docker compose up -d
docker compose logs -f bot
```

## Instalación rápida — Windows (Git Bash)

> Todos los comandos van en Git Bash (no CMD ni PowerShell). Si no lo tienes: https://git-scm.com/download/win.

```bash
# 1. Instalar Docker Desktop para Windows con backend WSL 2
#    https://docs.docker.com/desktop/install/windows-install/

# 2. En Git Bash:
git clone https://github.com/JohanYP/Opencode-Assistant.git
cd Opencode-Assistant
./setup.sh

# 3. Si setup.sh falla en Windows, usa el flujo manual:
cp .env.example .env
# Edita .env en cualquier editor (Notepad, VS Code, ...)
docker compose up -d
docker compose logs -f bot
```

> **Nota Windows:** `host.docker.internal` ya funciona nativamente con Docker Desktop, así que el setup opcional de Ollama de abajo funciona sin configuración extra.

## Opcional: memoria vectorial con Ollama (recomendado)

La memoria vectorial hace que `fact_search` sea semántica en vez de búsqueda por substring. Activa los vectores en tres pasos.

### Linux

```bash
# 1. Instalar Ollama en el host (no dentro del contenedor)
curl -fsSL https://ollama.com/install.sh | sh

# 2. Hacer que escuche en todas las interfaces (Docker no alcanza 127.0.0.1)
sudo mkdir -p /etc/systemd/system/ollama.service.d
echo '[Service]'                              | sudo tee /etc/systemd/system/ollama.service.d/override.conf
echo 'Environment="OLLAMA_HOST=0.0.0.0:11434"' | sudo tee -a /etc/systemd/system/ollama.service.d/override.conf
sudo systemctl daemon-reload && sudo systemctl restart ollama

# 3. Bloquear el puerto desde internet (seguridad)
sudo ufw deny 11434/tcp 2>/dev/null || true

# 4. Bajar el modelo de embeddings (~270 MB)
ollama pull nomic-embed-text

# 5. Configurar el bot
cat >> .env <<'EOF'
EMBEDDING_BASE_URL=http://host.docker.internal:11434/v1
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_API_KEY=
EOF

# 6. Reiniciar y backfill
docker compose restart bot
# En Telegram: /memory_reembed
```

### Windows (Ollama Desktop)

```bash
# 1. Instalar Ollama Desktop
#    https://ollama.com/download/windows

# 2. PowerShell admin (una vez, para exponerlo a Docker):
#    setx OLLAMA_HOST "0.0.0.0:11434"
#    Reinicia Ollama desde la bandeja del sistema.

# 3. Git Bash:
ollama pull nomic-embed-text

# 4. Editar .env:
echo "EMBEDDING_BASE_URL=http://host.docker.internal:11434/v1" >> .env
echo "EMBEDDING_MODEL=nomic-embed-text" >> .env
echo "EMBEDDING_API_KEY=" >> .env

# 5. Reiniciar y backfill
docker compose restart bot
# En Telegram: /memory_reembed
```

### Alternativa cloud (OpenAI, Groq, ...)

```env
EMBEDDING_BASE_URL=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=sk-...
```

Guía completa y troubleshooting: [`docs/VECTOR_MEMORY.md`](./docs/VECTOR_MEMORY.md).

## Actualizar

```bash
opencode-assistant --update
```

Smart update: hace backup automático de tu memoria y configs, detecta qué containers necesitan rebuild, y solo reconstruye lo que cambió. Los demás servicios siguen corriendo durante todo el proceso. Más detalles: [`docs/CLI_USAGE.md`](./docs/CLI_USAGE.md).

Si no tienes el CLI instalado todavía (porque hiciste `git clone` antes de que existiera): `sudo ln -sf $(pwd)/bin/opencode-assistant /usr/local/bin/opencode-assistant`. O fallback manual: `git pull && docker compose up -d --build`.

La memoria persiste en `./memory/` (volumen montado), las actualizaciones nunca pierden estado.

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
| `/memory_reembed` | Recalcular embeddings |
| `/inline_facts <on\|off\|N>` | Cuántos datos inyectar al iniciar sesión |
| `/personality [texto]` | Reglas de comportamiento ("dime siempre señor", etc.) |
| `/show_tools <on\|off>` | Mostrar/ocultar mensajes de herramientas |
| `/listskill` · `/skill <nombre>` | Explorar skills |
| `/skill_install <url>` · `/skill_update` · `/skill_remove` · `/skill_verify` | Gestión de skills |

## Documentación

- [`docs/QUICK_DEMO.md`](./docs/QUICK_DEMO.md) — primeros 5 minutos
- [`docs/CLI_USAGE.md`](./docs/CLI_USAGE.md) — manual del comando `opencode-assistant`
- [`docs/TTS_PROVIDERS.md`](./docs/TTS_PROVIDERS.md) — Edge / Speechify / OpenAI / Google y `/tts`
- [`docs/MCP_INTEGRATION.md`](./docs/MCP_INTEGRATION.md) — cómo MCP se conecta a OpenCode
- [`docs/VECTOR_MEMORY.md`](./docs/VECTOR_MEMORY.md) — guía completa de memoria vectorial
- [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md) — síntoma → solución
- [`PRODUCT.md`](./PRODUCT.md) y [`CONCEPT.md`](./CONCEPT.md) — visión y límites

## Licencia

[MIT](LICENSE) — tus datos, tu setup, tus reglas.

---

# 🇬🇧 English

## What is this

A Telegram bot that turns [**OpenCode**](https://opencode.ai) into a mobile-first personal AI assistant. You get:

- 🧠 **Persistent memory** — facts, preferences, project context, session summaries, all in SQLite and live-queryable via MCP tools
- 🔍 **Optional semantic search** — embed your facts with [Ollama](https://ollama.com) (local, free) or OpenAI/Groq/Together (cloud) and search understands paraphrasing and languages
- 🪄 **OpenClaw `SKILL.md` compatibility** — drop any `SKILL.md` from the [openclaw-skills](https://github.com/topics/openclaw-skills) ecosystem and it works
- ⏰ **Scheduled tasks** — three types (run an OpenCode session, send a reminder, back up memory)
- 🎙️ **Voice** — Whisper STT + Speechify/OpenAI/Edge TTS, sent as Telegram voice notes
- 🔒 **Single-user, self-hosted** — strict whitelist; your data, your VPS
- 🌍 **6 languages** — en / es / de / fr / ru / zh

## Why use it

- **You don't want to pay anything.** The `big-pickle` model (Claude Sonnet) is included with no API key. **Edge TTS** (Microsoft neural voices) works with no key and no quota. Speechify TTS and Groq Whisper STT have generous free tiers. Ollama for vectors runs locally, also free.
- **You already have OpenClaw skills.** Drop a `SKILL.md` into `memory/skills/` or install one with `/skill_install <url>` from GitHub — it works the same as in Claude Desktop or the OpenClaw runtime.
- **You want your memory, not OpenAI's.** Local SQLite, MCP standard, exportable to markdown whenever you want to leave. No lock-in.
- **You want it on your phone.** Other frameworks are CLI-only or desktop apps; this is Telegram from commit one.

## Requirements

### Minimum (without vector memory)
- 1 GB RAM, 5 GB disk
- Docker 20.10+ with Compose v2
- Telegram account + bot token from [@BotFather](https://t.me/BotFather)
- Your user ID from [@userinfobot](https://t.me/userinfobot)

### Recommended (with Ollama vector memory)
- 2 GB RAM, 7 GB disk
- Same Docker requirements
- [Ollama](https://ollama.com) installed on the host
- ~270 MB extra for the `nomic-embed-text` embedding model
- No GPU — embeddings run fast on CPU

## Quick install — Linux (Ubuntu/Debian/Fedora/Arch)

```bash
# 1. Clone
git clone https://github.com/JohanYP/Opencode-Assistant.git
cd Opencode-Assistant

# 2. Install Docker if you don't have it
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# 3. Run the guided setup wizard (10 steps)
./setup.sh
```

The wizard generates `.env`, all memory files, and launches Docker automatically. Open Telegram, talk to your bot. Done.

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

> All commands use Git Bash (not CMD/PowerShell). Install Git for Windows first: https://git-scm.com/download/win.

```bash
# 1. Install Docker Desktop for Windows with WSL 2 backend
#    https://docs.docker.com/desktop/install/windows-install/

# 2. In Git Bash:
git clone https://github.com/JohanYP/Opencode-Assistant.git
cd Opencode-Assistant
./setup.sh

# 3. If setup.sh fails on Windows, use the manual flow:
cp .env.example .env
# Edit .env in any editor (Notepad, VS Code, ...)
docker compose up -d
docker compose logs -f bot
```

> **Windows note:** `host.docker.internal` already works natively on Docker Desktop, so the optional Ollama setup below works without extra config.

## Optional: vector memory with Ollama (recommended)

Vector memory makes `fact_search` semantic instead of substring-based. Three steps to enable.

### Linux

```bash
# 1. Install Ollama on the host (not inside the container)
curl -fsSL https://ollama.com/install.sh | sh

# 2. Make Ollama listen on all interfaces (Docker can't reach 127.0.0.1)
sudo mkdir -p /etc/systemd/system/ollama.service.d
echo '[Service]'                              | sudo tee /etc/systemd/system/ollama.service.d/override.conf
echo 'Environment="OLLAMA_HOST=0.0.0.0:11434"' | sudo tee -a /etc/systemd/system/ollama.service.d/override.conf
sudo systemctl daemon-reload && sudo systemctl restart ollama

# 3. Block the port from public internet (security)
sudo ufw deny 11434/tcp 2>/dev/null || true

# 4. Pull the embedding model (~270 MB)
ollama pull nomic-embed-text

# 5. Wire it into the bot
cat >> .env <<'EOF'
EMBEDDING_BASE_URL=http://host.docker.internal:11434/v1
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_API_KEY=
EOF

# 6. Restart and backfill
docker compose restart bot
# In Telegram: /memory_reembed
```

### Windows (Ollama Desktop)

```bash
# 1. Install Ollama Desktop
#    https://ollama.com/download/windows

# 2. PowerShell admin (once, to expose to Docker):
#    setx OLLAMA_HOST "0.0.0.0:11434"
#    Restart Ollama from the system tray.

# 3. Git Bash:
ollama pull nomic-embed-text

# 4. Edit .env:
echo "EMBEDDING_BASE_URL=http://host.docker.internal:11434/v1" >> .env
echo "EMBEDDING_MODEL=nomic-embed-text" >> .env
echo "EMBEDDING_API_KEY=" >> .env

# 5. Restart and backfill
docker compose restart bot
# In Telegram: /memory_reembed
```

### Cloud alternative (OpenAI, Groq, ...)

```env
EMBEDDING_BASE_URL=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=sk-...
```

Full guide and troubleshooting: [`docs/VECTOR_MEMORY.md`](./docs/VECTOR_MEMORY.md).

## Updating

```bash
opencode-assistant --update
```

Smart update: snapshots your memory + configs first, fetches origin, detects which containers actually need a rebuild, and rebuilds only those. The other services keep running through the whole flow. Full reference: [`docs/CLI_USAGE.md`](./docs/CLI_USAGE.md).

If you cloned before the CLI existed and the symlink isn't installed yet: `sudo ln -sf $(pwd)/bin/opencode-assistant /usr/local/bin/opencode-assistant`. Or manual fallback: `git pull && docker compose up -d --build`.

Memory persists in `./memory/` (mounted volume), so updates never lose state.

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
| `/memory_search <query>` | Search (vector if enabled, LIKE otherwise) |
| `/memory_remove <id>` | Delete a fact by id |
| `/memory_export` | Dump everything to markdown files |
| `/memory_reembed` | Recompute embeddings |
| `/inline_facts <on\|off\|N>` | Tune how many facts get inlined at session start |
| `/personality [text]` | User-defined behaviour rules ("always address me as 'sir'", etc.) |
| `/show_tools <on\|off>` | Toggle tool-call messages in chat |
| `/listskill` · `/skill <name>` | Browse skills |
| `/skill_install <url>` · `/skill_update` · `/skill_remove` · `/skill_verify` | Skill lifecycle |

## Documentation

- [`docs/QUICK_DEMO.md`](./docs/QUICK_DEMO.md) — first 5 minutes after install
- [`docs/CLI_USAGE.md`](./docs/CLI_USAGE.md) — `opencode-assistant` command reference
- [`docs/TTS_PROVIDERS.md`](./docs/TTS_PROVIDERS.md) — Edge / Speechify / OpenAI / Google + `/tts`
- [`docs/MCP_INTEGRATION.md`](./docs/MCP_INTEGRATION.md) — how memory tools wire into OpenCode
- [`docs/VECTOR_MEMORY.md`](./docs/VECTOR_MEMORY.md) — full vector memory guide
- [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md) — symptom → fix
- [`PRODUCT.md`](./PRODUCT.md) and [`CONCEPT.md`](./CONCEPT.md) — vision and boundaries

## License

[MIT](LICENSE) — your data, your setup, your rules.

---

## ⭐ ¿Te sirve? / Found this useful?

**ES:** Si el proyecto te ahorró tiempo o dinero, una ⭐ en GitHub ayuda muchísimo a que más gente lo encuentre. También puedes:
- Compartir tu setup con `#OpencodeAssistant` en redes
- Abrir un issue con tu caso de uso
- Mandar PRs con skills nuevas, traducciones, fixes

**EN:** If this saved you time or money, a ⭐ on GitHub helps it reach more people. You can also:
- Share your setup with `#OpencodeAssistant` on socials
- Open an issue with your use case
- Send PRs with new skills, translations, or fixes

## 🙏 Agradecimientos / Acknowledgments

Construido sobre / Built on top of:

- **[OpenCode](https://opencode.ai)** by [SST](https://github.com/sst/opencode) — the AI coding agent under the hood
- **[OpenClaw skills ecosystem](https://github.com/topics/openclaw-skills)** — the `SKILL.md` standard
- **[Ollama](https://ollama.com)** — local embedding inference
- **[Speechify](https://api.speechify.ai)** — free TTS API
- **[Groq](https://console.groq.com)** — free Whisper STT API
- **[grammY](https://grammy.dev)** — Telegram bot framework
- **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** — synchronous SQLite for Node

---

**Keywords:** OpenCode · OpenClaw · OpenFang · Claude Sonnet · MCP · Model Context Protocol · Ollama · vector memory · semantic search · embeddings · Telegram bot · AI assistant · self-hosted · personal AI · claude-skills · SKILL.md · big-pickle · cron jobs · Whisper STT · Speechify TTS · SQLite · openclaw-skills · sst/opencode · CrewAI · AutoGen · LangGraph · ZeroClaw · agent framework
