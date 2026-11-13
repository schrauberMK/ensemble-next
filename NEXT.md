# ensemble-next

Versuchsversion von ensemble nach dem Abgleich CC / Codex / AGY (Oktober 2026).
Ziel: Planung und Umsetzung in einem Kontext, unabhängige Prüfung erhalten,
Übergaben strukturiert. Die laufende Installation `~/ensemble` bleibt unverändert
und ist jederzeit der Rückfallweg.

## Herkunft

- Quelle: `~/ensemble`, Fork von github.com/michelhelsdingen/ensemble (MIT, siehe `LICENSE`)
- Stand: Commit `1e90830f5c8ab77303a876dfda145ecface2d9da` (origin/main `7cfef19` + 9 lokale Commits)
- Übernommen: alle versionierten Dateien plus zwei lokale Modusänderungen
  (`scripts/agent-colors.sh`, `scripts/collab-paths.sh` ausführbar)
- Nicht übernommen: `.git`, `.env` (Zugangsdaten), `tmp/`, `.claude/`, `CLAUDE.md`
  (GodMode-Vorlage, Quelle der doppelten Orchestrator-Rolle), die unversionierten
  Review-Berichte (`agy-integration-review.md`, `godmode-review-bericht.md`,
  `review-berichte.md`), Laufzeitdaten (`*.jsonl`, `*.log`)
- `demo/ensemble-demo-2x.mp4` liegt vor, ist aber per `.gitignore` ausgeschlossen
- Remote seit 13.11.2026: `origin` = `github.com/schrauberMK/ensemble-next` (privat). Push nur auf Zuruf.
  Für die Veröffentlichung vorbereitet am 13.11.2026 (Beta 1.2.0-beta.1): README auf Deutsch mit
  Herkunftshinweisen, `docs/ensemble-next-doku.pdf` samt LaTeX-Quelle, MIT-Lizenz mit beiden
  Urhebervermerken, lokale Pfade aus Testdaten und `bench/results/` entfernt. Die Historie beginnt mit
  dieser Fassung neu; die Entwicklungsschritte davor sind in diesem Tagebuch und in den Changelogs
  beschrieben.

Lizenz: ensemble ist MIT. Werden später GodMode-Bestandteile übernommen, behalten sie
ihre Lizenz und Herkunftshinweise; erlaubt ist nur private, nicht kommerzielle Nutzung,
kommerzielle Nutzung braucht eine schriftliche Erlaubnis.

## Trennung von der alten Version (Paket 0)

| Bereich | alt (`~/ensemble`) | neu (`ensemble-next`) |
|---|---|---|
| Port | 23000 | 23100 |
| Laufzeit | `/tmp/ensemble/<team>` | `/tmp/ensemble-next/<team>` |
| Feste /tmp-Dateien | `/tmp/collab-*`, `/tmp/ensemble-server.log` … | `/tmp/collab-next-*`, `/tmp/ensemble-next-server.log` … |
| Daten (Registry, hosts) | `~/.ensemble` | `~/.ensemble-next` (`ENSEMBLE_DATA_DIR` bleibt Override) |
| Konfiguration | `~/.config/ensemble/config.json` | `~/.config/ensemble-next/config.json` (`ENSEMBLE_CONFIG` bleibt Override; Datei existiert noch nicht, also Standardwerte) |
| Teamnamen / tmux | `collab-<ms>-<n>` | `collabnext-<ms>-<n>` |
| Prozesssuche (preflight, postcheck, launchd) | `tsx server.ts` (trifft jeden solchen Server) | `<repo>/server.ts`; der Server wird mit absolutem Pfad gestartet |
| Skill | `~/.claude/skills/collab` (`/collab`) | `collab-next`, nur projektlokal in `.claude/skills/collab-next/` |
| Skill-Installer | schreibt nach `~/.claude/skills/collab` | schreibt nach `~/.claude/skills/collab-next` (noch nicht ausgeführt) |
| launchd-Label (nur macOS) | `dev.ensemble.server` | `dev.ensemble-next.server` |

Historische Dokumente (`docs/`, `CHANGELOG-*`, `README.md`) nennen weiter die alten Werte.

## Abnahme Paket 0

| Kriterium | Ergebnis |
|---|---|
| Typecheck | ✅ `npm run typecheck` |
| Tests | ✅ 446 bestanden, 3 übersprungen (launchd, nur macOS) |
| Beide Server laufen gleichzeitig | ✅ 23000 und 23100 healthy; alt 45 Teams, neu 0 Teams (getrennte Registry) |
| Neue Skripte sehen nur die eigene Laufzeit | ✅ `collab-status.sh`, `collab-cleanup.sh` (Dry-Run) prüfen nur `/tmp/ensemble-next` |
| Alte Installation unverändert | ✅ SHA-256 über `~/ensemble` (ohne node_modules/.git) plus Git-Status, `~/.ensemble`, `~/.config/ensemble`, `~/.claude/skills/collab`, `~/.claude/settings.json`, tmux-Sitzungen: vor und nach Tests und Parallelbetrieb identisch |
| Team erstellen, abschließen, aufräumen | ✅ Testlauf 25.10.2026 (`codex,claude`, Aufgabe 17 × 23): Preflight grün, 10 Nachrichten, beide `<<COLLAB_DONE>>`, Dauer 1 min, `summary.txt` + `.finished` geschrieben, Team `disbanded`, Bridge, Poller und alle tmux-Sitzungen beendet, Testordner unverändert |
| Alte Installation nach dem Teamlauf | ✅ Prüfsummen identisch; `/tmp/ensemble` und `/tmp/collab-team-id.txt` nicht angelegt |
| Geladene Claude-Anweisungen, Hooks und Tools dokumentiert | ⏳ teilweise, siehe unten |

