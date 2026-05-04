#!/usr/bin/env bash
# Entrypoint for the OpenCode container. Reconciles
# ~/.config/opencode/opencode.json so the bot's memory MCP server is
# always present, while preserving any other MCP entries the user
# added by hand (e.g. github, google-workspace, custom servers that
# need credentials passed in env vars).
#
# Variables read:
#   ASSISTANT_MEMORY_MCP_URL — full URL to the bot's MCP HTTP endpoint
#                              (e.g. http://bot:4097/mcp). When set, we
#                              ensure the "opencode-assistant-memory"
#                              entry under "mcp" matches this URL. When
#                              unset, we leave existing config alone.

set -e

CONFIG_DIR="${OPENCODE_CONFIG_DIR:-/root/.config/opencode}"
CONFIG_FILE="${CONFIG_DIR}/opencode.json"
LEGACY_MCP="${CONFIG_DIR}/mcp.json"

mkdir -p "${CONFIG_DIR}"

# Clean up the legacy mcp.json from a previous iteration of this script.
# We wrote it under the Claude Desktop schema (mcpServers + url) which
# OpenCode does not read, so leaving it is only confusing.
if [[ -f "${LEGACY_MCP}" ]] && grep -q "opencode-assistant-memory" "${LEGACY_MCP}" 2>/dev/null; then
  echo "[opencode-entrypoint] removing legacy ${LEGACY_MCP} (Claude Desktop schema not read by OpenCode)"
  rm -f "${LEGACY_MCP}"
fi

if [[ -n "${ASSISTANT_MEMORY_MCP_URL:-}" ]]; then
  if [[ ! -f "${CONFIG_FILE}" ]]; then
    # Brand new install: write a minimal config registering the memory MCP.
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
    # Existing config: merge our managed entry into the existing mcp
    # section without touching anything else. This lets the user keep
    # custom MCP servers (github, google-workspace, etc.) they added
    # manually for auth-requiring integrations.
    if jq -e . "${CONFIG_FILE}" >/dev/null 2>&1; then
      tmp="$(mktemp)"
      jq --arg url "${ASSISTANT_MEMORY_MCP_URL}" '
        (.mcp //= {})
        | .mcp["opencode-assistant-memory"] = { "type": "remote", "url": $url }
      ' "${CONFIG_FILE}" > "${tmp}"

      # Only replace if the merged content differs — avoids needless
      # writes/log noise on every restart.
      if ! cmp -s "${tmp}" "${CONFIG_FILE}"; then
        mv "${tmp}" "${CONFIG_FILE}"
        echo "[opencode-entrypoint] merged opencode-assistant-memory entry into ${CONFIG_FILE} (preserving other MCP servers)"
      else
        rm -f "${tmp}"
        echo "[opencode-entrypoint] ${CONFIG_FILE} already contains the correct memory MCP entry"
      fi
    else
      echo "[opencode-entrypoint] WARNING: ${CONFIG_FILE} is not valid JSON, leaving it alone"
    fi
  fi
else
  echo "[opencode-entrypoint] ASSISTANT_MEMORY_MCP_URL not set; skipping opencode.json reconciliation"
fi

exec "$@"
