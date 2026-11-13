#!/usr/bin/env bash
# team-alive — Tell the watchdog you are still working, without a feed message
# Usage: team-alive <team-id> <agent-name>
# Touches alive/<agent-name> in the team runtime dir; its mtime counts as activity.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=./collab-paths.sh
source "$SCRIPT_DIR/collab-paths.sh"

if [ "$#" -ne 2 ]; then
  echo "Usage: team-alive <team-id> <agent-name>" >&2
  exit 2
fi
FILE="$(collab_heartbeat_file "$1" "$2")"
mkdir -p "$(dirname "$FILE")"
touch "$FILE"
echo "alive"
