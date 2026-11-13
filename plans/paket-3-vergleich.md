# Paket 3: Vergleich der Arbeitsweisen (Plan, noch nicht ausgeführt)

Stand: 25.10.2026. Grundlage: ensemble-next nach Paket 2 (`b821965`).

## Frage

Ist **B „CC plant und setzt um“** bei gleicher blinder Prüfung mindestens so gut wie
**A „Codex plant → CC setzt um“**, und ist B dabei schneller oder günstiger?

| | A: Codex plant → CC setzt um | B: CC plant und setzt um |
|---|---|---|
| Team | `codex,claude` (Lead codex-1, Worker claude-2) | `claude` allein (Solo-Prompt) |
| Ablauf | HANDOFF → Umsetzung → RETURN | Plan, Umsetzung, RETURN in einem Kontext |
| Abschlusscheck | Stop-Hook aus Paket 1 | Stop-Hook aus Paket 1 |
| Blinde Prüfung | `verify-deliverable` per `codex exec` (read-only, leerer Ordner, nur Skill + Bundle mit `--base`) | identisch |

Die blinde Prüfung läuft in beiden Varianten in einer **eigenen, frischen Codex-Sitzung** ohne
Chatverlauf. In A ist sie damit blind, obwohl codex-1 die HANDOFF schrieb.

Dies ist ein **Pilot**. Er zeigt eine Tendenz für eure Aufgabenarten, keinen allgemeinen Beweis.

## Gleiche Bedingungen

- dieselbe ensemble-next-Version (Commit wird pro Lauf protokolliert)
- dasselbe Claude-Modell (`claude-opus-5-5`, wie in den bisherigen Läufen) und dasselbe Codex-Modell
  (`gpt-6.1-sol`); beides wird pro Lauf aus den Protokollen gelesen und bei Abweichung markiert
- jede Aufgabe startet aus derselben Vorlage in einem frischen Ordner unter `/tmp/ensemble-next-bench/`,
  Git-Basis-Commit wird als `--base` festgehalten
- Arbeitsordner außerhalb von `~/projekte`, damit `~/projekte/CLAUDE.md` in keiner Variante geladen wird
- dieselbe Auftragsdatei mit denselben Abnahmekriterien; versteckte Abnahmetests sehen die Agenten nicht
- Läufe nacheinander, nie parallel; Reihenfolge A/B abwechselnd (ABBA), damit Tageszeit und
  Kontingentstand nicht eine Variante bevorzugen
- kein menschliches Eingreifen während eines Laufs; jedes Eingreifen wird gezählt

## Aufgaben (4 Vorlagen in `bench/fixtures/`)

| # | Art | Inhalt | Was sie prüft |
|---|---|---|---|
| T1 | Bugfix | Off-by-one in einer Datumsfunktion, ein sichtbarer roter Test | Grundfall, kurze Aufgabe |
| T2 | Feature über mehrere Dateien | CLI-Option `--json` für ein kleines Node-Tool, Doku und Test ergänzen | Übergabe von Schreibbereich und Abnahme |
| T3 | Refactoring mit Auflage | Modul aufteilen, Verhalten unverändert, Lint muss grün bleiben | Disziplin im Schreibbereich, keine Verhaltensänderung |
| T4 | Widersprüchlicher Auftrag | Auftrag und Test verlangen Unterschiedliches (wie „x“ gegen „hallo“) | ob `NEEDS_DECISION`/`BLOCKED` gemeldet statt geraten oder Test abgeschwächt wird |

Jede Vorlage enthält: Projektdateien, `task.md` (Auftrag + Abnahmekriterien + Schreibbereich),
`hidden/` (versteckte Abnahmetests, wird erst nach dem Lauf hineinkopiert), `guard.sha` (Prüfsummen
der Dateien, die nicht verändert werden dürfen).

**Umfang:** 4 Aufgaben × 2 Varianten × 2 Wiederholungen = **16 Läufe** plus 16 blinde Prüfungen.

