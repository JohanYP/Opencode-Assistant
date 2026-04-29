#!/usr/bin/env bash
set -euo pipefail

# =============================================================
# Opencode Personal Assistant — Interactive Setup Wizard
# =============================================================

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
MEMORY_DIR="$SCRIPT_DIR/memory"
SOUL_FILE="$MEMORY_DIR/soul.md"
CRON_FILE="$MEMORY_DIR/cron.yml"

print_header() {
  echo ""
  echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}${BOLD}║    Opencode Personal Assistant — Setup       ║${NC}"
  echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
  echo ""
}

print_step() {
  echo ""
  echo -e "${CYAN}${BOLD}── $1 ──────────────────────────────────${NC}"
}

print_ok() {
  echo -e "${GREEN}✓${NC} $1"
}

print_warn() {
  echo -e "${YELLOW}⚠${NC}  $1"
}

print_err() {
  echo -e "${RED}✗${NC} $1"
}

ask() {
  local prompt="$1"
  local default="${2:-}"
  local answer

  if [[ -n "$default" ]]; then
    echo -ne "${BOLD}→${NC} $prompt (default: $default): " >&2
    read -r answer < /dev/tty
    echo "${answer:-$default}"
  else
    echo -ne "${BOLD}→${NC} $prompt: " >&2
    read -r answer < /dev/tty
    echo "$answer"
  fi
}

ask_yn() {
  local prompt="$1"
  local default="${2:-S}"
  local answer

  echo -ne "${BOLD}→${NC} $prompt [S/n]: " >&2
  read -r answer < /dev/tty
  answer="${answer:-$default}"
  [[ "${answer,,}" =~ ^(s|y|si|yes)$ ]]
}

ask_choice() {
  local prompt="$1"
  shift
  local options=("$@")
  local choice

  # Print options to stderr so they are visible even when called inside $(...)
  for i in "${!options[@]}"; do
    echo "  $((i+1))) ${options[$i]}" >&2
  done

  while true; do
    # Read from /dev/tty so it works inside $(...) subshells
    # Prompt goes to stderr so it is always visible
    echo -ne "${BOLD}→${NC} $prompt [1-${#options[@]}]: " >&2
    read -r choice < /dev/tty
    if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#options[@]} )); then
      echo "$choice"
      return
    fi
    echo "  Please enter a number between 1 and ${#options[@]}" >&2
  done
}

# ── Detect timezone ─────────────────────────────────────────
detect_timezone() {
  if command -v timedatectl &>/dev/null; then
    timedatectl show --property=Timezone --value 2>/dev/null || echo "UTC"
  elif [[ -f /etc/timezone ]]; then
    cat /etc/timezone
  elif [[ -L /etc/localtime ]]; then
    readlink /etc/localtime | sed 's|.*/zoneinfo/||'
  else
    echo "UTC"
  fi
}

# ── Validate Telegram token via getMe ───────────────────────
validate_telegram_token() {
  local token="$1"
  local result
  result=$(curl -s "https://api.telegram.org/bot${token}/getMe" 2>/dev/null || echo '{}')
  if echo "$result" | grep -q '"ok":true'; then
    echo "$result" | grep -o '"username":"[^"]*"' | cut -d'"' -f4
    return 0
  fi
  return 1
}

# ── Install OpenCode binary ──────────────────────────────────
install_opencode_binary() {
  # Method 1: official installer (correct URL)
  if curl -fsSL https://opencode.ai/install | sh 2>/dev/null; then
    return 0
  fi

  # Method 2: npm global install
  if command -v npm &>/dev/null; then
    echo "  Trying npm install..."
    if npm install -g opencode-ai 2>/dev/null; then
      return 0
    fi
  fi

  # Method 3: bun
  if command -v bun &>/dev/null; then
    echo "  Trying bun install..."
    if bun install -g opencode-ai 2>/dev/null; then
      return 0
    fi
  fi

  return 1
}

