#!/usr/bin/env bash
# review-bundle — Assemble the fixed input for a blind review (verify-deliverable skill)
# Usage: review-bundle <repo-dir> <task-file> [<verify-record.json>] [--base <commit>]
#
# Prints a markdown bundle with exactly three parts and nothing else:
#   1. the original task with its acceptance criteria (<task-file>, as written)
#   2. the change: git diff of staged + unstaged changes and new untracked files
#      against --base (the commit the work started from; default HEAD, or the
#      empty tree in a repo without commits), plus the commits made since --base.
#      Without --base a commit by the implementer would vanish from the diff.
#   3. the output of the automatic final check (hooks/verify-on-stop.cjs record);
#      without one the bundle says so explicitly
# No chat history of the implementer goes in, so the review stays blind.
set -euo pipefail

BASE_ARG=""
POS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --base) BASE_ARG="${2:?--base requires a commit}"; shift 2 ;;
    --base=*) BASE_ARG="${1#--base=}"; shift ;;
    *) POS+=("$1"); shift ;;
  esac
done
if [ "${#POS[@]}" -lt 2 ] || [ "${#POS[@]}" -gt 3 ]; then
  echo "Usage: review-bundle <repo-dir> <task-file> [<verify-record.json>] [--base <commit>]" >&2
  exit 2
fi
REPO="${POS[0]}"; TASK="${POS[1]}"; RECORD="${POS[2]:-}"

if [ ! -f "$TASK" ]; then echo "review-bundle: task file not found: $TASK" >&2; exit 2; fi
if ! git -C "$REPO" rev-parse --show-toplevel > /dev/null 2>&1; then
  echo "review-bundle: not a git repository: $REPO" >&2; exit 2
fi

if [ -n "$BASE_ARG" ]; then
  if ! BASE="$(git -C "$REPO" rev-parse --verify -q "$BASE_ARG^{commit}")"; then
    echo "review-bundle: unknown base commit: $BASE_ARG" >&2; exit 2
  fi
elif git -C "$REPO" rev-parse --verify -q HEAD > /dev/null; then
  BASE="HEAD"
else
  BASE="$(git -C "$REPO" hash-object -t tree /dev/null)"
fi

echo "# Review bundle"
echo
echo "## 1. Task and acceptance criteria"
echo
cat "$TASK"
echo
if [ -n "$BASE_ARG" ]; then
  echo "## 2. Change against base $(git -C "$REPO" rev-parse --short "$BASE")"
  echo
  COMMITS="$(git -C "$REPO" log --oneline --no-color "$BASE..HEAD")"
  echo "Commits since base:"
  echo
  if [ -n "$COMMITS" ]; then printf '%s\n' "$COMMITS" | sed 's/^/- /'; else echo "- none (HEAD is still the base)"; fi
  echo
elif [ "$BASE" = HEAD ]; then
  echo "## 2. Change against HEAD $(git -C "$REPO" rev-parse --short HEAD) (no --base given: commits made during the work are not visible)"
  echo
else
  echo "## 2. Change against the empty tree"
  echo
fi
echo '```diff'
git -C "$REPO" diff "$BASE" --no-color
# New files are not in git diff; show them as additions without touching the index.
git -C "$REPO" ls-files --others --exclude-standard -z | while IFS= read -r -d '' f; do
  git -C "$REPO" diff --no-index --no-color -- /dev/null "$f" || true
done
echo '```'
echo
echo "## 3. Automatic final check"
echo
if [ -n "$RECORD" ] && [ -f "$RECORD" ]; then
  echo '```json'
  cat "$RECORD"
  echo '```'
else
  echo "NO RECORD: the final check did not run or its record was not supplied. Treat the checks as not verified."
fi
