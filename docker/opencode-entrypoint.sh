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
#
#   MCP_URL_<NAME>           — any number of additional remote MCP
#                              servers. Each env var matching this
#                              prefix registers an `mcp` entry. The
#                              entry name is the suffix lowercased
#                              with `_` replaced by `-`. Examples:
#                                MCP_URL_PLAYLIST_CURATOR
#                                  -> mcp.playlist-curator
#                                MCP_URL_GITHUB
#                                  -> mcp.github
#                              The URL is used verbatim. Useful for
#                              connecting external MCP servers that
#                              run on the host or another container.

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

# Build the list of (name, url) pairs we want to ensure are present.
# The memory MCP keeps its dedicated env var so existing installs and
# docs don't break. Anything matching MCP_URL_* is treated generically.
declare -A MANAGED_MCPS=()

if [[ -n "${ASSISTANT_MEMORY_MCP_URL:-}" ]]; then
  MANAGED_MCPS["opencode-assistant-memory"]="${ASSISTANT_MEMORY_MCP_URL}"
fi

# Scan env for MCP_URL_<NAME>=<url>. The naming convention is mirrored
# in the user-facing docs: MCP_URL_PLAYLIST_CURATOR registers a server
# named "playlist-curator" in opencode.json.
while IFS='=' read -r key value; do
  case "$key" in
    MCP_URL_*)
      suffix="${key#MCP_URL_}"
      [[ -z "${value}" ]] && continue
      # Lowercase, swap `_` for `-`. We want the entry name to look
      # human, not SCREAMING_CASE.
      lower="$(echo "${suffix}" | tr '[:upper:]' '[:lower:]' | tr '_' '-')"
      MANAGED_MCPS["${lower}"]="${value}"
      ;;
  esac
done < <(env)

if [[ ${#MANAGED_MCPS[@]} -eq 0 ]]; then
  echo "[opencode-entrypoint] no MCP env vars set; skipping opencode.json reconciliation"
  exec "$@"
fi

# Ensure the config file exists; if not, start with an empty JSON
# object so the jq merge below has something to work against.
if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "{}" > "${CONFIG_FILE}"
fi

if ! jq -e . "${CONFIG_FILE}" >/dev/null 2>&1; then
  echo "[opencode-entrypoint] WARNING: ${CONFIG_FILE} is not valid JSON, leaving it alone"
  exec "$@"
fi

# Merge each managed entry into .mcp without touching anything else.
# Custom MCP servers added by hand in opencode.json (auth-requiring
# servers, etc.) survive because we only assign to specific keys.
tmp="$(mktemp)"
jq_filter='(.mcp //= {})'
jq_args=()
for name in "${!MANAGED_MCPS[@]}"; do
  url="${MANAGED_MCPS[$name]}"
  arg_name="name_${name//-/_}"
  arg_url="url_${name//-/_}"
  jq_args+=(--arg "${arg_name}" "${name}")
  jq_args+=(--arg "${arg_url}" "${url}")
  jq_filter="${jq_filter} | .mcp[\$${arg_name}] = { \"type\": \"remote\", \"url\": \$${arg_url} }"
done

jq "${jq_args[@]}" "${jq_filter}" "${CONFIG_FILE}" > "${tmp}"

if ! cmp -s "${tmp}" "${CONFIG_FILE}"; then
  mv "${tmp}" "${CONFIG_FILE}"
  echo "[opencode-entrypoint] merged ${#MANAGED_MCPS[@]} managed MCP entr$( [[ ${#MANAGED_MCPS[@]} -eq 1 ]] && echo 'y' || echo 'ies' ) into ${CONFIG_FILE} (preserving other MCP servers)"
  for name in "${!MANAGED_MCPS[@]}"; do
    echo "[opencode-entrypoint]   - ${name} -> ${MANAGED_MCPS[$name]}"
  done
else
  rm -f "${tmp}"
  echo "[opencode-entrypoint] ${CONFIG_FILE} already up to date (${#MANAGED_MCPS[@]} managed MCP entr$( [[ ${#MANAGED_MCPS[@]} -eq 1 ]] && echo 'y' || echo 'ies' ))"
fi

exec "$@"