# ── Install OpenCode as a system service ────────────────────
install_opencode_service() {
  local os="$1"
  local user="$USER"

  # Install OpenCode binary if not present
  if ! command -v opencode &>/dev/null; then
    echo ""
    echo "  OpenCode is not installed. Installing..."
    if install_opencode_binary; then
      # Reload PATH — try all known install locations
      for dir in "$HOME/.local/bin" "$HOME/bin" "$HOME/.bun/bin" \
                 "/usr/local/bin" "$HOME/.npm-global/bin" \
                 "$HOME/.nvm/versions/node/$(node -v 2>/dev/null)/bin"; do
        [[ -d "$dir" ]] && export PATH="$dir:$PATH"
      done
      # Source profile to pick up any PATH changes from the installer
      [[ -f "$HOME/.profile" ]] && source "$HOME/.profile" 2>/dev/null || true
      [[ -f "$HOME/.bashrc" ]] && source "$HOME/.bashrc" 2>/dev/null || true

      if command -v opencode &>/dev/null; then
        print_ok "OpenCode installed: $(command -v opencode)"
      else
        print_warn "OpenCode installed but binary not found in PATH."
        print_warn "You may need to open a new terminal and re-run setup.sh"
      fi
    else
      print_err "Automatic installation failed."
      echo ""
      echo "  Please install OpenCode manually, then re-run setup.sh:"
      echo ""
      echo "    curl -fsSL https://opencode.ai/install | sh"
      echo "    # or: npm install -g opencode-ai"
      echo ""
      echo -ne "${BOLD}→${NC} Is OpenCode installed and working? Continue? [S/n]: "
      read -r _continue_answer < /dev/tty
      _continue_answer="${_continue_answer:-S}"
      if [[ ! "${_continue_answer,,}" =~ ^(s|y|si|yes)$ ]]; then
        exit 1
      fi
    fi
  else
    print_ok "OpenCode already installed: $(command -v opencode)"
  fi

  if [[ "$os" == "linux" ]]; then
    install_opencode_systemd "$user"
  elif [[ "$os" == "macos" ]]; then
    install_opencode_launchd
  else
    print_warn "Automatic service setup not supported on this OS."
    print_warn "Please run 'opencode serve --port 4096' manually and keep it running."
  fi
}

install_opencode_systemd() {
  local user="$1"
  local opencode_bin
  opencode_bin="$(command -v opencode)"
  local service_file="/etc/systemd/system/opencode.service"

  echo ""
  echo "  Creating systemd service for OpenCode..."

  if [[ $EUID -ne 0 ]]; then
    # Use user systemd if not root
    local user_service_dir="$HOME/.config/systemd/user"
    mkdir -p "$user_service_dir"
    service_file="$user_service_dir/opencode.service"

    cat > "$service_file" << EOF
[Unit]
Description=OpenCode Server
After=network.target

[Service]
Type=simple
ExecStart=${opencode_bin} serve --port 4096
Restart=always
RestartSec=5
Environment=HOME=${HOME}

[Install]
WantedBy=default.target
EOF

    systemctl --user daemon-reload
    systemctl --user enable opencode
    systemctl --user start opencode
    print_ok "OpenCode user service installed and started"
    print_ok "OpenCode will start automatically when you log in"
  else
    cat > "$service_file" << EOF
[Unit]
Description=OpenCode Server
After=network.target

[Service]
Type=simple
User=${user}
ExecStart=${opencode_bin} serve --port 4096
Restart=always
RestartSec=5
Environment=HOME=/home/${user}

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable opencode
    systemctl start opencode
    print_ok "OpenCode system service installed and started"
    print_ok "OpenCode will start automatically on boot"
  fi
}

install_opencode_launchd() {
  local opencode_bin
  opencode_bin="$(command -v opencode)"
  local plist="$HOME/Library/LaunchAgents/ai.opencode.server.plist"

  mkdir -p "$HOME/Library/LaunchAgents"

  cat > "$plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.opencode.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>${opencode_bin}</string>
    <string>serve</string>
    <string>--port</string>
    <string>4096</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.opencode/server.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.opencode/server.log</string>
</dict>
</plist>
EOF

  launchctl load "$plist" 2>/dev/null || true
  print_ok "OpenCode LaunchAgent installed and started"
  print_ok "OpenCode will start automatically on login"
}

# ── Generate soul.md from wizard answers ────────────────────
generate_soul() {
  local name="$1"
  local lang="$2"
  local tone="$3"
  local extra="$4"

  local tone_desc
  case "$tone" in
    1) tone_desc="Direct and concise — get to the point, avoid unnecessary words" ;;
    2) tone_desc="Friendly and conversational — warm, approachable, use informal language" ;;
    3) tone_desc="Technical and detailed — thorough explanations, include relevant details" ;;
    *) tone_desc="Direct and concise" ;;
  esac

  cat > "$SOUL_FILE" << EOF
# Soul — ${name}

You are ${name}, an intelligent and proactive personal assistant powered by OpenCode.

## Language
Respond in: ${lang}
Adapt to the user's language if they write in a different one.

## Personality & Tone
${tone_desc}