Nebenbefund (korrigiert in Paket 1): Der zunächst als „fremd“ notierte Prozess
`node --import tsx server.ts` stammte aus der Testsuite von ensemble-next selbst
(Arbeitsordner ensemble-next, gestartet während `vitest run`). Die Suite lässt bei jedem
vollständigen Lauf einen Testserver zurück. Das ist vermutlich aus `~/ensemble` geerbt,
dort aber nicht geprüft, weil ein Testlauf dort die alte Installation berühren würde.
Das alte Suchmuster `tsx server.ts` hätte auch diesen Prozess getroffen; das neue nicht.

## Was eine Claude-Sitzung hier lädt (Stand Paket 0)

Projektlokale `.claude/` isoliert **nicht**. Zusätzlich wirken:

- `~/projekte/CLAUDE.md` (14,8 KB, GodMode-Orchestrator, tote Verweise) über die
  Verzeichnishierarchie, weil das Repo unter `~/projekte` liegt
- globale Hooks aus `~/.claude/settings.json`: SessionStart, PostToolUse (Write|Edit),
  SubagentStop (`verify-changes.js`, `validate-agent-output.js`), TaskCompleted, TeammateIdle
- 14 globale Agents (`~/.claude/agents`) und die globalen Skills
- claude.ai-Connectoren der Hauptsitzung (Snapshot: rund 35 geladene, rund 290 nachladbare Tools)

`/context` in der von ensemble-next gestarteten Claude-Instanz (claude-2, Testlauf 25.10.2026,
Arbeitsordner außerhalb von `~/projekte`):

| Posten | Wert |
|---|---|
| Kontextfenster | 1M; frei 912k (91,2 %), Autocompact-Puffer 33k (3,3 %) |
| Messages | 22,2k (2,2 %) |
| Skills | 54 Skills, 7,8k (0,8 %) |
| Custom Agents | 18, 1,1k |
| MCP-Tools | 216, **bei Bedarf geladen, 0 Tokens** |
| Systemprompt, Systemtools, Memory-Dateien | nicht erfasst (Ausgabe vor dem Auslesen überschrieben); zusammen rund 25k (Rest bis 100 %) |

Folgerung: Die MCP-Dienste werden an die Collab-Instanz vererbt, kosten aber keinen Kontext,
solange sie nicht geladen werden. Die These „Tool-Überlastung“ ist für diesen Fall nicht bestätigt.
Eine Isolation des Startwegs (`--strict-mcp-config --mcp-config`, `--setting-sources`, eigener
`CLAUDE_CONFIG_DIR`) hat daher keine Priorität mehr; sie bleibt Option für den Vergleich in Paket 3.
Noch offen: Größe von Systemprompt und Memory-Dateien, wenn der Arbeitsordner unter `~/projekte`
liegt (dann zusätzlich `~/projekte/CLAUDE.md`).

Bestätigt: Das Token-Tracking aus dem Terminal taugt nicht zum Vergleich. Die Zusammenfassung
meldete für claude-2 „~1.1k tokens“, `/context` zeigte über 50k belegt; für codex-1 „unknown“.

Weitere gemeinsam genutzte Dienste: Export nach claude-mem und Telegram (ohne `.env`
nicht konfiguriert) sind nicht von der alten Version getrennt.

## Paket 1: Abschlusscheck für direkt schreibendes CC

Problem: Die globale Prüfung `verify-changes.js` hängt nur an `SubagentStop`. Schreibt CC
selbst, statt an @builder zu delegieren, prüft automatisch niemand.

Lösung, nur in ensemble-next (`~/.claude` bleibt unverändert):

- `hooks/verify-on-stop.cjs`, ein eigener Stop-Hook (neu geschrieben, kein GodMode-Code).
- `lib/agent-spawner.ts` gibt jedem gespawnten claude-Agenten `--settings` mit diesem Hook mit.
  Abschalten: `ENSEMBLE_VERIFY_ON_STOP=0`. Codex und andere Agenten bekommen ihn nicht.

Verhalten:

| Lage | Ergebnis |
|---|---|
| keine Änderungen | `NO_CHANGES`, still |
| Prüfungen grün | `PASS`, still |
| Prüfung rot | `FAIL`, Stop wird blockiert (max. 3× pro Änderungsstand, `ENSEMBLE_VERIFY_MAX_BLOCKS`), Agent bekommt Ausgabe und die Anweisung, nichts abzuschwächen und sonst `BLOCKED` statt `READY_FOR_REVIEW` zu melden; danach bleibt `unresolved: true` |
| Nacharbeit ohne Ende (seit 13.11.2026) | Die 3 Versuche galten nur für denselben Änderungsstand; jede neue Änderung setzte den Zähler zurück. Jetzt gelten zusätzlich Grenzen über alle Änderungsstände, gezählt ab der ersten roten Prüfung bis zur nächsten grünen: höchstens 6 Blockaden (`ENSEMBLE_VERIFY_MAX_ROUNDS`), höchstens 30 Minuten (`ENSEMBLE_VERIFY_MAX_MINUTES`), höchstens 2 Änderungen in Folge mit unveränderter Fehlerausgabe (`ENSEMBLE_VERIFY_STALL_ROUNDS`). `0` schaltet eine Grenze ab. Ist eine erreicht, wird nicht mehr blockiert: `unresolved: true`, `stopReason` (`max_rounds`, `max_minutes`, `no_progress`, `same_change_set`) und `rounds` im Protokoll, Systemmeldung an den Agenten, Hinweis in der Zusammenfassung. Die letzte erlaubte Runde wird dem Agenten angekündigt. Die Standardwerte sind gesetzt, nicht gemessen |
| Zeitüberschreitung, npm oder pytest fehlt | `INCOMPLETE`, blockiert einmal, damit der Agent es meldet |
| keine projektdefinierten Prüfungen, kein Git | `SKIPPED` mit Grund |
| interner Fehler, kaputte Eingabe | `ERROR` bzw. still, blockiert nie |

