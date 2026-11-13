# Übergabe für die nächste Sitzung (Stand 26.10.2026)

Einstieg in eine neue Claude-Code-Sitzung. Ausführlich: `NEXT.md` (alle Pakete, Messwerte, Befunde),
`plans/paket-3-vergleich.md` (Plan und Entscheidungsregel), `bench/README.md` (Werkzeuge).

## Worum es geht

Der Anstoß kam aus den Empfehlungen von Anthropic zum Arbeiten mit Claude Code. Sinngemäß: dem Agenten
ein klares Ziel und eine Möglichkeit zur Selbstkontrolle geben (etwa Tests) und ihn dann arbeiten lassen;
den Kontext klein halten; und Agenten-Teams verbrauchen ein Vielfaches an Tokens, weil jedes Mitglied
sein eigenes Kontextfenster mitbringt. Daraus entstand die Frage, ob der Team-Aufbau für normale Aufgaben
nötig ist.

Quellen (abgerufen am 13.11.2026):

- [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- [Manage costs effectively](https://code.claude.com/docs/en/costs), dort der Abschnitt zu den Kosten
  von Agenten-Teams (gemeint sind Teams aus mehreren Claude-Instanzen)
- [Effective context engineering for AI agents](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents)
  (29.09.2025)
- Vortrag „Rethinking Claude Code Best Practices“ von Lydia Hallie:
  <https://www.youtube.com/watch?v=vlfCjWuv4es>

Codex und AGY haben das Collab-Setup unabhängig mitbewertet, damit eine neutrale
Grundlage entsteht. Ergebnis: Das Zusammenspiel Codex + CC + AGY bleibt sinnvoll; umgebaut wird nur in
einer getrennten Versuchsversion, und erst ein Vergleich entscheidet über Änderungen am Standard.

**Wir sind noch in der Konfigurations- und Messphase.** Nichts davon ist der neue Standard.

## Feste Regeln

- `~/ensemble`, `/collab` und `~/.claude` bleiben unverändert. Vor und nach echten Läufen die Prüfsummen
  vergleichen (Skript siehe unten).
- Nur in `~/projekte/ensemble-next` arbeiten. Seit 13.11.2026 privates Remote `origin`
  (`github.com/schrauberMK/ensemble-next`); Push nur auf Zuruf von Lutz.
- Jeder echte Agentenlauf kostet und wird von Lutz einzeln freigegeben.
- Testserver aufräumen nie mit `pgrep -f "tsx server.ts"` in derselben Shell (trifft die eigene Shell).
  Stattdessen: `ps -eo pid=,args= | grep "[n]ode --import tsx server.ts"` und auf
  `readlink /proc/<pid>/cwd` = `~/projekte/ensemble-next` prüfen.
- Server über die Vorschau starten: `preview_start` mit Namen `ensemble-next`
  (Konfiguration in `~/projekte/.claude/launch.json`, Port 23100).

## Was fertig ist

| Teil | Wo |
|---|---|
| Getrennte Laufzeit (Port 23100, `/tmp/ensemble-next`, `~/.ensemble-next`, Skill `collab-next` nur im Repo) | Paket 0 |
| Abschlusscheck für jeden Claude-Agenten (Stop-Hook, blockiert bei FAIL, Protokoll in `/tmp/ensemble-next/verify/`) | `hooks/verify-on-stop.cjs` |
| HANDOFF/RETURN, Lesestand per Nachrichten-ID (nur `team-read` markiert), `team-alive.sh`, keine Warteschleifen | `services/ensemble-service.ts`, `scripts/` |
| Zusammenfassung nach Nachrichtentyp mit Abschlusscheck | `lib/collab-summary.ts` |
| Schneller Teamabschluss nach Abnahme (60 s) | `closesAfterAcceptance` |
| Codex mit `--no-daemon`, Ordnerfreigabe „Trust this folder?“ wird erkannt | `agents.json`, `lib/startup-gates.ts` |
| Blinder Prüf-Skill | `skill/verify-deliverable/SKILL.md`, `scripts/review-bundle.sh --base` |
| Messaufbau: Aufgaben T1–T4, `run.sh`, `review.sh`, `collect.py`, `report.py`, `selftest.sh` | `bench/` |

Tests: 491 bestanden, 3 übersprungen. Letzter Commit vor dieser Übergabe: `9e06166` (+ `.gitignore`).

Aufruf der Versuchsversion (Agenten wählt man beim Aufruf, es gibt **keine** automatische Wahl):

```bash
~/projekte/ensemble-next/scripts/collab-launch.sh "$PWD" "Auftrag" codex,claude   # oder: claude | codex,claude,agy
```

## Letzter Messstand (T1, Variante A)

| | r1 | r2 | r3 | r4 |
|---|---|---|---|---|
| Stand | vor Fixes | Zustell-Fix | + `--no-daemon` | alle Fixes |
| Ergebnis | ✅ | ✅ | ungültig (Codex abgestürzt) | ✅ |
| Teamende | 264 s | 404 s | 399 s | **133 s** |
| Codex-Lead | 566k | 438k (fremder Thread) | – | **211k** |
| Claude | 664k | 412k | 672k | 466k |

r1–r4 liegen in `bench/results/` und sind Pilotläufe mit verschiedenen Codeständen.

## Nächste Schritte (in dieser Reihenfolge)

> **Stand 29.10.2026 (Branch `bench/paket-3-vorbereitung`):** Schritt 1 und 2 erledigt. Pilotläufe samt altem
> `REPORT.md` liegen in `bench/results/pilot/`. `bench/prices.json` ist eingetragen: 4 / 20 USD, Cache-Lesen 0,20,
> Cache-Schreiben 8 USD (1-h-Preis, weil r1–r4 nur 1-h-Cache schreiben). Nachrechnung der Pilotläufe: Claude
> 0,3–0,5 USD je Lauf (Variante A). Die Schätzung von 20–60 USD für 16 Läufe ist damit für A deutlich zu hoch;
> B (CC allein) ist noch ungemessen. Weiter mit Schritt 3.
>
> **Messreihe am 29.10. abgebrochen (Freigabe lag vor):** T1 lief 4×, dann Startfehler bei T2 B (keine erste
> Nachricht nach 12 s). Die T1-Läufe sind ungültig und liegen in `bench/results/defekt-2026-10-29/`:
> in A startete Codex nicht (`nocorrect` scheitert in bash, danach beendet sich `codex … --no-daemon` sofort ohne
> Ausgabe; Claude arbeitete allein), in B fehlt der Stop-Hook-Abschlusscheck (`finalCheck: null`, kein Eintrag in
> `/tmp/ensemble-next/verify/`). Vorher klären, dann die Reihe neu starten. Läufe aus der Desktop-App brauchen
> einen tmux-Server ohne die `CLAUDE_*`/`ANTHROPIC_*`-Variablen der App, und die Claude-CLI muss angemeldet sein.
>
> **Geklärt und behoben (29.10., nicht committet):**
> - A: Mit einem tmux-Server, den Lutz im Terminal startet, läuft Codex normal (Test von Lutz). Ursache ist der
>   aus Claude Desktop gestartete tmux-Server; warum Codex dort endet, ist offen. Vor jeder Reihe im Terminal:
>   `tmux new -d -s bench-keepalive`.
> - B: Ein Team, dessen letzter Agent `<<COLLAB_DONE>>` sendet, wurde sofort aufgelöst, bevor der Stop-Hook lief.
>   Jetzt wartet `checkIdleTeams` per `awaitingFinalCheck` (`services/ensemble-service.ts`) bis zu 600 s auf einen
>   Verify-Eintrag nach dem Signal (nur Claude-Agenten, nur wenn `ENSEMBLE_VERIFY_ON_STOP` nicht 0 ist).
>   Tests: 496 bestanden, 3 übersprungen.
> - Neu `bench/series.sh`: ganze Reihe, prüft `bench-keepalive` und hält bei ungültigen Läufen oder fehlendem
>   Abschlusscheck an. Nächster Schritt: je ein Testlauf T1 A und T1 B (Freigabe nötig), dann die 16 Läufe.
>
> **Testläufe 29.10. (`bench/results/probe-2026-10-29/`, zählen nicht):** T1 A 0 und T1 B 0 gültig und ACCEPTED,
> Codex als Lead aktiv, Abschlusscheck PASS in beiden. B: 52 s. A: 674 s, weil der Check vor dem Signal lief und
> der Hook bei unverändertem Stand keinen neuen Eintrag schrieb; das Team wartete die vollen 600 s. Behoben: Der Hook
> setzt bei jedem Stopp `stoppedAt`, die Wartelogik vergleicht damit (Suite 497 grün). Vor der Reihe noch ein
> Testlauf T1 A, der zeigen muss, dass das Team kurz nach dem letzten Signal endet.
>
> **Zweiter Testlauf T1 A 0 (22:47 UTC):** Teamende greift (15 s nach dem letzten Signal, Abschlusscheck PASS),
> aber Codex startete wieder nicht, obwohl `bench-keepalive` aus dem Terminal kam und der erste Testlauf damit lief.
> Der Codex-Start scheitert also zeitweise. Muster: ensemble meldet codex-1 nach 1 s als bereit (`›` im Fenster),
> fügt den Auftrag ein, danach steht eine bash da; `~/.codex/logs_2.sqlite` hat für diesen Start keine Einträge.
> Vermutung: ein Startdialog mit `›`-Auswahl, den `lib/startup-gates.ts` nicht kennt. Nächster Schritt: Fensterausgabe
> der Agenten per `tmux pipe-pane` mitschreiben, damit der Dialog sichtbar wird. Erst danach die Reihe starten.
>
> **Ursache gefunden (30.10., Mitschnitt `/tmp/ensemble-next/panes/`, eingebaut über `startPaneLog`, nicht committet):**
> Codex hat sich am 29.10. um 23:04 selbst auf 0.166.0 aktualisiert. Es zeigt beim Start zuerst kurz das Eingabefeld
> (`› Ask Codex to do anything`), erst danach „Trust this folder?“. ensemble wertet das erste `›` als bereit, fügt den
> Auftrag in den Dialog ein, Codex beendet sich. Ein Wettlauf: der Testlauf um 23:24 hatte Glück.
> **Umgebaut (nicht committet):** `waitForReady` meldet erst bereit, wenn das Bereit-Zeichen 2 s steht
> (`READY_SETTLE_MS`, per `ENSEMBLE_READY_SETTLE_MS` einstellbar, in Tests 0), kein Startdialog da ist und der Agent
> noch im Vordergrund läuft; ein später Dialog wird bestätigt, eine Shell gilt als gescheitert. Suite 503 grün.
> **Testlauf T1 A 0 (30.10., 00:25) gültig:** Codex als Lead (HANDOFF, Abnahme), Trust-Dialog nach dem Eingabefeld
> erkannt und bestätigt, bereit nach 7 s, Abschlusscheck PASS, ACCEPTED, 141 s, Code-Stand sauber (`41850d0`).
> Die Messreihe kann starten: im Terminal `tmux new -d -s bench-keepalive`, dann `bench/series.sh` (Freigabe nötig).

1. **Pilotläufe auslagern:** `bench/results/T1-A-r*.json` nach `bench/results/pilot/` verschieben, damit
   `report.py` sie nicht mitrechnet.
2. **Preise:** aktuelle Claude-Preise für `claude-opus-5-5` mit dem Skill `claude-api` nachschlagen und mit
   Quelle und Datum in `bench/prices.json` eintragen (Format im Kopf von `bench/report.py`). Nichts schätzen.
3. **Freigabe einholen** für die 16 Läufe (4 Aufgaben × A/B × 2), Reihenfolge ABBA, nacheinander.
   Schätzung 20–60 USD Claude (API-Äquivalent); Codex-Plus-Kontingent über 2–3 Fenster verteilen,
   bei über 80 % pausieren (`python3 -I bench/common.py codex-limits`, Feld `stale` beachten).
4. **Je Lauf:** `RUN=$(bench/run.sh T1 B 1 | tail -1)`, `bench/review.sh "$RUN"`,
   `python3 -I bench/collect.py "$RUN"`; am Ende `python3 -I bench/report.py` → `bench/results/REPORT.md`.
5. **Auswerten** nach der vorab festgelegten Regel in `plans/paket-3-vergleich.md`; Ergebnis in `NEXT.md`
   und im Vault (Bericht + Tagesnotiz) festhalten.

## Offene Punkte

- Ausgefallene Agenten werden beim Teamende nicht aufgeräumt (tmux-Sitzung bleibt stehen).
- Die Testsuite lässt pro Lauf einen Testserver zurück (vermutlich aus `~/ensemble` geerbt).
- Codex legt pro Arbeitsordner eine Freigabe in `~/.codex/config.toml` an; nach der Messreihe aufräumen
  (bisher r1, r4 und `/tmp/nodaemon-PeSL`).
- Die blinde Prüfung läuft noch nicht automatisch im Team, nur über `bench/review.sh` bzw. von Hand.
- Eine aufgabenabhängige automatische Wahl der Arbeitsweise ist Zielbild, nicht gebaut
  (ensemble hat dafür die leere Stelle `planCommand`). Erst nach dem Vergleich angehen.
- Größe von Systemprompt und Memory in einer Collab-Instanz unter `~/projekte` noch nicht gemessen
  (dort lädt zusätzlich die GodMode-`CLAUDE.md` mit toten Verweisen).

## Prüfsummen der alten Installation

```bash
(cd ~/ensemble && git status --porcelain && find . -path ./node_modules -prune -o -path ./.git -prune -o -type f -print0 | sort -z | xargs -0 sha256sum); find ~/.ensemble ~/.config/ensemble ~/.claude/skills/collab -type f -print0 | sort -z | xargs -0 sha256sum; sha256sum ~/.claude/settings.json
```

Ausgabe vor und nach einem Block in Dateien schreiben und mit `diff` vergleichen.

## Startsatz für die neue Sitzung

> Lies `~/projekte/ensemble-next/UEBERGABE.md` und mach mit Schritt 1 und 2 weiter (Pilotläufe auslagern,
> Preise nachschlagen). Die 16 Läufe startest du erst nach meiner Freigabe.
