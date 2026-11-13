#!/usr/bin/env bash
# agent-colors.sh — map an agent name to its colour from agents.json.
#
# Sourced by collab-replay.sh and collab-livefeed.sh. Both used to carry their
# own hardcoded table matching on "codex-1" and "claude-2", which meant every new
# agent showed up colourless, and even codex and claude lost their colour as soon
# as they were not agent 1 and 2. agents.json already carries a `color` per
# agent, so read that instead of keeping three tables in sync by hand.
#
#   source scripts/agent-colors.sh
#   color=$(agent_color "glm-3")     # -> ANSI escape for magenta

# Resolve through symlinks: these scripts are often reached via ~/.local/bin, and
# a path relative to the symlink points at the wrong tree.
_AGENT_COLORS_SELF="${BASH_SOURCE[0]}"
if command -v readlink >/dev/null 2>&1; then
  _AGENT_COLORS_SELF="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
fi
_AGENT_COLORS_DIR="$(cd "$(dirname "$_AGENT_COLORS_SELF")" 2>/dev/null && pwd)"

if [ -n "${ENSEMBLE_AGENTS_CONFIG:-}" ]; then
  _AGENTS_JSON="$ENSEMBLE_AGENTS_CONFIG"
else
  # scripts/ lives one level below the repo root; check both, in that order.
  for _candidate in "$_AGENT_COLORS_DIR/../agents.json" "$_AGENT_COLORS_DIR/agents.json"; do
    if [ -f "$_candidate" ]; then _AGENTS_JSON="$_candidate"; break; fi
  done
  : "${_AGENTS_JSON:=$_AGENT_COLORS_DIR/../agents.json}"
fi

# Named colours from agents.json to ANSI. Bright variants: these are read on a
# dark terminal all evening.
_ansi_for_name() {
  case "$1" in
    blue)    printf '\033[94m' ;;
    green)   printf '\033[92m' ;;
    yellow)  printf '\033[93m' ;;
    magenta) printf '\033[95m' ;;
    cyan)    printf '\033[96m' ;;
    red)     printf '\033[91m' ;;
    white|*) printf '\033[97m' ;;
  esac
}

# agent_color <agent-name> — accepts "glm-3" as well as "glm".
agent_color() {
  local raw="${1:-}" key name
  # Strip the numeric suffix the service appends: codex-1 -> codex
  key="${raw%-[0-9]*}"

  case "$key" in
    ensemble|user|michel) printf '\033[97m'; return 0 ;;
  esac

  name=$(python3 - "$_AGENTS_JSON" "$key" <<'PY' 2>/dev/null
import json,sys
try:
    cfg=json.load(open(sys.argv[1]))
except Exception:
    print(""); raise SystemExit
a=cfg.get(sys.argv[2])
print((a or {}).get("color","") if isinstance(a,dict) else "")
PY
  )
  _ansi_for_name "${name:-white}"
}