## Behavior
- When the user asks you to remember something, update \`memory/memory.md\`
- Use \`memory/context.md\` to understand the current project or focus area
- Follow \`memory/agents.md\` to choose the right agent for each task
- Default model: big-pickle (Claude Sonnet — completely free)

## Skills
You have access to the following skills in \`memory/skills/\`:
- **web-search** — search for information on the internet
- **code-review** — review code and suggest improvements
- **daily-summary** — generate a daily summary of activity

When a task requires a skill, read its instructions from \`memory/skills/<name>.md\`
and apply them to complete the task.

## Memory Rules
- Add facts, preferences, and important notes to \`memory/memory.md\`
- Keep \`memory/context.md\` updated with the active project
- Never modify \`memory/soul.md\` — it is read-only
$(if [[ -n "$extra" ]]; then echo -e "\n## Special Instructions\n${extra}"; fi)
EOF
}

# ── Generate cron.yml with correct timezone ─────────────────
generate_cron_yml() {
  local tz="$1"

  cat > "$CRON_FILE" << EOF
# Cron Jobs — Opencode Personal Assistant
# Changes here are automatically synced with the bot.
#
# Types:
#   task     — creates an OpenCode session and runs the prompt (default)
#   reminder — sends a direct Telegram message (no tokens used)
#   backup   — copies memory files to memory/backups/YYYY-MM-DD/
#
# Schedule: standard cron expression (min hour dom month dow)

crons: []

# Examples (uncomment to enable):
#
#  - id: daily-summary
#    schedule: "0 8 * * *"
#    type: task
#    prompt: "Generate a daily summary using the daily-summary skill"
#    timezone: "${tz}"
#
#  - id: morning-reminder
#    schedule: "30 7 * * 1-5"
#    type: reminder
#    message: "Good morning! Check your pending tasks."
#    timezone: "${tz}"
#
#  - id: weekly-backup
#    schedule: "0 0 * * 0"
#    type: backup
#    timezone: "${tz}"
EOF
}

# ────────────────────────────────────────────────────────────
# MAIN WIZARD
# ────────────────────────────────────────────────────────────
main() {
  print_header

  echo "Welcome to the Opencode Personal Assistant setup wizard."
  echo "Answer the following questions to configure your assistant."

  # ── Check dependencies ───────────────────────────────────
  for dep in curl docker; do
    if ! command -v "$dep" &>/dev/null; then
      print_err "Required dependency not found: $dep"
      echo "  Please install $dep and run this wizard again."
      exit 1
    fi
  done

  if ! docker compose version &>/dev/null 2>&1; then
    print_err "docker compose (v2) is required but not found."
    echo "  Please install Docker with Compose v2: https://docs.docker.com/compose/"
    exit 1
  fi

  # ── Handle existing .env ─────────────────────────────────
  if [[ -f "$ENV_FILE" ]]; then
    echo ""
    print_warn ".env file already exists."
    if ! ask_yn "Overwrite it with new configuration?"; then
      echo "Setup cancelled. Your existing .env was not modified."
      exit 0
    fi
  fi

  # ──────────────────────────────────────────────────────────
  # STEP 1 — Installation mode
  # ──────────────────────────────────────────────────────────
  print_step "STEP 1/10 — Installation Mode"

  echo ""
  echo "  How do you want to install the assistant?"
  echo ""
  echo -e "  ${BOLD}1) Full Docker — Everything in Docker (Recommended)${NC}"
  echo "     OpenCode + Bot run in isolated containers."
  echo "     Best for any environment: VPS, servers, or PCs where"
  echo "     you prefer security and isolation."
  echo ""
  echo -e "  ${BOLD}2) Bot-only — Only the bot in Docker${NC}"
  echo -e "     ${YELLOW}⚠ Only for trusted environments (your personal PC).${NC}"
  echo "     OpenCode runs directly on your machine with access to"
  echo "     your file system. The bot connects to it via the network."
  echo "     setup.sh will install OpenCode as a system service."
  echo ""

  local mode_choice
  mode_choice=$(ask_choice "Choose mode [1-2]" "Full Docker (Recommended)" "Bot-only (trusted environments only)")

  local install_mode="full"
  local opencode_api_url="http://opencode:4096"

  if [[ "$mode_choice" == "2" ]]; then
    install_mode="bot-only"
    # From inside Docker, use host.docker.internal to reach the host machine.
    # extra_hosts in docker-compose.yml maps this to host-gateway automatically.
    opencode_api_url="http://host.docker.internal:4096"

    echo ""
    echo -e "${YELLOW}${BOLD}  ⚠ WARNING — BOT-ONLY MODE ⚠${NC}"
    echo ""
    echo "  OpenCode will run directly on your machine with access"
    echo "  to your file system. Only continue if:"
    echo ""
    echo "  ✓ This is your personal PC and you trust the environment"
    echo "  ✓ Your bot has a restricted User ID (only you can use it)"
    echo "  ✓ You understand the assistant can read and modify files"
    echo ""

    if ! ask_yn "I understand the risks and want to continue with bot-only mode?"; then
      echo "Setup cancelled."
      exit 0
    fi
  fi

  print_ok "Mode: $install_mode"

  # ──────────────────────────────────────────────────────────
  # STEP 2 — Bot language
  # ──────────────────────────────────────────────────────────
  print_step "STEP 2/10 — Bot Language"

  echo ""
  local lang_choice
  lang_choice=$(ask_choice "Bot interface language" \
    "Español (es)" \
    "English (en)" \
    "Deutsch (de)" \
    "Français (fr)" \
    "Русский (ru)" \
    "简体中文 (zh)")

  local bot_locale
  case "$lang_choice" in
    1) bot_locale="es" ;;
    2) bot_locale="en" ;;
    3) bot_locale="de" ;;
    4) bot_locale="fr" ;;
    5) bot_locale="ru" ;;
    6) bot_locale="zh" ;;
    *) bot_locale="en" ;;
  esac

  print_ok "Language: $bot_locale"

  # ──────────────────────────────────────────────────────────
  # STEP 3 — Telegram Bot Token
  # ──────────────────────────────────────────────────────────
  print_step "STEP 3/10 — Telegram Bot Token"

  echo ""
  echo "  Create your bot with @BotFather:"
  echo "    1. Open https://t.me/BotFather in Telegram"
  echo "    2. Send /newbot and follow the prompts"
  echo "    3. Copy the bot token you receive"
  echo ""

  local bot_token bot_username
  while true; do
    bot_token=$(ask "Paste your TELEGRAM_BOT_TOKEN")
    if [[ -z "$bot_token" ]]; then
      print_err "Token cannot be empty."
      continue
    fi
    echo "  Validating token..."
    if bot_username=$(validate_telegram_token "$bot_token"); then
      print_ok "Token valid! Bot: @${bot_username}"
      break
    else
      print_err "Invalid token or network error. Please check and try again."
    fi
  done

  # ──────────────────────────────────────────────────────────
  # STEP 4 — Telegram User ID
  # ──────────────────────────────────────────────────────────
  print_step "STEP 4/10 — Your Telegram User ID"

  echo ""
  echo "  Get your numeric user ID:"
  echo "    1. Open https://t.me/userinfobot in Telegram"
  echo "    2. Send any message"
  echo "    3. Copy your numeric ID (e.g. 123456789)"
  echo ""
  echo "  ⚠ Only this ID will be able to interact with your bot."
  echo ""

  local user_id
  while true; do
    user_id=$(ask "Paste your TELEGRAM_ALLOWED_USER_ID")
    if [[ "$user_id" =~ ^[0-9]+$ ]]; then
      print_ok "User ID: $user_id"
      break
    else
      print_err "User ID must be a number."
    fi
  done

  # ──────────────────────────────────────────────────────────
  # STEP 5 — AI Model
  # ──────────────────────────────────────────────────────────
  print_step "STEP 5/10 — AI Model"

  echo ""
  local model_choice
  model_choice=$(ask_choice "Which AI model?" \
    "big-pickle — Claude Sonnet (FREE, recommended)" \
    "Anthropic Claude (API key required)" \
    "OpenAI GPT (API key required)" \
    "OpenRouter (free models available)" \
    "Other OpenCode-compatible provider")

  local model_provider="opencode"
  local model_id="big-pickle"
  local extra_model_env=""

  case "$model_choice" in
    1)
      model_provider="opencode"
      model_id="big-pickle"
      print_ok "Model: big-pickle (free)"
      ;;
    2)
      model_provider="anthropic"
      model_id=$(ask "Model ID" "claude-sonnet-4-5")
      local anthropic_key
      anthropic_key=$(ask "Anthropic API key")
      extra_model_env="ANTHROPIC_API_KEY=${anthropic_key}"
      print_ok "Model: $model_provider/$model_id"
      ;;
    3)
      model_provider="openai"
      model_id=$(ask "Model ID" "gpt-4o")
      local openai_key
      openai_key=$(ask "OpenAI API key")
      extra_model_env="OPENAI_API_KEY=${openai_key}"
      print_ok "Model: $model_provider/$model_id"
      ;;
    4)
      model_provider="openrouter"
      model_id=$(ask "Model ID (e.g. meta-llama/llama-3.1-8b-instruct:free)" "meta-llama/llama-3.1-8b-instruct:free")
      local openrouter_key
      openrouter_key=$(ask "OpenRouter API key")
      extra_model_env="OPENROUTER_API_KEY=${openrouter_key}"
      print_ok "Model: $model_provider/$model_id"
      ;;
    5)
      model_provider=$(ask "Provider ID")
      model_id=$(ask "Model ID")
      print_ok "Model: $model_provider/$model_id"
      ;;
  esac

  # ──────────────────────────────────────────────────────────
  # STEP 6 — TTS
  # ──────────────────────────────────────────────────────────
  print_step "STEP 6/10 — Text to Speech (optional)"

  echo ""
  local tts_choice
  tts_choice=$(ask_choice "TTS provider" \
    "No TTS — text only" \
    "Speechify (FREE — 50,000 chars/month, recommended)" \
    "Edge TTS — Microsoft (FREE, no API key)" \
    "OpenAI TTS (API key required)" \
    "Google Cloud TTS (credentials required)")

  local tts_provider=""
  local tts_api_url=""
  local tts_api_key=""
  local tts_model=""
  local tts_voice=""
  local speechify_api_key=""
  local tts_wait_for_idle="true"
  local google_credentials=""

  case "$tts_choice" in
    1)
      tts_provider=""
      print_ok "TTS: disabled"
      ;;
    2)
      tts_provider="speechify"
      echo ""
      echo "  Get your free Speechify API key at https://api.speechify.ai"
      echo "  Free tier: 50,000 characters/month"
      echo ""
      speechify_api_key=$(ask "Paste your SPEECHIFY_API_KEY")
      echo ""
      echo "  Spanish voices: es-ES-elena, es-MX-camila, es-ES-diego"
      echo "  English voices: henry, aria, cliff, bella"
      tts_voice=$(ask "Voice ID" "henry")
      print_ok "TTS: Speechify ($tts_voice)"
      ;;
    3)
      # Edge TTS uses the openai-compatible provider with edge-tts service
      tts_provider="openai"
      tts_api_url="http://localhost:5050/v1"
      tts_voice=$(ask "Edge TTS voice" "es-ES-ElviraNeural")
      tts_model="tts-1"
      print_ok "TTS: Edge TTS ($tts_voice)"
      print_warn "Note: Edge TTS requires a local edge-tts proxy running on port 5050"
      ;;
    4)
      tts_provider="openai"
      tts_api_url=$(ask "TTS API URL" "https://api.openai.com/v1")
      tts_api_key=$(ask "TTS API key")
      tts_model=$(ask "TTS model" "tts-1")
      tts_voice=$(ask "Voice" "alloy")
      print_ok "TTS: OpenAI ($tts_voice)"
      ;;
    5)
      tts_provider="google"
      google_credentials=$(ask "Path to Google service account JSON" "/app/gcloud-key.json")
      tts_voice=$(ask "Voice" "en-US-Studio-O")
      print_ok "TTS: Google Cloud ($tts_voice)"
      ;;
  esac

  # ──────────────────────────────────────────────────────────
  # STEP 7 — STT
  # ──────────────────────────────────────────────────────────
  print_step "STEP 7/10 — Voice Messages / Speech to Text (optional)"

  echo ""
  local stt_choice
  stt_choice=$(ask_choice "STT provider" \
    "No STT — no voice messages" \
    "Groq Whisper (FREE, generous limit, recommended)" \
    "OpenAI Whisper (API key required)" \
    "Other Whisper-compatible API")

  local stt_api_url=""
  local stt_api_key=""
  local stt_model=""

  local stt_hide_recognized="true"

  case "$stt_choice" in
    1)
      print_ok "STT: disabled"
      ;;
    2)
      echo ""
      echo "  Get your free Groq API key at https://console.groq.com"
      echo ""
      stt_api_url="https://api.groq.com/openai/v1"
      stt_api_key=$(ask "Paste your Groq API key")
      stt_model="whisper-large-v3-turbo"
      print_ok "STT: Groq Whisper"
      ;;
    3)
      stt_api_url="https://api.openai.com/v1"
      stt_api_key=$(ask "OpenAI API key")
      stt_model="whisper-1"
      print_ok "STT: OpenAI Whisper"
      ;;
    4)
      stt_api_url=$(ask "STT API URL")
      stt_api_key=$(ask "STT API key")
      stt_model=$(ask "STT model" "whisper-large-v3-turbo")
      print_ok "STT: custom ($stt_api_url)"
      ;;
  esac

  # Ask about hiding recognized text only if STT is enabled
  if [[ "$stt_choice" != "1" ]]; then
    echo ""
    echo "  When you send a voice message, the transcribed text can be"
    echo "  shown in the chat or hidden (only sent silently to the assistant)."
    echo ""
    if ask_yn "Hide the transcribed text in the chat? (recommended)"; then
      stt_hide_recognized="true"
      print_ok "Transcribed text will be hidden"
    else
      stt_hide_recognized="false"
      print_ok "Transcribed text will be shown in chat"
    fi
  fi

  # ──────────────────────────────────────────────────────────
  # STEP 8 — Timezone
  # ──────────────────────────────────────────────────────────
  print_step "STEP 8/10 — Timezone (for cron jobs)"

  echo ""
  local detected_tz
  detected_tz=$(detect_timezone)
  echo "  Detected timezone: $detected_tz"
  echo ""

  local timezone
  if ask_yn "Use this timezone?" "S"; then
    timezone="$detected_tz"
  else
    timezone=$(ask "Enter your timezone (e.g. America/Bogota, Europe/Madrid)")
  fi

  print_ok "Timezone: $timezone"

  # ──────────────────────────────────────────────────────────
  # STEP 9 — Personality
  # ──────────────────────────────────────────────────────────
  print_step "STEP 9/10 — Assistant Personality"

  echo ""
  echo "  Customize your assistant's personality."
  echo "  (You can edit memory/soul.md at any time.)"
  echo ""

  local assistant_name
  assistant_name=$(ask "Assistant name" "Assistant")

  local assistant_lang
  assistant_lang=$(ask "Default response language" "Same as the user")

  echo ""
  local tone_choice
  tone_choice=$(ask_choice "Tone" \
    "Professional and concise (recommended)" \
    "Friendly and conversational" \
    "Technical and detailed")

  echo ""
  echo "  Optional: add special instructions for your assistant"
  echo "  Example: 'Always respond in bullet points'"
  echo "           'You are an expert in Python and DevOps'"
  echo ""
  local extra_instructions
  extra_instructions=$(ask "Special instructions (Enter to skip)" "")

  print_ok "Personality configured for: $assistant_name"

  # ──────────────────────────────────────────────────────────
  # STEP 10 — Interface options
  # ──────────────────────────────────────────────────────────
  print_step "STEP 10/11 — Interface Options"

  echo ""
  echo "  These options control what messages appear in the chat."
  echo "  Defaults are optimized for a clean, distraction-free experience."
  echo ""

  local hide_thinking="true"
  local hide_footer="true"

  if ask_yn "Show '💭 Thinking...' messages when the assistant is reasoning?" "N"; then
    hide_thinking="false"
    print_ok "Thinking messages: shown"
  else
    hide_thinking="true"
    print_ok "Thinking messages: hidden (default)"
  fi

  echo ""
  if ask_yn "Show run footer (model + elapsed time) after each response?" "N"; then
    hide_footer="false"
    print_ok "Footer: shown (e.g. 🛠️ Build · 🤖 opencode/big-pickle · 🕒 4.2s)"
  else
    hide_footer="true"
    print_ok "Footer: hidden (default)"
  fi

  # ──────────────────────────────────────────────────────────
  # STEP 11 — Skills from OpenClaw ecosystem (optional)
  # ──────────────────────────────────────────────────────────
  print_step "STEP 11/11 — OpenClaw Skills (optional)"

  echo ""
  echo "  Your assistant already includes 3 built-in skills:"
  echo "    • web-search, code-review, daily-summary"
  echo ""
  echo "  You can install additional skills from the OpenClaw ecosystem."
  echo "  Skills are compatible with any SKILL.md format (ClawHub, GitHub, etc.)"
  echo ""
  echo "  Example sources:"
  echo "    github.com/alirezarezvani/claude-skills  (235+ skills)"
  echo "    github.com/topics/openclaw-skills        (700+ repos)"
  echo ""

  local extra_skill_urls=()

  if ask_yn "Install additional skills from GitHub URLs?" "N"; then
    echo ""
    echo "  Paste a raw SKILL.md URL (or GitHub blob URL). Enter to finish."
    echo "  Example: https://raw.githubusercontent.com/alirezarezvani/claude-skills/main/engineering/git-worktree-manager/SKILL.md"
    echo ""

    while true; do
      local skill_url
      skill_url=$(ask "Skill URL (Enter to finish)" "")
      if [[ -z "$skill_url" ]]; then
        break
      fi
      extra_skill_urls+=("$skill_url")
      print_ok "Added: $skill_url"
    done
  fi

  # ──────────────────────────────────────────────────────────
  # SUMMARY and launch
  # ──────────────────────────────────────────────────────────
  print_step "SUMMARY — Review Configuration"

  echo ""
  echo -e "${BOLD}  Configuration Summary${NC}"
  echo "  ─────────────────────────────────────────"
  echo "  Install mode:     $install_mode"
  echo "  Bot language:     $bot_locale"
  echo "  Bot token:        ${bot_token:0:10}... (@${bot_username})"
  echo "  User ID:          $user_id"
  echo "  AI model:         $model_provider/$model_id"
  echo "  TTS:              ${tts_provider:-disabled}"
  echo "  STT:              ${stt_api_url:-disabled}"
  echo "  STT hide text:    $stt_hide_recognized"
  echo "  Timezone:         $timezone"
  echo "  Assistant name:   $assistant_name"
  echo "  Thinking msgs:    $([ "$hide_thinking" = "true" ] && echo "hidden" || echo "shown")"
  echo "  Run footer:       $([ "$hide_footer" = "true" ] && echo "hidden" || echo "shown")"
  echo "  Extra skills:     ${#extra_skill_urls[@]}"
  echo "  ─────────────────────────────────────────"
  echo ""

  if ! ask_yn "Everything looks correct? Proceed?"; then
    echo "Setup cancelled. Run ./setup.sh again to restart."
    exit 0
  fi

  # ──────────────────────────────────────────────────────────
  # GENERATE FILES
  # ──────────────────────────────────────────────────────────
  echo ""
  echo "Generating configuration files..."

  # Generate .env
  cat > "$ENV_FILE" << EOF
# Generated by setup.sh on $(date)
# ─────────────────────────────────────────────────

# Telegram
TELEGRAM_BOT_TOKEN=${bot_token}
TELEGRAM_ALLOWED_USER_ID=${user_id}

# OpenCode
OPENCODE_API_URL=${opencode_api_url}
OPENCODE_MODEL_PROVIDER=${model_provider}
OPENCODE_MODEL_ID=${model_id}
OPENCODE_AUTO_RESTART_ENABLED=false

# Bot
BOT_LOCALE=${bot_locale}
MESSAGE_FORMAT_MODE=markdown
HIDE_TOOL_CALL_MESSAGES=false
HIDE_THINKING_MESSAGES=${hide_thinking}
HIDE_ASSISTANT_FOOTER=${hide_footer}

# Memory
MEMORY_DIR=./memory
MEMORY_INJECT_ENABLED=true

# TTS
TTS_PROVIDER=${tts_provider}
$([ -n "$speechify_api_key" ] && echo "SPEECHIFY_API_KEY=${speechify_api_key}" || echo "# SPEECHIFY_API_KEY=")
$([ -n "$tts_api_url" ] && echo "TTS_API_URL=${tts_api_url}" || echo "# TTS_API_URL=")
$([ -n "$tts_api_key" ] && echo "TTS_API_KEY=${tts_api_key}" || echo "# TTS_API_KEY=")
$([ -n "$tts_model" ] && echo "TTS_MODEL=${tts_model}" || echo "# TTS_MODEL=")
$([ -n "$tts_voice" ] && echo "TTS_VOICE=${tts_voice}" || echo "# TTS_VOICE=")
$([ -n "$google_credentials" ] && echo "GOOGLE_APPLICATION_CREDENTIALS=${google_credentials}" || echo "# GOOGLE_APPLICATION_CREDENTIALS=")
TTS_WAIT_FOR_IDLE=${tts_wait_for_idle}

# STT
$([ -n "$stt_api_url" ] && echo "STT_API_URL=${stt_api_url}" || echo "# STT_API_URL=")
$([ -n "$stt_api_key" ] && echo "STT_API_KEY=${stt_api_key}" || echo "# STT_API_KEY=")
$([ -n "$stt_model" ] && echo "STT_MODEL=${stt_model}" || echo "# STT_MODEL=")
STT_HIDE_RECOGNIZED_TEXT=${stt_hide_recognized}

# Cron
CRON_YML_SYNC=true
CRON_BACKUP_ENABLED=true
CRON_BACKUP_SCHEDULE=0 0 * * 0

$([ -n "$extra_model_env" ] && echo "# Extra model credentials" && echo "${extra_model_env}" || true)
EOF

  print_ok "Generated .env"

  # Generate soul.md
  mkdir -p "$MEMORY_DIR/skills" "$MEMORY_DIR/backups"
  generate_soul "$assistant_name" "$assistant_lang" "$tone_choice" "$extra_instructions"
  print_ok "Generated memory/soul.md"

  # Generate cron.yml
  generate_cron_yml "$timezone"
  print_ok "Generated memory/cron.yml"

  # Initialize empty memory files if missing
  [[ -f "$MEMORY_DIR/memory.md" ]] || echo -e "# Memory\n\n---\n" > "$MEMORY_DIR/memory.md"
  [[ -f "$MEMORY_DIR/context.md" ]] || echo -e "# Context\n\n---\n" > "$MEMORY_DIR/context.md"
  [[ -f "$MEMORY_DIR/agents.md" ]] || cp "$SCRIPT_DIR/memory/agents.md" "$MEMORY_DIR/agents.md" 2>/dev/null || true
  # Initialize session summary if missing
  [[ -f "$MEMORY_DIR/session-summary.md" ]] || cat > "$MEMORY_DIR/session-summary.md" << 'SUMMARY_EOF'
# Session Summary

No previous session recorded yet.

---
*This file is updated automatically by the assistant during sessions.*
SUMMARY_EOF
  print_ok "Memory files ready"

  # Install extra skills from URLs if provided
  if [[ ${#extra_skill_urls[@]} -gt 0 ]]; then
    echo ""
    echo "Installing skills..."
    local skills_dir="$MEMORY_DIR/skills"
    mkdir -p "$skills_dir"

    for skill_url in "${extra_skill_urls[@]}"; do
      # Normalize GitHub blob URLs to raw URLs
      local raw_url="$skill_url"
      if [[ "$skill_url" == *"github.com"* ]] && [[ "$skill_url" == *"/blob/"* ]]; then
        raw_url="${skill_url/github.com/raw.githubusercontent.com}"
        raw_url="${raw_url/\/blob\//\/}"
      fi

      echo "  Downloading: $raw_url"
      local content
      if content=$(curl -sfL "$raw_url" 2>/dev/null); then
        if [[ -n "$content" ]]; then
          # Extract name from frontmatter or URL
          local skill_name
          skill_name=$(echo "$content" | grep -m1 "^name:" | sed 's/^name:[[:space:]]*//' | tr -d '"' | tr -d "'" | tr ' ' '-')
          if [[ -z "$skill_name" ]]; then
            skill_name=$(basename "$raw_url" .md | tr '[:upper:]' '[:lower:]')
          fi
          echo "$content" > "$skills_dir/${skill_name}.md"
          print_ok "Installed skill: $skill_name"
        else
          print_warn "Empty response for: $raw_url"
        fi
      else
        print_warn "Failed to download: $raw_url"
      fi
    done
  fi

  # ── Bot-only mode: install OpenCode service ──────────────
  if [[ "$install_mode" == "bot-only" ]]; then
    echo ""
    echo "Installing OpenCode as a system service..."

    local os="linux"
    if [[ "$(uname)" == "Darwin" ]]; then
      os="macos"
    fi

    install_opencode_service "$os"

    # Wait up to 30s for OpenCode to be ready (poll every 2s)
    echo "  Waiting for OpenCode to start..."
    local attempts=0
    local oc_ready=false
    while (( attempts < 15 )); do
      if curl -sf "http://localhost:4096/v1/health" &>/dev/null 2>&1; then
        oc_ready=true
        break
      fi
      (( attempts++ ))
      sleep 2
    done

    if [[ "$oc_ready" == "true" ]]; then
      print_ok "OpenCode is running at http://localhost:4096"
    else
      print_warn "OpenCode did not respond within 30s."
      echo "  Check the service status:"
      echo "    Linux:  systemctl --user status opencode"
      echo "    macOS:  launchctl list | grep opencode"
      echo "  View logs:"
      echo "    Linux:  journalctl --user -u opencode -n 50"
      echo "    macOS:  cat ~/.opencode/server.log"
      echo ""
      print_warn "The bot will still start — it will retry connecting to OpenCode automatically."
    fi
  fi

  # ──────────────────────────────────────────────────────────
  # LAUNCH
  # ──────────────────────────────────────────────────────────
  echo ""
  if ask_yn "Launch the assistant now with Docker?"; then
    echo ""
    echo "Starting containers..."

    if [[ "$install_mode" == "full" ]]; then
      docker compose --profile full up -d --build
    else
      docker compose up -d --build
    fi

    echo ""
    print_ok "Containers started!"
    echo ""
    echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}${BOLD}║    Your assistant is ready!                  ║${NC}"
    echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  Open Telegram and send a message to: ${BOLD}@${bot_username}${NC}"
    echo "  Send /help to see available commands."
    echo ""
    echo "  Useful commands:"
    echo "    View logs:    docker compose logs -f"
    echo "    Stop:         docker compose down"
    echo "    Reconfigure:  ./setup.sh"
    echo ""
  else
    echo ""
    echo "Setup complete. To launch the assistant, run:"
    if [[ "$install_mode" == "full" ]]; then
      echo -e "  ${BOLD}docker compose --profile full up -d${NC}"
    else
      echo -e "  ${BOLD}docker compose up -d${NC}"
    fi
    echo ""
  fi
}

main "$@"
