#!/usr/bin/env bash
# series — Messreihe Paket 3: 16 Läufe nacheinander, je Lauf run.sh, review.sh, collect.py.
# Usage: bench/series.sh [skip]    skip = Anzahl schon erledigter Läufe (zum Fortsetzen)
#
# Reihenfolge T1 ABBA, T2 BAAB, T3 ABBA, T4 BAAB: A/B wechseln je Aufgabe ab, über die
# Aufgaben beginnt jede Variante gleich oft.
#
# Vorher in einem normalen Terminal (nicht aus Claude Desktop) den tmux-Server starten:
#   tmux new -d -s bench-keepalive
# Ein tmux-Server aus der Desktop-App erbt deren Umgebung; dort beendet sich Codex sofort
# (Messreihe 29.10., beide T1-A-Läufe ohne Lead).
#
# Hält an (Exitcode 3) bei Codex-Kontingent >= 80 %, einem ungültigen Lauf oder einem
# Lauf ohne Claude-Abschlusscheck; bei einem Skriptfehler mit Exitcode 1.
set -uo pipefail
BENCH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$BENCH/.."

tmux has-session -t bench-keepalive 2>/dev/null \
  || { echo "series: tmux-Sitzung bench-keepalive fehlt; im Terminal starten: tmux new -d -s bench-keepalive" >&2; exit 2; }
if tmux show-environment -g 2>/dev/null | grep -qE '^CLAUDE_CODE_'; then
  echo "series: der tmux-Server trägt CLAUDE_CODE_*-Variablen (aus Claude Desktop gestartet); im Terminal neu starten" >&2; exit 2
fi

SEQ=(T1:A:1 T1:B:1 T1:B:2 T1:A:2
     T2:B:1 T2:A:1 T2:A:2 T2:B:2
     T3:A:1 T3:B:1 T3:B:2 T3:A:2
     T4:B:1 T4:A:1 T4:A:2 T4:B:2)
SKIP="${1:-0}"
n=0
for item in "${SEQ[@]}"; do
  n=$((n + 1))
  [ "$n" -le "$SKIP" ] && continue
  IFS=: read -r T V R <<<"$item"
  LIM="$(python3 -I bench/common.py codex-limits)"
  echo "[$(date +%H:%M:%S)] #$n $T $V r$R codex=$LIM"
  if python3 -I -c 'import json,sys; d=json.loads(sys.argv[1]); sys.exit(0 if max(d.get("primaryUsedPercent") or 0, d.get("secondaryUsedPercent") or 0) >= 80 else 1)' "$LIM"; then
    echo "PAUSE vor #$n: Codex-Kontingent >= 80 %"; exit 3
  fi
  RUN="$(bench/run.sh "$T" "$V" "$R" | tail -1)"; rc=$?
  echo "  run rc=$rc dir=$RUN"
  [ "$rc" -eq 0 ] && [ -d "$RUN" ] || { echo "STOP: run.sh fehlgeschlagen bei #$n"; exit 1; }
  # OpenAI meldet nachts zeitweise "Selected model is at capacity" (#4 am 30.10.); dann
  # nach 2 min erneut, höchstens dreimal. Andere Fehler halten die Reihe sofort an.
  for try in 1 2 3; do
    bench/review.sh "$RUN" > "$RUN/review.out" 2>&1; rc=$?
    [ "$rc" -ne 0 ] && grep -q 'at capacity' "$RUN/review/codex.log" 2>/dev/null && [ "$try" -lt 3 ] || break
    mv "$RUN/review/codex.log" "$RUN/review/codex.capacity-$try.log"
    echo "  review: Codex ausgelastet, Versuch $try, neuer Versuch in 2 min"; sleep 120
  done
  echo "  review rc=$rc $(grep -m1 '^VERDICT' "$RUN/review.out")"
  [ "$rc" -eq 0 ] || { echo "STOP: review.sh fehlgeschlagen bei #$n"; exit 1; }
  python3 -I bench/collect.py "$RUN" > "$RUN/collect.out" 2>&1; rc=$?
  [ "$rc" -eq 0 ] || { echo "STOP: collect.py fehlgeschlagen bei #$n"; exit 1; }
  CHECK="$(python3 -I - "$RUN/result.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
q = r.get('quality') or {}
problems = []
if q.get('invalid'):
    problems.append(f"ungültig: {q['invalid']}")
if not r.get('finalCheck'):
    problems.append('kein Claude-Abschlusscheck')
print(f"status={r.get('status')} hidden={q.get('hiddenPass')} verdict={q.get('verdict')}")
print('; '.join(problems))
PY
)"
  echo "  $(echo "$CHECK" | sed -n 1p)"
  PROBLEMS="$(echo "$CHECK" | sed -n 2p)"
  [ -z "$PROBLEMS" ] || { echo "PAUSE nach #$n: $PROBLEMS"; exit 3; }
done
echo "FERTIG: alle 16 Läufe"
