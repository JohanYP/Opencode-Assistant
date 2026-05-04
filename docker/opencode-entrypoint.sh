#!/usr/bin/env bash
# Entrypoint for the OpenCode container. Generates ~/.config/opencode/mcp.json
# from environment variables before invoking the main command, so the bot's
# MCP HTTP server is discovered automatically without manual config.
#
# Variables read:
#   ASSISTANT_MEMORY_MCP_URL — full URL to the bot's MCP HTTP endpoint
#                              (e.g. http://bot:4097/mcp). When set, an
#                              entry under "opencode-assistant-memory" is
#                              written; when unset, no mcp.json is touched.

set -e

CONFIG_DIR="${OPENCODE_CONFIG_DIR:-/root/.config/opencode}"
MCP_FILE="${CONFIG_DIR}/mcp.json"

mkdir -p "${CONFIG_DIR}"

if [[ -n "${ASSISTANT_MEMORY_MCP_URL:-}" ]]; then
  # If a user already provided their own mcp.json, leave it untouched —
  # they probably know what they want. Otherwise write a minimal config
  # pointing at the bot's HTTP server.
  if [[ ! -f "${MCP_FILE}" ]]; then
    cat > "${MCP_FILE}" <<EOF
{
  "mcpServers": {
    "opencode-assistant-memory": {
      "url": "${ASSISTANT_MEMORY_MCP_URL}"
    }
  }
}
EOF
    echo "[opencode-entrypoint] wrote ${MCP_FILE} pointing at ${ASSISTANT_MEMORY_MCP_URL}"
  else
    echo "[opencode-entrypoint] ${MCP_FILE} already exists; not overwriting"
  fi
else
  echo "[opencode-entrypoint] ASSISTANT_MEMORY_MCP_URL not set; skipping mcp.json generation"
fi

exec "$@"
