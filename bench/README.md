# bench: Vergleich der Arbeitsweisen (Paket 3)

Plan und Entscheidungsregel: `../plans/paket-3-vergleich.md`.

| Datei | Zweck |
|---|---|
| `fixtures/T1..T4/` | Aufgaben: `project/` (Startstand), `task.md`, `scope.txt`, `guard.txt`, `expect.json`, `hidden/accept.js` (versteckte Abnahme), `solution/` (Referenz für den Selbsttest) |
| `selftest.sh` | prüft ohne Agenten: versteckte Abnahme rot am Start, grün mit Referenzlösung |
| `run.sh <T> <A\|B> <rep> [--dry-run]` | ein Lauf; A = `codex,claude`, B = `claude` |
| `review.sh <run-dir> [--dry-run]` | blinde Prüfung mit `verify-deliverable` per `codex exec` |
| `collect.py <run-dir>` | Messwerte nach `<run-dir>/result.json` und `results/<run-id>.json` |
| `report.py` | `results/REPORT.md` mit Tabelle und Entscheidung; Claude-USD nur mit `prices.json` |
| `common.py` | Lesen der Claude-/Codex-Protokolle, Teamdaten, Prüfprotokolle |

Ablauf je Lauf:

```bash
RUN=$(bench/run.sh T1 A 1 | tail -1)
bench/review.sh "$RUN"
python3 -I bench/collect.py "$RUN"
python3 -I bench/report.py
```

`run.sh` und `review.sh` starten echte Agenten. Ohne `--dry-run` nur nach Freigabe.