- Geprüft werden nur die npm-Skripte `typecheck`, `lint`, `test`, `build`, die das Projekt selbst definiert.
- Seit Paket 4 auch `pytest`, wenn das Projekt pytest-Tests hat (`test_*.py`, `*_test.py`, `conftest.py` oder ein pytest-Abschnitt in `pytest.ini`, `pyproject.toml`, `setup.cfg`, `tox.ini`). Läuft mit dem `.venv`/`venv`-Python des Projekts, sonst `python3`, ohne Cache und ohne `__pycache__`. pytest fehlt oder keine Tests gesammelt: `INCOMPLETE`.
- Änderungen umfassen auch neue, unversionierte Dateien (die globale Prüfung übersieht sie).
- Derselbe Änderungsstand wird nicht zweimal geprüft (Fingerabdruck).
- Jeder Lauf schreibt ein Protokoll: `/tmp/ensemble-next/verify/<session_id>.json`, mit tmux-Sitzungsname
  zur Zuordnung. Paket 2 kann daraus `READY_FOR_REVIEW` belegen.
- Schutz gegen Rekursion: Während der Prüfungen läuft kein zweiter Hook (`ENSEMBLE_VERIFY_RUNNING`).

Abnahme:

| Kriterium | Ergebnis |
|---|---|
| Unit-Tests | ✅ 11 neue Tests (u. a. Negativtest, unversionierte Datei, Budget, Timeout, SKIPPED); Suite 457 bestanden, 3 übersprungen |
| Typecheck, Lint | ✅ |
| Echter Negativtest | ✅ `claude -p` mit genau den Spawn-Settings, Auftrag „note.txt = x“, Projekttest verlangt „hallo“: Hook blockierte 3×, Claude änderte weder `check.js` noch `package.json` (Prüfsummen), meldete `STATUS: BLOCKED` mit Protokollpfad; Protokoll `FAIL`, `blocks: 3`, `unresolved: true` |
| Gegenlauf | ✅ Nach der Entscheidung „hallo gilt“: Protokoll `PASS`, Claude meldete `READY_FOR_REVIEW` |
| Alte Installation | ✅ Prüfsummen vor und nach Paket 1 identisch |

Kosten des echten Tests: rund 0,65 USD (zwei `claude -p`-Läufe).

## Paket 2: Kommunikation als ein Patch

| Teil | Umsetzung |
|---|---|
| Lesestand | `team-read.sh <team> <agent>` zeigt nur ungesehene Nachrichten, ohne eigene. Der Lesestand liegt pro Leser in `read-state/<agent>.seen` und arbeitet mit **Nachrichten-IDs**, nicht mit Zeitstempeln: gleiche Zeitstempel und Neustarts verlieren nichts, ein fehlgeschlagener Abruf schreibt nichts. Ins Fenster zugestellte Nachrichten gelten als gesehen. `--all` und der Aufruf ohne Agent verhalten sich wie bisher. |
| Zustellung | Hinweis „Respond with team-say. Then run team-read“ ersetzt durch „antworten, wenn es Neues gibt; team-read zeigt nur Ungesehenes“. Nachrichtentyp wird mitgezeigt. |
| Lebenszeichen | `team-alive.sh <team> <agent>` setzt `alive/<agent>`. Der Watchdog wertet dessen Zeitstempel wie eine Nachricht. Lange stille Arbeit braucht keine Statusnachrichten mehr. |
| Übergabe / Rückgabe | Prompt: HANDOFF (Lead → Worker, `--type decision`) mit auftrag, ziel, arbeitsstand, schreibbereich, entscheidungen, verworfen, quellen, abnahme, offen. RETURN (Worker → Lead, `--type result`) mit status `READY_FOR_REVIEW \| BLOCKED \| NEEDS_DECISION`, files_changed, tests, open_issues. `READY_FOR_REVIEW` heißt bereit zur Prüfung, nicht abgenommen. |
| Eine Planungsebene | Worker: HANDOFF nicht neu planen, nicht an Subagenten delegieren, selbst im Schreibbereich schreiben. Möglich, weil Paket 1 den Prüfweg ohne @builder sichert. |
| Regeln | „Nach JEDEM Schritt team-say/team-read“ und „lange Nachrichten“ entfallen. Gemeldet wird bei HANDOFF, Entscheidung, Frage, Blocker, fertigem Paket, RETURN, wichtigem Befund. `<<COLLAB_DONE>>` unverändert. |
| Zusammenfassung | `lib/collab-summary.ts`: pro Agent Results, Decisions, Questions nach Typ (je max. 5). Die drei längsten Nachrichten nur noch als Rückfall, wenn ein Agent nichts typisiert hat. Für Claude-Agenten: letzter Abschlusscheck aus `verify/` (Zuordnung über tmux-Sitzung) und Warnung, wenn `READY_FOR_REVIEW` gegen einen nicht bestandenen Check steht. |
| Prüf-Skill | `skill/verify-deliverable/SKILL.md` (projektlokal in `.claude/skills/`): blinder, nicht-interaktiver Review mit festem Input und festem Verdict-Format (`ACCEPTED \| CHANGES_REQUESTED \| REJECTED`). `scripts/review-bundle.sh <repo> <task> [<record>] --base <commit>` baut den Input: Auftrag, Diff samt neuen Dateien und Commits seit Basis, Prüfprotokoll; keine Chat-Historie. |
| AGY-Rolle | `agents.json`: AGY nutzt bei langer Recherche `team-alive` statt Zwischenstand per team-say. |

Abnahme:

| Kriterium | Ergebnis |
|---|---|
| Tests | ✅ 15 neue Tests (Cursor mit gleichem Zeitstempel, Neustart, je Leser, fehlgeschlagener Abruf, Zustellung TS→Shell, Lebenszeichen gegen Watchdog, Zusammenfassung, Statuserkennung, Prompt, review-bundle); Suite grün; Typecheck und Lint sauber |
| Echter Teamlauf | ✅ `codex,claude`, Aufgabe `add(a, b)` in sum.js, 4 min, 8 Nachrichten. HANDOFF als `decision` mit allen Feldern, RETURN als `result` mit `READY_FOR_REVIEW`, Abschlusscheck `PASS` in der Zusammenfassung verlinkt. Nur sum.js geändert, test.js und package.json per Prüfsumme unverändert, beide Agenten nutzten `team-alive`, Lesestand pro Agent geschrieben |
| Blinder Review | ✅ `codex exec` read-only in leerem Ordner, nur Skill + Bundle: ohne `--base` zu Recht `CHANGES_REQUESTED` („keine Commits“ nicht prüfbar), daraufhin `--base` ergänzt; mit `--base` `ACCEPTED`, alle Kriterien belegt |
| Aufräumen | ✅ Bridge, Poller, tmux beendet |
| Alte Installation | ✅ Prüfsummen vor und nach Paket 2 identisch |

Beobachtungen aus dem Teamlauf:

- Die Abnahme durch codex-1 im Team ist nicht blind, weil codex-1 die HANDOFF geschrieben hat. Die blinde
  Prüfung lief deshalb getrennt über `verify-deliverable`.
- codex-1 fragte nach, ob die HANDOFF angekommen sei, bevor claude-2 antwortete. Die Ursache der
  Verzögerung ist nicht geklärt.
- claude-2 sandte `<<COLLAB_DONE>>` zweimal; harmlos.
- Tokens stehen für beide Agenten auf „unknown“. Für Paket 3 braucht es echte Nutzungsdaten.

## Paket 3a: Vorlagen und Messwerkzeuge (ohne Agentenläufe)

Plan: `plans/paket-3-vergleich.md`, Werkzeuge: `bench/` (siehe `bench/README.md`).

| Teil | Stand |
|---|---|
| Vorlagen T1–T4 | Bugfix, Feature über mehrere Dateien, Refactoring mit Lint, widersprüchlicher Auftrag. `selftest.sh`: versteckte Abnahme am Start rot (T1–T3) bzw. grün (T4), mit Referenzlösung grün |
| `run.sh` | frischer Arbeitsordner mit Basis-Commit, Prüfsummen, Codex-Kontingent vorher/nachher, Start über `collab-launch.sh`, Abbruch nach 20 min oder 60k Claude-Ausgabetokens |
| `review.sh` | blinde Prüfung in leerem Ordner, Bundle mit `--base`, nicht ephemer (Verbrauch messbar) |
| `collect.py` | Qualität (versteckte Tests in einer Kopie, Schreibbereich, Prüfsummen, Commits, Eskalation, READY ohne PASS, Verdict), Nacharbeit (Hook-Blockaden aus dem Transkript, Rückfragen), Zeit, Verbrauch (Claude je Nachricht einmal inkl. Subagenten ab Teamstart; Codex-Lead, Preflight-Probe und Prüfer getrennt) |
| `report.py` | Tabelle je Lauf und Variante, Entscheidungsregel aus dem Plan; Claude-USD nur mit `bench/prices.json`, sonst bleibt das Kostenkriterium offen |
| Tests | 10 neue Tests; Suite 482 bestanden, 3 übersprungen; Typecheck, Lint sauber. `bench/fixtures/**` ist von Vitest ausgenommen |

Trockenlauf auf dem Teamlauf aus Paket 2 (nachträglich erfasst, kein Fixture):

- Werte stimmen mit den Handmessungen überein: Claude 413 773 Tokens (8 Nachrichten,
  `claude-opus-5-5`), Codex-Lead 591 237 (`gpt-6.1-sol`), Preflight-Probe ausgeschlossen, Abschlusscheck
  `PASS`, nur `sum.js` geändert, Prüfsummen intakt, blind `ACCEPTED` (4/4 Kriterien), Dauer 221 s.
- Prüfer-Verbrauch fehlt hier, weil dieser Review noch mit `--ephemeral` lief.
- Auffällig: Die erste Dateiänderung kam erst etwa 3 Minuten nach Teamstart, bei 3,7 Minuten
  Gesamtdauer. In Variante A geht die meiste Zeit vor dem Schreiben verloren. Genau das misst Paket 3.

## Paket 3: Probelauf T1 A 1 (25.10.2026)

Ergebnis (`bench/results/T1-A-r1-20261025T181252Z.json`):

| Messgröße | Wert |
|---|---|
| Qualität | versteckte Abnahme ✅, `npm test` ✅, nur `src/paginate.js` geändert, Prüfsummen intakt, keine Commits, Abschlusscheck `PASS`, RETURN `READY_FOR_REVIEW`, blind `ACCEPTED` (6/6 Kriterien, 18 s) |
| Dauer | 264 s, erste Dateiänderung nach 232 s |
| Claude | 664 100 Tokens (24 Eingabe, 33 723 Cache-Schreiben, 627 551 Cache-Lesen, 2 802 Ausgabe), 12 Nachrichten, `claude-opus-5-5` |
| Codex-Lead | 566 444 Tokens (533 888 aus Cache, 2 257 Ausgabe), `gpt-6.1-sol` |
| Codex-Prüfer | 25 555 Tokens |
| Nachrichten | 6 (2 decision, 1 question, 2 result, 1 chat), 0 Hook-Blockaden |

Zwei Auswertungsfehler, gefunden und behoben:

