#!/usr/bin/env bash
# collab-review — Blind review of a finished team's change with the verify-deliverable skill.
# Usage: collab-review.sh <review-dir> <work-dir> [<base-commit>] [<verify-record.json>]
#
# Started by the service on disband (lib/auto-review.ts) when the last RETURN says
# READY_FOR_REVIEW. <review-dir> holds task.md. Builds bundle.md and prompt.md like
# bench/review.sh, runs codex exec read-only in the empty folder <review-dir>/cwd and
# writes verdict.txt, or error.txt when no verdict came back. .done is written last.
# After a verdict, scripts/verdict-grounding.py checks its file:line citations against the
# bundle and the work tree (no model): grounding.json, and the note appended to verdict.txt
# so every reader of the verdict sees it. The untouched reviewer text stays in verdict.raw.txt.
# The verdict is bound to what was reviewed: grounding.json carries the checksums of the bundle
# and of its change section. The bundle is built once more after the review (bundle.now.md); if
# the work tree changed meanwhile, the note says the verdict belongs to the older state.
# binding.args keeps work dir, base and record for scripts/verdict-check.sh.
# "Selected model is at capacity" is retried up to three times, 2 min apart.
# The reviewer starts without the user's MCP servers, plugins, apps and memories
# (scripts/reviewer-args.py; COLLAB_REVIEW_ISOLATED=0 switches that off). If Codex rejects these
# arguments, e.g. after an update, the review runs once more the plain way instead of failing.
# reviewer.json says how it ran: isolated true, false, or "fallback".
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIR="${1:?Usage: collab-review.sh <review-dir> <work-dir> [<base-commit>] [<verify-record.json>]}"
WORK="${2:?work dir missing}"
BASE="${3:-}"
RECORD="${4:-}"
WAIT_S="${COLLAB_REVIEW_RETRY_S:-120}"

finish() { date -u +%Y-%m-%dT%H:%M:%SZ > "$DIR/.done"; exit "$1"; }
fail() { echo "$1" > "$DIR/error.txt"; echo "collab-review: $1" >&2; finish 1; }

[ -f "$DIR/task.md" ] || fail "task.md fehlt in $DIR"
command -v codex > /dev/null 2>&1 || fail "codex nicht gefunden, keine blinde Prüfung"
[ -n "$RECORD" ] && [ ! -f "$RECORD" ] && RECORD=""

"$SCRIPT_DIR/review-bundle.sh" "$WORK" "$DIR/task.md" ${RECORD:+"$RECORD"} ${BASE:+--base "$BASE"} \
  > "$DIR/bundle.md" 2> "$DIR/bundle.err" || fail "Review-Bundle nicht gebaut: $(head -c 300 "$DIR/bundle.err")"
{
  cat "$REPO_DIR/skill/verify-deliverable/SKILL.md"
  echo
  echo "---"
  echo "Hier ist das Review-Bundle. Antworte nur mit dem Verdict-Block, auf Deutsch."
  echo
  cat "$DIR/bundle.md"
} > "$DIR/prompt.md"

mkdir -p "$DIR/cwd"
ISO=()
mapfile -t ISO < <(python3 -I "$SCRIPT_DIR/reviewer-args.py" 2> /dev/null)
python3 -I "$SCRIPT_DIR/reviewer-args.py" --json > "$DIR/reviewer.json" 2> /dev/null || echo '{"isolated": false}' > "$DIR/reviewer.json"
review_once() {
  (cd "$DIR/cwd" && timeout 600 codex exec --sandbox read-only --skip-git-repo-check "$@" \
    -o "$DIR/verdict.txt" - < "$DIR/prompt.md" > "$DIR/codex.log" 2>&1)
}
for try in 1 2 3; do
  review_once "${ISO[@]}"
  RC=$?
  [ "$RC" -ne 0 ] && grep -q 'at capacity' "$DIR/codex.log" && [ "$try" -lt 3 ] || break
  mv "$DIR/codex.log" "$DIR/codex.capacity-$try.log"
  sleep "$WAIT_S"
done
# Not a timeout (124) and not capacity: most likely Codex did not accept the isolation arguments.
if [ "${#ISO[@]}" -gt 0 ] && [ "$RC" -ne 0 ] && [ "$RC" -ne 124 ] && ! grep -q 'at capacity' "$DIR/codex.log"; then
  mv "$DIR/codex.log" "$DIR/codex.isolated-failed.log"
  rm -f "$DIR/verdict.txt"
  echo '{"isolated": "fallback", "reason": "isolated start failed, see codex.isolated-failed.log"}' > "$DIR/reviewer.json"
  review_once
  RC=$?
fi
[ "$RC" -eq 0 ] && [ -s "$DIR/verdict.txt" ] || { rm -f "$DIR/verdict.txt"; fail "codex exec ohne Verdict (rc=$RC), siehe $DIR/codex.log"; }
# The citation check must never cost the verdict: on any failure the verdict stays as it is.
cp "$DIR/verdict.txt" "$DIR/verdict.raw.txt"
printf '%s\0%s\0%s\0' "$WORK" "$BASE" "$RECORD" > "$DIR/binding.args"
NOW=()
if "$SCRIPT_DIR/review-bundle.sh" "$WORK" "$DIR/task.md" ${RECORD:+"$RECORD"} ${BASE:+--base "$BASE"} \
    > "$DIR/bundle.now.md" 2> /dev/null; then NOW=(--current-bundle "$DIR/bundle.now.md"); fi
if NOTE="$(python3 -I "$SCRIPT_DIR/verdict-grounding.py" "$DIR/verdict.raw.txt" "$DIR/bundle.md" --work "$WORK" \
    --json "$DIR/grounding.json" "${NOW[@]}" 2> "$DIR/grounding.err")"; then
  printf '\n\n%s\n' "$NOTE" >> "$DIR/verdict.txt"
  rm -f "$DIR/grounding.err"
fi
finish 0
