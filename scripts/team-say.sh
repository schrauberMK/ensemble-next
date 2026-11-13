#!/usr/bin/env bash
# team-say — Send a message to your team feed
# Works inside sandboxed environments (no network needed - writes to file)
# Usage: team-say [--type chat|decision|question|result] <team-id> <from> <to> [--type chat|decision|question|result] <message>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=./collab-paths.sh
source "$SCRIPT_DIR/collab-paths.sh"

MSG_TYPE="chat"
if [ "${1:-}" = "--type" ]; then
  if [ "$#" -lt 2 ]; then
    echo "team-say: --type requires a value" >&2
    exit 2
  fi
  MSG_TYPE="${2:-}"
  shift 2
elif [[ "${1:-}" == --type=* ]]; then
  MSG_TYPE="${1#--type=}"
  shift
fi

if [ "$#" -lt 4 ]; then
  echo "Usage: team-say [--type chat|decision|question|result] <team-id> <from> <to> [--type chat|decision|question|result] <message>" >&2
  exit 2
fi

TEAM_ID="$1"; shift

if [ "${1:-}" = "--type" ]; then
  if [ "$#" -lt 2 ]; then
    echo "team-say: --type requires a value" >&2
    exit 2
  fi
  MSG_TYPE="${2:-}"
  shift 2
elif [[ "${1:-}" == --type=* ]]; then
  MSG_TYPE="${1#--type=}"
  shift
fi

if [ "$#" -lt 3 ]; then
  echo "Usage: team-say [--type chat|decision|question|result] <team-id> <from> <to> [--type chat|decision|question|result] <message>" >&2
  exit 2
fi

FROM="$1"; TO="$2"; shift 2

if [ "${1:-}" = "--type" ]; then
  if [ "$#" -lt 2 ]; then
    echo "team-say: --type requires a value" >&2
    exit 2
  fi
  MSG_TYPE="${2:-}"
  shift 2
elif [[ "${1:-}" == --type=* ]]; then
  MSG_TYPE="${1#--type=}"
  shift
fi

case "$MSG_TYPE" in
  chat|decision|question|result) ;;
  *)
    echo "team-say: invalid --type '$MSG_TYPE' (expected chat, decision, question, or result)" >&2
    exit 2
    ;;
esac

MSG="$*"
if [ -z "$MSG" ]; then
  echo "team-say: message is required" >&2
  exit 2
fi
FILE="$(collab_messages_file "$TEAM_ID")"
DIR="$(dirname "$FILE")"
LOCK_FILE="$FILE.lock"
mkdir -p "$DIR"
touch "$FILE" "$LOCK_FILE"
python3 -c "
import fcntl
import json
import sys
import uuid
from datetime import datetime, timezone

team_id, sender, recipient, content, msg_type, output_path, lock_path = sys.argv[1:8]
msg = {
    'id': str(uuid.uuid4()),
    'teamId': team_id,
    'from': sender,
    'to': recipient,
    'content': content,
    'type': msg_type,
    'timestamp': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
}

with open(lock_path, 'w', encoding='utf-8') as lock_handle:
    fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
    with open(output_path, 'a', encoding='utf-8') as output_handle:
        output_handle.write(json.dumps(msg) + '\n')
    fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
" "$TEAM_ID" "$FROM" "$TO" "$MSG" "$MSG_TYPE" "$FILE" "$LOCK_FILE"

echo "Sent to $TO"