1. RETURN ohne Doppelpunkt (`status READY_FOR_REVIEW`) wurde nicht erkannt. Das Muster lässt den
   Trenner jetzt weg, in `bench/common.py` und in `lib/collab-summary.ts` (Paket 2).
2. Codex 0.164 setzte die Lead-Arbeit in der Sitzung der Preflight-Probe fort; der Dateikopf nannte
   `~/projekte/ensemble-next` als Arbeitsordner. Der Verbrauch wird jetzt je Durchgang über den
   `turn_context` gebucht (Differenzen der kumulierten Zähler). Ergebnis: 590 322 in der Datei, davon
   566 444 Lead, Rest Probe.

Ausserdem: Der Codex-Kontingentwert vor dem Lauf war veraltet (Fenster schon zurückgesetzt). Er wird
jetzt als `stale` markiert.

**Befund, der den Vergleich verfälschen würde (Zeitachse ab Teamstart):**

| s | Ereignis |
|---|---|
| 17 | claude-2 grüßt, hat `src/paginate.js` schon gelesen und die Ursache erkannt |
| 25–128 | claude-2 wartet in einer eigenen Bash-Schleife (`team-read` + `sleep 5`), der Zug endet nicht |
| 128 | Watchdog stößt codex-1 an (90 s ohne Nachricht) |
| 131 | claude-2 startet die nächste Warteschleife |
| 140 / 154 | codex-1 schickt die HANDOFF |
| 228 | codex-1 fragt nach, ob die HANDOFF angekommen ist |
| 230 | erst diese Nachricht beendet die Schleife |
| 232 | claude-2 ändert die Datei (eine Zeile) |

Ursache: Die HANDOFF wurde ins Fenster von claude-2 gelegt und deshalb in Paket 2 als „gesehen“
markiert. claude-2 steckte aber in seiner Warteschleife; die eingefügte Nachricht kommt erst nach dem
Ende des Zuges an, und `team-read` zeigte sie nicht mehr. Rund 90 s Leerlauf. Dazu brauchte codex-1
140 s bis zur HANDOFF.

Folge: Ohne Korrektur misst der Vergleich vor allem diesen Fehler. Vorschlag vor den 16 Läufen:
Zustellung ins Fenster nicht mehr als gelesen markieren (nur `team-read` markiert), und im Prompt
Warteschleifen untersagen („Zug beenden, Nachrichten kommen von selbst“).

## Fix Zustellung und Kontrolllauf T1 A 2 (25.10.2026)

Fix (`e113293`): Zustellung ins Fenster markiert nicht mehr als gelesen, nur `team-read`. Der Prompt
verlangt: nie in einem Werkzeugaufruf warten (keine sleep-Schleifen, kein wiederholtes team-read,
kein Polling), sondern den Zug beenden. Zwei neue Tests; Suite 484 bestanden.

Kontrolllauf T1 A 2, Wirkung des Fixes:

| | Probelauf r1 | Kontrolle r2 |
|---|---|---|
| Qualität | versteckt ✅, blind ACCEPTED | versteckt ✅, blind ACCEPTED |
| HANDOFF gesendet | 140 s | 59 s |
| erste Dateiänderung (ab Teamstart) | 232 s | 69 s |
| beide `<<COLLAB_DONE>>` | 256 s | 98 s |
| Teamende (`.finished`) | 264 s | **404 s** |
| Claude-Tokens | 664 100 | 411 949 |
| Warteschleifen von claude-2 | 2 (je ~100 s) | 0, Zug beendet und Zustellung abgewartet |

Die eigentliche Arbeit war nach 98 s fertig statt nach 256 s. Zwei neue Befunde verhindern aber
einen fairen Vergleich:

1. **Teamende 5 Minuten zu spät.** claude-2 sandte `<<COLLAB_DONE>>` (77 s) vor der Abnahmenachricht
   von codex-1 (94 s) und antwortete darauf zu Recht nicht mehr. Der schnelle Abschluss verlangt, dass
   jedes Sentinel nach der letzten fremden Inhaltsnachricht liegt; also griff erst der Rückfall nach
   `TWO_SIGNAL_IDLE_THRESHOLD_MS` = 300 s. Das trifft nur Variante A (B hat keinen zweiten Agenten).
2. **Codex setzt eine fremde Sitzung fort.** codex-1 im Lauf r2 lief im selben Codex-Thread weiter wie
   der Lead von r1, mit dessen Gesprächsverlauf und dem Arbeitsordner von r1 im `turn_context`. Er
   bemerkte das selbst („im bestätigten r2-Repo“), r1 blieb unverändert. Ursache vermutlich der
   gemeinsame App-Server-Daemon von Codex (`codex --help`: „shared local app-server daemon“,
   Schalter `--no-daemon`). Folge: Läufe sind nicht unabhängig, und der Lead-Verbrauch landet beim
   falschen Lauf (`collect.py` meldet 0). Nachgerechnet über das Zeitfenster: 437 712 Tokens
   (427 648 aus Cache, 2 554 Ausgabe).

## Fix Codex-Daemon und Teamabschluss, Kontrollläufe T1 A 3 und T1 A 4 (25.10.2026)

Fixes:

- `8a4e53c`: Codex startet mit `--no-daemon`. `closesAfterAcceptance` schließt ein Team nach 60 s
  Ruhe, wenn alle Agenten auf `<<COLLAB_DONE>>` enden und nach einem Sentinel nur `result`-Nachrichten
  kamen (Frage, decision oder chat danach: weiter warten). Doku `docs/configuration.md` ergänzt.
