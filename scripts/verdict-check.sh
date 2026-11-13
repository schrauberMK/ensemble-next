#!/usr/bin/env bash
# verdict-check — Does a blind review verdict still belong to the current work tree?
# Usage: verdict-check.sh <review-dir>
#
# <review-dir> is the review/ folder written by scripts/collab-review.sh. Builds the review
# bundle again with the stored work dir, base commit and final-check record (binding.args) and
# compares the checksum of its change section with the one the verdict was bound to
# (grounding.json, binding.changeSha256). Runs no model.
#   exit 0  current: the change is the one that was reviewed
#   exit 1  stale: the work tree changed since the review, the verdict is for an older state
#   exit 2  cannot tell (no binding, work dir gone, bundle not built)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="${1:?Usage: verdict-check.sh <review-dir>}"
[ -f "$DIR/grounding.json" ] && [ -f "$DIR/binding.args" ] && [ -f "$DIR/task.md" ] \
  || { echo "verdict-check: keine Bindung in $DIR (grounding.json, binding.args oder task.md fehlt)" >&2; exit 2; }

{ IFS= read -r -d '' WORK; IFS= read -r -d '' BASE; IFS= read -r -d '' RECORD; } < "$DIR/binding.args" \
  || { echo "verdict-check: binding.args unlesbar" >&2; exit 2; }
[ -d "$WORK" ] || { echo "verdict-check: Arbeitsordner fehlt: $WORK" >&2; exit 2; }
[ -n "$RECORD" ] && [ ! -f "$RECORD" ] && RECORD=""

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
"$SCRIPT_DIR/review-bundle.sh" "$WORK" "$DIR/task.md" ${RECORD:+"$RECORD"} ${BASE:+--base "$BASE"} > "$TMP" 2> /dev/null \
  || { echo "verdict-check: Bündel nicht gebaut" >&2; exit 2; }

python3 -I - "$SCRIPT_DIR" "$DIR/grounding.json" "$TMP" <<'PY'
import importlib.util, json, sys
from pathlib import Path
scripts, grounding, bundle = sys.argv[1:4]
spec = importlib.util.spec_from_file_location('vg', Path(scripts) / 'verdict-grounding.py')
vg = importlib.util.module_from_spec(spec); spec.loader.exec_module(vg)
try:
    bound = json.loads(Path(grounding).read_text(encoding='utf-8'))['binding']['changeSha256']
except (OSError, ValueError, KeyError, TypeError):
    print('verdict-check: grounding.json trägt keine Prüfsumme', file=sys.stderr); sys.exit(2)
now = vg.binding(Path(bundle).read_text(encoding='utf-8', errors='replace'))['changeSha256']
if now == bound:
    print(f'aktuell: Das Verdict gehört zum jetzigen Stand (Änderung sha256 {bound[:12]}).'); sys.exit(0)
print(f'veraltet: geprüft wurde {bound[:12]}, der Arbeitsordner steht jetzt auf {now[:12]}. Das Verdict gilt nicht für den jetzigen Stand.')
sys.exit(1)
PY
