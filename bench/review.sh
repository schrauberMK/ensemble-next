#!/usr/bin/env bash
# review — Blind review of one bench run with the verify-deliverable skill.
# Usage: bench/review.sh <run-dir> [--dry-run]
#
# Builds review/bundle.md (task, diff against the base commit incl. new files and commits,
# final-check record) and review/prompt.md (skill + bundle), then runs codex exec read-only
# in the empty folder review/cwd/. The reviewer sees nothing else: no chat, no work/ folder.
# The session is not ephemeral, so collect.py can read the reviewer's token usage.
# Writes review/verdict.txt and review/meta.json. --dry-run stops before codex.
# Then scripts/verdict-grounding.py checks the verdict's file:line citations (no model) and
# writes review/grounding.json for collect.py; verdict.txt stays as the reviewer wrote it.
set -euo pipefail

BENCH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$BENCH/.." && pwd)"
DRY=0
ARGS=()
for a in "$@"; do if [ "$a" = "--dry-run" ]; then DRY=1; else ARGS+=("$a"); fi; done
[ "${#ARGS[@]}" -eq 1 ] || { echo "Usage: bench/review.sh <run-dir> [--dry-run]" >&2; exit 2; }
RUN="$(cd "${ARGS[0]}" && pwd)"
[ -f "$RUN/meta.json" ] || { echo "review: no meta.json in $RUN" >&2; exit 2; }

field() { python3 -I -c "import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2]) or '')" "$RUN/meta.json" "$1"; }
WORK="$(field work)"; BASE="$(field base)"; TASK_FILE="$(field taskFile)"; TEAM_NAME="$(field teamName)"

RECORD=""
if [ -n "$TEAM_NAME" ]; then RECORD="$(python3 -I "$BENCH/common.py" verify-record "$TEAM_NAME")"; fi

mkdir -p "$RUN/review/cwd"
if [ -n "$(ls -A "$RUN/review/cwd")" ]; then echo "review: $RUN/review/cwd is not empty" >&2; exit 2; fi

"$REPO/scripts/review-bundle.sh" "$WORK" "$TASK_FILE" ${RECORD:+"$RECORD"} --base "$BASE" > "$RUN/review/bundle.md"
{
  cat "$REPO/skill/verify-deliverable/SKILL.md"
  echo
  echo "---"
  echo "Hier ist das Review-Bundle. Antworte nur mit dem Verdict-Block, auf Deutsch."
  echo
  cat "$RUN/review/bundle.md"
} > "$RUN/review/prompt.md"

if [ "$DRY" -eq 1 ]; then
  echo "dry run, not started: (cd $RUN/review/cwd && codex exec --sandbox read-only --skip-git-repo-check $(python3 -I "$REPO/scripts/reviewer-args.py" | tr '\n' ' ')-o ../verdict.txt - < ../prompt.md)"
  exit 0
fi

# Same reviewer start as scripts/collab-review.sh: no MCP servers, plugins, apps or memories.
ISO=()
mapfile -t ISO < <(python3 -I "$REPO/scripts/reviewer-args.py")
python3 -I "$REPO/scripts/reviewer-args.py" --json > "$RUN/review/reviewer.json"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
set +e
(cd "$RUN/review/cwd" && timeout 600 codex exec --sandbox read-only --skip-git-repo-check "${ISO[@]}" \
  -o "$RUN/review/verdict.txt" - < "$RUN/review/prompt.md" > "$RUN/review/codex.log" 2>&1)
RC=$?
set -e
python3 -I - "$RUN/review/meta.json" "$STARTED" "$RC" "$RECORD" <<'PY'
import json, sys
from datetime import datetime, timezone
path, started, rc, record = sys.argv[1:5]
json.dump({'startedAt': started, 'finishedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
           'exitCode': int(rc), 'verifyRecord': record or None}, open(path, 'w'), indent=2)
PY
[ "$RC" -eq 0 ] || { echo "review: codex exec failed (rc=$RC), see $RUN/review/codex.log" >&2; exit 1; }
cat "$RUN/review/verdict.txt"
python3 -I "$REPO/scripts/verdict-grounding.py" "$RUN/review/verdict.txt" "$RUN/review/bundle.md" --work "$WORK" \
  --json "$RUN/review/grounding.json" || echo "review: citation check failed, verdict unchanged" >&2