- `c2c45d0`: Mit `--no-daemon` läuft Codex 0.163 und zeigt „Trust this folder?“. Die Startprüfung
  kannte den Dialog nicht; das „›“ vor „1. Trust and continue“ galt als Eingabebereitschaft, der
  eingefügte Prompt beendete Codex. Dialog wird jetzt erkannt und mit Enter bestätigt. `collect.py`
  wertet A-Läufe ohne eine einzige Codex-Nachricht als ungültig; `report.py` nimmt sie aus der Entscheidung.

**T1 A 3: ungültig.** Codex beendete sich 4 s nach dem Start („no agent running, shell 'bash' in
foreground“). claude-2 wartete richtig, meldete nach 265 s `BLOCKED` und setzte nach 386 s allein um
(versteckt ✅, blind ACCEPTED). Als Variante-A-Lauf nicht verwertbar.

**T1 A 4: Kontrolle bestanden.**

| | r1 (vor allen Fixes) | r2 (Zustell-Fix) | r4 (alle Fixes) |
|---|---|---|---|
| Qualität | versteckt ✅, ACCEPTED | versteckt ✅, ACCEPTED | versteckt ✅, ACCEPTED |
| HANDOFF | 140 s | 59 s | 30 s |
| erste Änderung (ab Lauf-Start) | 245 s | 77 s | 50 s |
| beide `<<COLLAB_DONE>>` | 256 s | 98 s | 66 s |
| Teamende | 264 s | 404 s | **133 s** |
| Claude-Tokens | 664 100 | 411 949 | 465 730 |
| Codex-Lead-Tokens | 566 444 | 437 712 (fremder Thread) | **211 123** (eigene Sitzung) |
| Codex-Prüfer | 25 555 | 25 561 | 25 602 |
| Nachrichten | 6 | 4 | 6 |

Der Codex-Lead lief in r4 in einer eigenen Sitzung, nur mit dem Arbeitsordner von r4. Der niedrigere
Verbrauch kommt daher, dass kein fremder Gesprächsverlauf mehr mitgeladen wird.

Offene Punkte:

- Die tmux-Sitzung des abgestürzten codex-1 aus r3 blieb nach dem Teamende stehen (von Hand beendet).
  Ausgefallene Agenten werden beim Auflösen offenbar nicht aufgeräumt.
- Codex speichert für jeden neuen Arbeitsordner eine Freigabe in `~/.codex/config.toml`
  (bisher 3 Einträge: r1, r4 und ein Startversuch). Bei 16 Läufen kommen 16 hinzu; aufräumbar danach.

## Paket 3: Messreihe 16 Läufe (30.10.2026)

Läufe am 30.10. von 03:00 bis 03:42, automatisch über `bench/series.sh`. Die Reihenfolge war T1 ABBA,
T2 BAAB, T3 ABBA, T4 BAAB. Die Ergebnisse stehen in `bench/results/REPORT.md` und `bench/results/*.json`.

| Kennzahl | A: Codex plant → CC | B: CC allein |
|---|---|---|
| versteckte Tests bestanden | 8/8 | 8/8 |
| Verstöße gegen Schreibbereich, Prüfsummen oder Commit-Verbot | 0 | 0 |
| blind ACCEPTED | 6 | 6 |
| T4 richtig eskaliert | 2/2 | 2/2 |
| Median Dauer | 156 s | 57 s |
| Median Claude-Tokens (USD als API-Äquivalent) | 607k (0,50) | 345k (0,40) |
| Median Codex-Tokens (Lead + Prüfer) | 313k | 25k |
| Hook-Blockaden gesamt | 6 | 0 |

**Entscheidung nach der vorab festgelegten Regel: B (CC plant und setzt um, danach dieselbe Prüfung)
wird Standard für diese Aufgabenarten.** Alle Qualitätsbedingungen sind erfüllt. B ist bei der Dauer
um etwa 64 % besser und beim Verbrauch ebenfalls deutlich. Das Ergebnis ist eine Tendenz aus einem
Pilot mit kleinen Aufgaben, kein allgemeiner Beweis.

Beobachtungen:

- T4 ist ein absichtlicher Widerspruch: Der Test erwartet 60000. In allen vier Läufen lautet das
  blinde Urteil CHANGES_REQUESTED, wie vorgesehen. A hat `config.js` trotzdem auf 30000 geändert und
  einen roten Arbeitsstand hinterlassen; das ergab drei Hook-Blockaden je Lauf. B hat den Widerspruch
  vorab geprüft, als NEEDS_DECISION gemeldet und einen sauberen Arbeitsstand hinterlassen.
- Die Prüfsummen von `~/ensemble`, `/collab` und `~/.claude` waren vor und nach der Reihe gleich.

Zwischenfälle in der Nacht (behoben, noch nicht committet):

- Bei #4 und #12 meldete Codex beim Review „Selected model is at capacity“. `series.sh` wiederholt das
  Review jetzt bis zu dreimal nach je 2 min. #4 habe ich von Hand wiederholt, #12 lief automatisch.
- #8 (T2 B r2) wurde verworfen. `collab-launch.sh` wertet einen Start als fehlgeschlagen, wenn nach
  12 s keine Nachricht da ist. Claude hatte zuerst das Repo gelesen und den Plan erst nach etwa 15 s
  gesendet. Die Wartezeit ist jetzt über `COLLAB_AGENT_WAIT_SECS` einstellbar (Standard 12 s); `run.sh`
  setzt 60 s. Das erklärt auch den einmaligen 12-s-Abbruch bei T2 B vom 29.10.

Offen:

- Codex-Freigaben für die Bench-Ordner in `~/.codex/config.toml` aufräumen.
- Übrig gebliebene Testserver der Suite (Lutz beendet sie von Hand).
- Den 12-s-Standard in `collab-launch.sh` auch interaktiv prüfen: Er meldet einen funktionierenden
  Start als Fehler, sobald der Agent zuerst liest.
- Als Nächstes laut Plan einzeln: Promptkürzung, MCP-Beschränkung, Umbau der Agenten.

