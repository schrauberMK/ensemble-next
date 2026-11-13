#!/usr/bin/env bash
# run — One bench run of Paket 3: fresh copy of a fixture, one team, wait, record.
# Usage: bench/run.sh <T1|T2|T3|T4> <A|B> <rep> [--dry-run]
#
#   A = codex,claude  (Codex plans, Claude implements)
#   B = claude        (Claude plans and implements)
#
# Creates $BENCH_ROOT/<run-id>/ (default /tmp/ensemble-next-bench):
#   work/      the agents' workspace, a git repo with one base commit
#   meta.json  task, variant, base commit, guard checksums, versions, times, Codex quota
#   launch.log output of collab-launch.sh
# --dry-run prepares everything and prints the launch command, but starts no agent.
#
# Limits: BENCH_TIMEOUT_S (default 1200) wall time, BENCH_MAX_CLAUDE_OUTPUT (default 60000)
# Claude output tokens. Over a limit the team is disbanded and the run marked aborted.
# Prints the run dir as the last line.
set -euo pipefail

BENCH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$BENCH/.." && pwd)"
ROOT="${BENCH_ROOT:-/tmp/ensemble-next-bench}"
TIMEOUT_S="${BENCH_TIMEOUT_S:-1200}"
MAX_OUT="${BENCH_MAX_CLAUDE_OUTPUT:-60000}"
API="${ENSEMBLE_URL:-http://localhost:23100}"
RUNTIME="${ENSEMBLE_NEXT_RUNTIME:-/tmp/ensemble-next}"

DRY=0
ARGS=()
for a in "$@"; do if [ "$a" = "--dry-run" ]; then DRY=1; else ARGS+=("$a"); fi; done
if [ "${#ARGS[@]}" -ne 3 ]; then
  echo "Usage: bench/run.sh <T1|T2|T3|T4> <A|B> <rep> [--dry-run]" >&2; exit 2
fi
TASK="${ARGS[0]}"; VARIANT="${ARGS[1]}"; REP="${ARGS[2]}"
FX="$BENCH/fixtures/$TASK"
[ -d "$FX/project" ] || { echo "run: unknown task $TASK" >&2; exit 2; }
case "$VARIANT" in
  A) AGENTS="codex,claude" ;;
  B) AGENTS="claude" ;;
  *) echo "run: variant must be A or B" >&2; exit 2 ;;
esac
[[ "$REP" =~ ^[0-9]+$ ]] || { echo "run: rep must be a number" >&2; exit 2; }

RUN_ID="$TASK-$VARIANT-r$REP-$(date -u +%Y%m%dT%H%M%SZ)"
RUN="$ROOT/$RUN_ID"
WORK="$RUN/work"
mkdir -p "$WORK"
cp -r "$FX/project/." "$WORK/"
git -C "$WORK" init -q
git -C "$WORK" config user.email bench@example.invalid
git -C "$WORK" config user.name bench
git -C "$WORK" add -A
git -C "$WORK" commit -q -m "base $TASK"
BASE="$(git -C "$WORK" rev-parse HEAD)"

LIMITS_BEFORE="$(python3 -I "$BENCH/common.py" codex-limits)"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"

python3 -I - "$RUN/meta.json" "$FX" "$WORK" <<PY
import hashlib, json, subprocess, sys
meta_path, fx, work = sys.argv[1:4]
guard = {}
for rel in open(f'{fx}/guard.txt', encoding='utf-8').read().split():
    with open(f'{work}/{rel}', 'rb') as f:
        guard[rel] = hashlib.sha256(f.read()).hexdigest()
def git(*a):
    return subprocess.run(['git', '-C', '$REPO', *a], capture_output=True, text=True).stdout.strip()
meta = {
    'runId': '$RUN_ID', 'task': '$TASK', 'variant': '$VARIANT', 'rep': int('$REP'),
    'agents': '$AGENTS', 'dryRun': bool($DRY),
    'fixture': fx, 'taskFile': f'{fx}/task.md', 'work': work, 'base': '$BASE',
    'scope': open(f'{fx}/scope.txt', encoding='utf-8').read().split(),
    'guard': guard, 'expect': json.load(open(f'{fx}/expect.json', encoding='utf-8')),
    'ensembleNextCommit': git('rev-parse', 'HEAD'), 'ensembleNextDirty': bool(git('status', '--porcelain')),
    'startedAt': '$STARTED', 'codexLimitsBefore': json.loads('''$LIMITS_BEFORE''' or 'null'),
    'limits': {'timeoutS': int('$TIMEOUT_S'), 'maxClaudeOutput': int('$MAX_OUT')},
    'status': 'prepared',
}
json.dump(meta, open(meta_path, 'w', encoding='utf-8'), indent=2)
PY

LAUNCH=("$REPO/scripts/collab-launch.sh" "$WORK" "$(cat "$FX/task.md")" "$AGENTS")
if [ "$DRY" -eq 1 ]; then
  echo "dry run, not started: COLLAB_MONITOR=none ${LAUNCH[0]} <work> <task.md> $AGENTS"
  echo "$RUN"
  exit 0
fi

set_meta() {
  python3 -I - "$RUN/meta.json" "$@" <<'PY'
import json, sys
path, *pairs = sys.argv[1:]
meta = json.load(open(path, encoding='utf-8'))
for pair in pairs:
    key, _, value = pair.partition('=')
    try:
        meta[key] = json.loads(value)
    except json.JSONDecodeError:
        meta[key] = value
json.dump(meta, open(path, 'w', encoding='utf-8'), indent=2)
PY
}

set +e
COLLAB_AUTO_REVIEW=0 COLLAB_MONITOR=none "${LAUNCH[@]}" > "$RUN/launch.log" 2>&1
LAUNCH_RC=$?
set -e
TEAM_ID="$(sed -n 's/^TEAM_ID=//p' "$RUN/launch.log" | tail -1)"
TEAM_NAME="$(grep -o 'collabnext-[0-9]*-[0-9]*' "$RUN/launch.log" | head -1 || true)"
set_meta "teamId=$TEAM_ID" "teamName=$TEAM_NAME" "launchRc=$LAUNCH_RC"
if [ -z "$TEAM_ID" ] || ! grep -q "Team is live" "$RUN/launch.log"; then
  set_meta "status=launch_failed" "finishedAt=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
  echo "run: launch failed (rc=$LAUNCH_RC), see $RUN/launch.log" >&2
  echo "$RUN"
  exit 1
fi

STATUS="finished"
DEADLINE=$(( $(date +%s) + TIMEOUT_S ))
while [ ! -f "$RUNTIME/$TEAM_ID/.finished" ]; do
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then STATUS="aborted_timeout"; break; fi
  OUT="$(python3 -I -c "
import sys; sys.path.insert(0, '$BENCH')
import common
print(common.claude_usage('$WORK', '$STARTED')['tokens']['output_tokens'])")"
  if [ "$OUT" -gt "$MAX_OUT" ]; then STATUS="aborted_tokens"; break; fi
  sleep 10
done
if [ "$STATUS" != "finished" ]; then
  curl -sf -X POST "$API/api/ensemble/teams/$TEAM_ID/disband" > /dev/null 2>&1 || true
  for _ in $(seq 1 30); do [ -f "$RUNTIME/$TEAM_ID/.finished" ] && break; sleep 1; done
fi

set_meta "status=$STATUS" "finishedAt=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" \
  "codexLimitsAfter=$(python3 -I "$BENCH/common.py" codex-limits)"
echo "$RUN"
