#!/usr/bin/env bash
# Entrypoint for the OpenCode container. Generates ~/.config/opencode/opencode.json
# from environment variables before invoking the main command, so the bot's
# memory MCP HTTP server is registered as a remote MCP server in OpenCode's
# native config format and discovered automatically.
#
# Variables read:
#   ASSISTANT_MEMORY_MCP_URL — full URL to the bot's MCP HTTP endpoint
#                              (e.g. http://bot:4097/mcp). When set, an
#                              entry under "opencode-assistant-memory" is
#                              written; when unset, no opencode.json is
#                              touched.

set -e

CONFIG_DIR="${OPENCODE_CONFIG_DIR:-/root/.config/opencode}"
CONFIG_FILE="${CONFIG_DIR}/opencode.json"

mkdir -p "${CONFIG_DIR}"

# Clean up the legacy mcp.json written by a previous iteration of this
# entrypoint. That file used the Claude Desktop schema (mcpServers + url),
# which OpenCode does not read, so leaving it behind is only confusing.
# Only delete it if it actually came from us (recognizable by the
# opencode-assistant-memory key).
LEGACY_MCP="${CONFIG_DIR}/mcp.json"
if [[ -f "${LEGACY_MCP}" ]] && grep -q "opencode-assistant-memory" "${LEGACY_MCP}" 2>/dev/null; then
  echo "[opencode-entrypoint] removing legacy ${LEGACY_MCP} (Claude Desktop schema not read by OpenCode)"
  rm -f "${LEGACY_MCP}"
fi

if [[ -n "${ASSISTANT_MEMORY_MCP_URL:-}" ]]; then
  # If the user already has an opencode.json, leave it alone — they may
  # have customized it. Otherwise write a minimal config registering the
  # bot's MCP HTTP server in OpenCode's native schema.
  if [[ ! -f "${CONFIG_FILE}" ]]; then
    cat > "${CONFIG_FILE}" <<EOF
{
  "mcp": {
    "opencode-assistant-memory": {
      "type": "remote",
      "url": "${ASSISTANT_MEMORY_MCP_URL}"
    }
  }
}
EOF
    echo "[opencode-entrypoint] wrote ${CONFIG_FILE} (mcp -> ${ASSISTANT_MEMORY_MCP_URL})"
  else
    echo "[opencode-entrypoint] ${CONFIG_FILE} already exists; not overwriting"
  fi
else
  echo "[opencode-entrypoint] ASSISTANT_MEMORY_MCP_URL not set; skipping opencode.json generation"
fi

exec "$@"