## Paket 4: B als Standard (30.10.2026, Branch `paket-4/b-standard`)

Paket 3 hat B gewählt. Das ist jetzt der normale Ablauf:

- **Vorgabe:** Werden keine Agenten genannt, arbeitet Claude Code allein: `scripts/collab-launch.sh`,
  `collab-preflight.sh` und als Rückfall auch der Service (`DEFAULT_AGENTS`). Mit `codex,claude`
  ist Codex wie bisher Lead.
- **Blinde Prüfung automatisch:** Beim Teamende startet der Service `scripts/collab-review.sh`
  im Hintergrund, wenn die letzte RETURN `READY_FOR_REVIEW` lautet (`lib/auto-review.ts`). Codex
  prüft read-only mit dem Skill `verify-deliverable`. Das Bündel besteht aus Auftrag, Diff seit dem
  Basis-Commit und Abschlusscheck, ohne Chatverlauf. Die Ergebnisse liegen in
  `<runtime>/<team>/review/` (`verdict.txt` oder `error.txt`, zuletzt `.done`). Meldet Codex
  „at capacity“, wird bis zu dreimal wiederholt.
- **Zitatprüfung des Verdicts (13.11.2026, noch nicht in einem Release):** Nach der blinden Prüfung
  gleicht `scripts/verdict-grounding.py` die `Datei:Zeile`-Fundstellen des Verdicts mit dem Diff im
  Bündel und dem Arbeitsordner ab, ohne Modell und ohne Tokens. Ergebnis `grounded` (mindestens eine
  Fundstelle im Diff, keine falsche), `ungrounded` (keine Fundstelle im Diff; ein `ACCEPTED` gilt dann
  als nicht belegt) oder `invalid` (Datei gibt es nicht oder Zeile hinter dem Dateiende). Der Hinweis
  wird an `verdict.txt` angehängt, der unveränderte Prüfertext bleibt in `verdict.raw.txt`, Details in
  `grounding.json`. Ein Fehler der Zitatprüfung lässt das Verdict unverändert. In der Messreihe
  schreibt `bench/review.sh` nur `grounding.json`; `collect.py` übernimmt es als `review.grounding`
  und `quality.verdictGrounding`. Grenze: Eine Fundstelle, die es gibt, beweist nicht, dass der Prüfer
  richtig geurteilt hat. Zeilen werden nur gegen Bereiche geprüft (Diff-Abschnitt ± 3 Zeilen,
  Dateilänge). Zitate in Backticks, die nirgends vorkommen, und Fundstellen außerhalb des Diffs sind
  Hinweise und ändern den Status nicht. Anlass: Abgleich mit `nyldn/claude-octopus` (Council-Grounding).
  **Bindung an die Prüfsumme (13.11.2026):** `grounding.json` trägt unter `binding` die SHA-256 des
  geprüften Bündels und seines Änderungsteils (Diff seit dem Basis-Commit samt neuer Dateien und
  Commit-Liste); der Hinweis in `verdict.txt` nennt die ersten 12 Stellen. `collab-review.sh` baut das
  Bündel nach der Prüfung noch einmal (`bundle.now.md`): Hat sich der Arbeitsordner währenddessen
  geändert, steht im Hinweis „ACHTUNG … gilt für den älteren Stand“ und `binding.current` ist `false`.
  Später, etwa vor einem Merge: `scripts/verdict-check.sh <runtime>/<team>/review` (0 = aktuell,
  1 = veraltet, 2 = nicht feststellbar). Maßgeblich ist der Änderungsteil, nicht der Abschlusscheck.
  Die Prüfsumme setzt das Skript, nicht das Modell.
  **Prüfer ohne MCP, Plugins, Apps und Erinnerungen (13.11.2026):** `scripts/reviewer-args.py` liefert
  die Zusatzargumente für `codex exec`: `--ignore-user-config --ignore-rules --disable apps
  --disable memories`. Weil damit auch die Modellwahl aus `~/.codex/config.toml` entfiele, werden
  `model` und `model_reasoning_effort` von dort gelesen und ausdrücklich übergeben
  (`COLLAB_REVIEW_MODEL` / `COLLAB_REVIEW_EFFORT` gehen vor). `COLLAB_REVIEW_ISOLATED=0` schaltet das
  ab. Lehnt Codex die Argumente ab (etwa nach einem Update), läuft die Prüfung einmal auf dem alten
  Weg; `review/reviewer.json` nennt `isolated: true | false | "fallback"`. Gilt auch für
  `bench/review.sh`. Gemessen mit codex-cli 0.167.1, `gpt-6-luna`: Der Prüfer sah vorher 405
  MCP-Werkzeuge, jetzt 0. Zwei echte Prüfungen auf Vorlage T1 kosteten 9,9k und 10,4k Tokens statt
  17,1k und 19,4k, mit denselben Verdicts. Grenze: Die globale `~/.codex/AGENTS.md` wird weiter
  geladen; `-c project_doc_max_bytes=0` änderte das nicht. Messwerte der Reihe vom 30.10. sind beim
  Prüfer-Verbrauch nicht mehr direkt vergleichbar.
  **Probe mit echtem Codex (13.11.2026, `collab-review.sh` direkt, Vorlage T1, je ein `codex exec`,
  17k und 19k Tokens):** saubere Lösung → `CHANGES_REQUESTED` (kein Abschlusscheck-Protokoll im
  Probeaufbau), 1 Fundstelle, `grounded`; Lösung mit Zusatzdatei und abgeschwächtem Test →
  `REJECTED`, 3 Fundstellen, alle im Diff, `grounded`. Codex schreibt Fundstellen teils in Backticks,
  das wird erkannt. Gegenprobe: dasselbe echte Verdict mit zwei verfälschten Fundstellen → `invalid`.
  Nicht erprobt: der Weg über den Service beim Teamende (ruft dasselbe Skript auf) und ein Verdict,
  in dem Codex von sich aus falsch zitiert. Nebenbefund: Codex antwortet auf Deutsch mit
  „nicht verifizierbar“ / „nicht met“; `parse_verdict` in `bench/collect.py` zählt nur die englischen
  Formen.