## Messgrößen

Alle Werte pro Lauf in `bench/results/<lauf>.json`, am Ende eine Tabelle in `bench/results/REPORT.md`.

**Qualität (entscheidet zuerst)**
1. versteckte Abnahmetests: bestanden ja/nein
2. blindes Verdict: `ACCEPTED` / `CHANGES_REQUESTED` / `REJECTED`, mit Kriterien-Treffern
3. Schreibbereich verletzt: Dateien außerhalb, Prüfsummen von `guard.sha` verändert, Commits
4. T4: richtige Eskalation (`NEEDS_DECISION` oder `BLOCKED` mit Begründung) ja/nein
5. Ehrlichkeit: `READY_FOR_REVIEW` gemeldet, aber Abschlusscheck nicht `PASS` (Warnung aus Paket 2)

**Nacharbeit**
6. Anzahl FAIL-Blockaden des Stop-Hooks bis zum Ende
7. Rückfragen zwischen den Agenten (`--type question`), nur A

**Zeit**
8. Gesamtdauer: Team erstellt → `.finished`
9. Zeit bis zur ersten Dateiänderung (mtime im Arbeitsordner)

**Verbrauch (echte Daten, nicht Terminal-Scraping)**
10. Claude: Summe aus `~/.claude/projects/<arbeitsordner>/<session>.jsonl`, je Nachricht nur einmal
    (nach `message.id`), getrennt nach `input`, `cache_creation`, `cache_read`, `output`;
    eingeschlossen sind Subagenten-Protokolle derselben Sitzung, falls vorhanden
11. Codex-Lead (nur A): letzte `token_count` aus `~/.codex/sessions/.../rollout-*.jsonl`, zugeordnet über
    `session_meta.cwd` und Startzeit; der Preflight-Probe-Lauf wird ausgeschlossen
12. Codex-Prüfer: dieselbe Quelle, getrennt ausgewiesen
13. Kosten Claude in USD: Tokenkategorien × Preisliste, die beim Auswerten aktuell nachgeschlagen
    und im Report mit Datum genannt wird (API-Äquivalent; bei Abo zählt es gegen das Kontingent)
14. Codex: Tokens und Kontingentverbrauch (`rate_limits.primary.used_percent` vorher/nachher),
    keine USD, da ChatGPT-Plus-Abo

**Kommunikation**
15. Nachrichten gesamt und je Typ, Zeichen gesamt

## Entscheidungsregel (vor den Läufen festgelegt)

B wird Standard für Aufgaben dieser Art, wenn **alle** gelten:

- versteckte Tests: B besteht mindestens so oft wie A
- Schreibbereich und Prüfsummen: B verletzt nicht öfter als A
- blindes `ACCEPTED`: B höchstens einen Lauf weniger als A
- T4: B eskaliert mindestens so oft richtig wie A
- und B ist in **Dauer oder Gesamtverbrauch** um mindestens 20 % besser (Median über die 8 Läufe je Variante)

Ist B bei Qualität schlechter, bleibt A Standard. Ist B gleich gut, aber nicht 20 % besser, bleibt die
Wahl je nach Aufgabe offen und wird nicht umgestellt. Die Regel wird nicht nachträglich angepasst; jede
Abweichung wird im Report begründet.

## Was vorher gebaut wird (Paket 3a, ohne echte Agentenläufe)

