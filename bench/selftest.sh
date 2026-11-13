#!/usr/bin/env bash
# selftest — Check that every fixture behaves as designed, without any agent.
# Usage: bench/selftest.sh [T1 T2 ...]
#
# For each fixture, in a throwaway copy:
#   - project as shipped: visible checks and hidden acceptance give the expected result
#   - project + solution/: visible checks and hidden acceptance are green
# Expected results per fixture are in the table below. Exit 1 on any mismatch.
set -euo pipefail

BENCH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASKS=("$@")
[ "${#TASKS[@]}" -eq 0 ] && TASKS=(T1 T2 T3 T4)

# visible checks / hidden acceptance on the project as shipped (0 = green, 1 = red)
declare -A START_VISIBLE=([T1]=1 [T2]=0 [T3]=0 [T4]=0)
declare -A START_HIDDEN=([T1]=1 [T2]=1 [T3]=1 [T4]=0)

status() { if "$@" > /dev/null 2>&1; then echo 0; else echo 1; fi }

visible() {
  local dir="$1" rc=0 script
  for script in typecheck lint test build; do
    if node -e "process.exit(require('$dir/package.json').scripts?.['$script'] ? 0 : 1)"; then
      (cd "$dir" && npm run -s "$script" > /dev/null 2>&1) || rc=1
    fi
  done
  echo "$rc"
}

fail=0
for t in "${TASKS[@]}"; do
  fx="$BENCH/fixtures/$t"
  tmp="$(mktemp -d)"
  cp -r "$fx/project/." "$tmp/"
  mkdir -p "$tmp/hidden" && cp "$fx/hidden/"* "$tmp/hidden/"

  v="$(visible "$tmp")"; h="$(status node "$tmp/hidden/accept.js")"
  line="$t start: visible=$v hidden=$h (expected ${START_VISIBLE[$t]}/${START_HIDDEN[$t]})"
  if [ "$v" != "${START_VISIBLE[$t]}" ] || [ "$h" != "${START_HIDDEN[$t]}" ]; then line="$line MISMATCH"; fail=1; fi
  echo "$line"

  if [ -d "$fx/solution" ]; then
    cp -r "$fx/solution/." "$tmp/"
    v="$(visible "$tmp")"; h="$(status node "$tmp/hidden/accept.js")"
    line="$t solution: visible=$v hidden=$h (expected 0/0)"
    if [ "$v" != 0 ] || [ "$h" != 0 ]; then line="$line MISMATCH"; fail=1; fi
    echo "$line"
  fi
  rm -rf "$tmp"
done
exit "$fail"