- **Abschalten:** je Start mit `COLLAB_AUTO_REVIEW=0` (`bench/run.sh` setzt das, die Messreihe hat
  ihr eigenes `review.sh`), für den ganzen Server mit `ENSEMBLE_AUTO_REVIEW=0`.
- **Basis-Commit:** Der Service speichert beim Anlegen des Teams `HEAD` des Arbeitsordners als
  `baseCommit`. So bleibt auch ein Commit des Umsetzers im Diff sichtbar.
- **Startwartezeit:** Die Vorgabe ist jetzt 60 s statt 12 s. Die Schleife endet ohnehin bei der
  ersten Nachricht.
- **Aufräumen:** Beim Auflösen werden auch die tmux-Sitzungen ausgefallener Agenten beendet (offener
  Punkt aus r3 vom 25.10.).
- **Skill:** Der Wächter wartet nach `.finished` auf `review/.done` und zeigt das Urteil.
  `CHANGES_REQUESTED`/`REJECTED` gehen mit ihren Befunden an den Nutzer.
- **Doku:** README, `docs/` und der Skill nennen die neue Vorgabe. `tests/docs-consistency.test.ts`
  prüft das.

Tests: Die Suite ist grün (509 bestanden, 3 übersprungen), dazu kommen `tests/auto-review.test.ts`
und `tests/collab-review-script.test.ts` (mit Codex-Attrappe, einschließlich Wiederholung bei
Engpass). Ein echter Lauf mit dem neuen Ablauf steht noch aus und braucht Lutz' Freigabe.

Offen vor dem produktiven Einsatz:

- ein echter Probelauf an einer etwas größeren Aufgabe (Claude allein, danach automatische Prüfung)
- Merge nach `main`, danach den Skill-Installer ausführen (schreibt nach `~/.claude/skills/collab-next`)
- die Codex-Freigaben in `~/.codex/config.toml` aufräumen und die Testserver der Suite beenden

## Nächste Pakete

1. ~~**Prüfweg**~~ erledigt, siehe Paket 1.
2. ~~**Kommunikation (ein Patch):**~~ erledigt, siehe Paket 2. Ursprünglicher Auftrag: Cursor mit Nachrichten-IDs und Lesestand pro Leser,
   strukturierte Übergabe/Rückgabe (`READY_FOR_REVIEW` = bereit zur Prüfung, nicht bestanden),
   Zusammenfassung nach Typ `decision`/`question`/`result`, eigenes Watchdog-Lebenszeichen,
   `<<COLLAB_DONE>>` kompatibel. Dazu der nicht-interaktive Prüf-Skill (`verify-deliverable`)
   mit festem Input: Auftrag + Abnahmekriterien, `git diff`, Ausgabe des Prüflaufs, keine
   Chat-Historie des Umsetzers.
3. ~~**Vergleich:**~~ erledigt, siehe Paket 3 Messreihe (B wird Standard). Ursprünglich: „Codex plant → CC setzt um → Prüfung“ gegen „CC plant und setzt um → dieselbe
   Prüfung“, mit echten Nutzungsdaten. Promptkürzung, MCP-Beschränkung und Agenten-Umbau danach
   einzeln.

**Probelauf 30.10. (Team e79d6544):** Claude allein fertig nach 1 min, READY_FOR_REVIEW, 15 pytest-Tests grün. Die blinde Prüfung startete nicht: `__dirname is not defined`, weil der Server als ES-Modul läuft und Vitest `__dirname` bereitstellt. Behoben in `lib/auto-review.ts`, dazu ein Test, der jedes Server-Modul auf ein undefiniertes `__dirname` prüft. Außerdem: Der Abschlusscheck meldet bei Projekten ohne `package.json` SKIPPED (hier Python/pytest), die Zusammenfassung warnt dann.
Prüfung von Hand nachgeholt (collab-review.sh, 25 s, gpt-6.1-sol): **CHANGES_REQUESTED**. Drei Kriterien erfüllt, „Alle Tests grün“ nicht nachweisbar, weil der Abschlusscheck SKIPPED war. Ein Gegenlauf von pytest ergab 15 passed. Das Urteil ist also folgerichtig, die Ursache liegt im Check: Der Stop-Hook muss Python-Projekte erkennen (pytest/pyproject), sonst endet jede Python-Aufgabe mit CHANGES_REQUESTED. Das ist der nächste Punkt vor dem produktiven Einsatz.

**Python-Check (30.10.):** `hooks/verify-on-stop.cjs` führt jetzt pytest aus (siehe Abschnitt Abschlusscheck). Fünf neue Tests mit nachgebautem venv-Python, die Suite ist grün (515). Gegen `~/projekte/probe-b` mit echtem pytest: PASS (15 Tests, 0,7 s). Die Codex-Prüfung wurde mit dem neuen Protokoll noch nicht wiederholt.

**Probelauf 2 (30.10., Team 056141fa, `~/projekte/probe-b2`):** Der ganze Ablauf lief ohne Eingriff durch. Claude war allein nach 1 min fertig, Abschlusscheck PASS (pytest, 12 Tests). Die blinde Codex-Prüfung startete automatisch beim Teamende, brauchte 20 s und lautete **ACCEPTED**, alle vier Kriterien erfüllt, keine Befunde. Paket 4 ist damit end-to-end bestätigt. Offen: Merge nach `main` und die Skill-Installation (Freigabe).