| Datei | Zweck |
|---|---|
| `bench/fixtures/T1..T4/` | Vorlagen wie oben |
| `bench/run.sh <task> <A\|B> <rep>` | frischer Ordner, `git init` + Basis-Commit, Kontingent vorher lesen, `collab-launch.sh` mit `codex,claude` bzw. `claude`, auf `.finished` warten (Zeitlimit 20 min, dann Abbruch und Vermerk) |
| `bench/collect.py <lauf>` | Verbrauch aus Claude- und Codex-Protokollen, Verify-Protokoll, Nachrichten, Zeiten, versteckte Tests, Prüfsummen, Commits |
| `bench/review.sh <lauf>` | Bundle mit `--base`, `codex exec` blind, Verdict speichern |
| `bench/report.py` | Tabelle und Medianwerte, Entscheidung nach der Regel oben |
| Tests | `collect.py` gegen aufgezeichnete Protokolle der bisherigen Läufe (collab-p2, verify-live); Fixtures: versteckte Tests sind vor dem Lauf rot und mit Referenzlösung grün |

Vor dem ersten echten Lauf: ein Trockenlauf von `collect.py` und `review.sh` auf dem vorhandenen
collab-p2-Lauf.

## Kosten und Dauer (Schätzung)

Gemessene Anker aus Paket 1/2:

| Lauf | Claude | Codex |
|---|---|---|
| `claude -p`, zwei Kleinstaufgaben | ~373k Eingabe (fast alles Cache), 2,4k Ausgabe = **0,65 USD** (von der CLI gemeldet) | – |
| Teamlauf `add(a, b)` | ~412k Eingabe (28,5k Cache-Schreiben, 383k Cache-Lesen), 2,1k Ausgabe, also ähnlich, **~0,7 USD** geschätzt | Lead 589k Eingabe (544k Cache), 2,3k Ausgabe |
| blinder Review | – | ~einige 10k Tokens |

Die Bench-Aufgaben sind größer als `add(a, b)`. Annahme: 2- bis 5-facher Verbrauch.

| Posten | Schätzung |
|---|---|
| Claude, 16 Läufe | **ca. 20–60 USD** API-Äquivalent (1–4 USD je Lauf); B eher am oberen Rand, weil Claude dort auch plant |
| Codex, 8 Lead-Läufe + 16 Prüfungen | ca. 5–25 Mio. Tokens, überwiegend Cache; **Risiko:** Plus-Kontingent (5-h-Fenster stand heute nach einem Lauf bei 22 %). Deshalb Läufe über 2–3 Fenster verteilen und bei > 80 % pausieren |
| Wanduhrzeit | 5–15 min je Lauf + 1–2 min Prüfung, sequenziell **ca. 2,5–4,5 h**, verteilt auf zwei Sitzungen |
| Bau Paket 3a | eine Arbeitssitzung, ohne Agentenkosten |

Abbruchgrenzen: Ein Lauf über 20 min oder über 60 000 Claude-Ausgabetokens wird abgebrochen und als
„abgebrochen“ gewertet (zählt bei Qualität als nicht bestanden). Die Ausgabetokens ersetzen die
ursprünglich geplante 8-USD-Grenze, weil das Werkzeug während des Laufs keine Preise kennt; sie liegen
etwa beim Zwanzigfachen des Teamlaufs aus Paket 2 (2,1k).

Nachtrag Paket 3a: Die blinde Prüfung läuft **ohne** `--ephemeral`, damit ihr Verbrauch im
Codex-Protokoll steht.

## Was der Pilot nicht zeigt

- Verhalten in echten Projekten unter `~/projekte` (dort lädt zusätzlich die GodMode-`CLAUDE.md`)
- große Aufgaben über viele Dateien und lange Laufzeiten
- AGY als dritter Agent; das wäre ein eigener Vergleich danach
- Unterschiede durch Promptkürzung oder MCP-Beschränkung; die werden danach **einzeln** erprobt

## Isolation

Wie bisher: Prüfsummen der alten Installation vor und nach jedem Block; nichts in `~/.claude` oder
`~/ensemble`. Claude- und Codex-Sitzungsprotokolle entstehen dabei wie bei jeder Nutzung in
`~/.claude/projects/` und `~/.codex/sessions/`; sie werden nur gelesen.

## Freigaben

1. Paket 3a bauen (keine Agentenkosten)
2. danach die 16 Läufe starten (Kosten wie oben)
