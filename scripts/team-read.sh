#!/usr/bin/env bash
# team-read — Read messages from your team feed
# Usage: team-read <team-id> [<reader>] [--all]
#
# With <reader> (your agent name) only messages you have not seen yet are shown,
# your own messages are left out, and what is shown is recorded as seen in
# read-state/<reader>.seen. Messages delivered into your pane count as seen too.
# The read state works on message ids, not timestamps, so two messages with the
# same timestamp and restarts lose nothing; a failed fetch records nothing.
# Without <reader>, or with --all, the whole feed is printed as before.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=./collab-paths.sh
source "$SCRIPT_DIR/collab-paths.sh"

ALL=0
ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--all" ]; then ALL=1; else ARGS+=("$arg"); fi
done

if [ "${#ARGS[@]}" -lt 1 ] || [ "${#ARGS[@]}" -gt 2 ]; then
  echo "Usage: team-read <team-id> [<reader>] [--all]" >&2
  exit 2
fi
TEAM_ID="${ARGS[0]}"
READER="${ARGS[1]:-}"

URL="${ENSEMBLE_URL:-http://localhost:23100}"
if ! response="$(curl -sfS "$URL/api/ensemble/teams/$TEAM_ID/feed")"; then
  echo "team-read: failed to fetch $URL/api/ensemble/teams/$TEAM_ID/feed" >&2
  exit 1
fi

STATE_FILE=""
if [ -n "$READER" ] && [ "$ALL" -eq 0 ]; then
  STATE_FILE="$(collab_read_state_file "$TEAM_ID" "$READER")"
  mkdir -p "$(dirname "$STATE_FILE")"
fi

python3 -c "
import fcntl, json, os, sys

reader, state_file = sys.argv[1], sys.argv[2]
messages = json.load(sys.stdin).get('messages', [])

def key(m):
    return m.get('id') or f\"{m.get('from')}:{m.get('timestamp')}:{(m.get('content') or '')[:50]}\"

def show(m):
    kind = m.get('type') or 'chat'
    tag = '' if kind == 'chat' else f' [{kind}]'
    print(f\"{m['from']} -> {m['to']}{tag}: {m['content']}\")

if not state_file:
    for m in messages:
        show(m)
    sys.exit(0)

seen = set()
if os.path.exists(state_file):
    with open(state_file, encoding='utf-8') as f:
        seen = {line.strip() for line in f if line.strip()}

fresh = [m for m in messages if key(m) not in seen and m.get('from') != reader]
for m in fresh:
    show(m)
if not fresh:
    print(f'(no new messages; {len(messages)} in feed, use --all to show everything)')

sys.stdout.flush()
if fresh:
    with open(state_file, 'a', encoding='utf-8') as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        f.write(''.join(key(m) + '\n' for m in fresh))
        fcntl.flock(f.fileno(), fcntl.LOCK_UN)
" "$READER" "$STATE_FILE" <<<"$response"
