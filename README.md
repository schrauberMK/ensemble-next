# ensemble-next

**Claude Code setzt eine Aufgabe um, Codex prüft das Ergebnis blind.** Wer mag, lässt beide stattdessen als Team arbeiten.

> **Beta (1.2.0-beta.1).** Das ist ein Werkzeug aus dem eigenen Gebrauch, kein fertiges Produkt. Es läuft unter Linux und ist dort erprobt; macOS ist vom Ursprungsprojekt her vorgesehen, hier aber nicht getestet. Nutzung auf eigene Verantwortung, ohne Gewährleistung (siehe [LICENSE](LICENSE)).

*English in one paragraph: ensemble-next runs Claude Code on a coding task and then has Codex review the finished change blind: read-only, in a fresh session, seeing only the task, the diff and the record of the project's own checks. A team mode (Codex leads, Claude Code implements) is available as well. It is a fork of [michelhelsdingen/ensemble](https://github.com/michelhelsdingen/ensemble) (MIT). Documentation is in German.*

## Was es macht

1. Du gibst eine Aufgabe und einen Projektordner vor (ein Git-Repo).
2. Claude Code plant und setzt die Aufgabe allein um.
3. Beim Stoppen läuft automatisch der **Abschlusscheck**: die Prüfungen, die das Projekt selbst festlegt (`typecheck`, `lint`, `test`, `build` aus `package.json`, oder `pytest`). Schlägt er fehl, wird Claude zum Nachbessern zurückgeschickt, mit festen Obergrenzen.
4. Danach prüft Codex **blind**: in einer frischen Sitzung, nur lesend, ohne Chatverlauf. Codex sieht die Aufgabe, den Diff und das Protokoll des Abschlusschecks.
5. Ein Skript gleicht die Fundstellen im Urteil mit dem Diff ab und hält fest, zu welchem Stand das Urteil gehört.
6. Du liest das Urteil und entscheidest. Committet wird nichts von selbst.

## Zwei Arbeitsweisen

| | Standard: Claude allein, Codex prüft | Team: Codex leitet, Claude setzt um |
|---|---|---|
| Aufruf | ohne Angabe von Agenten | `codex,claude` als drittes Argument oder `COLLAB_AGENTS=codex,claude` |
| Planung | Claude Code | Codex |
| Umsetzung | Claude Code | Claude Code |
| Blinde Prüfung danach | Codex, frische Sitzung | Codex, frische Sitzung |
| Codex-Ausstattung | Prüfer ohne MCP-Server, Plugins, Apps und Erinnerungen | Team-Codex mit deiner vollen Codex-Konfiguration |

In einer eigenen Messreihe (16 Läufe, 4 kleine Aufgaben) war die Qualität beider Wege gleich; der Standardweg brauchte im Median 57 s statt 156 s und deutlich weniger Tokens. Das ist eine Tendenz aus einem kleinen Pilotversuch, kein allgemeiner Beweis.

Welche KI-Modelle dabei arbeiten und wie du sie einstellst, steht ausführlich in der Dokumentation.

## Dokumentation

- **[docs/ensemble-next-doku.pdf](docs/ensemble-next-doku.pdf)**: die vollständige Beschreibung (Arbeitsweisen, Modelle, Einrichtung, Schalter, Messwerte, Grenzen). Quelle: [docs/ensemble-next-doku.tex](docs/ensemble-next-doku.tex).
- [docs/Kurzanleitung-ensemble-next.pdf](docs/Kurzanleitung-ensemble-next.pdf): zwei Seiten für den Alltag.
- [NEXT.md](NEXT.md): Entwicklungstagebuch mit allen Messungen und Befunden.
- [CHANGELOG-2026-11-13.md](CHANGELOG-2026-11-13.md) und [CHANGELOG-2026-10-30.md](CHANGELOG-2026-10-30.md): was sich geändert hat.
- [docs/README-upstream.md](docs/README-upstream.md): die README des Ursprungsprojekts (englisch) mit API, CLI und Monitor.

## Schnellstart

Voraussetzungen: Linux, Node.js, tmux, Python 3 sowie die Kommandozeilenprogramme `claude` (Claude Code) und `codex`, beide angemeldet.

```bash
git clone https://github.com/schrauberMK/ensemble-next.git
cd ensemble-next
npm install
npm run dev                      # Server auf Port 23100, Fenster offen lassen
```

In einem zweiten Terminal:

```bash
./scripts/setup-claude-code.sh   # einmalig: richtet /collab-next in Claude Code ein
./scripts/collab-launch.sh /pfad/zum/projekt "Aufgabe … Alle Tests müssen grün sein."
```

Das Ergebnis liegt unter `/tmp/ensemble-next/<TEAM_ID>/`: `summary.txt` und `review/verdict.txt`.

## Sicherheit und Kosten

- Die Agenten laufen ohne Rückfragen. Claude Code startet mit `--permission-mode auto`, Codex im Team mit `--dangerously-bypass-approvals-and-sandbox`. Nimm einen Projektordner, in dem das vertretbar ist, und arbeite mit Git, damit sich alles zurückholen lässt.
- Der Prüfer läuft dagegen nur lesend in einem leeren Ordner.
- Jeder Lauf verbraucht Kontingent oder Geld bei Anthropic und OpenAI.

## Herkunft und verwandte Projekte

| Projekt | Bezug |
|---|---|
| [michelhelsdingen/ensemble](https://github.com/michelhelsdingen/ensemble) | Ursprungsprojekt (MIT). ensemble-next ist ein Abkömmling davon; Server, Nachrichtenbus, Monitor und die meisten Skripte stammen von dort. |
| [nyldn/claude-octopus](https://github.com/nyldn/claude-octopus) | Ideengeber (MIT) für Zitatprüfung, Abbruchregeln, Bindung an die Prüfsumme und den abgeschotteten Prüfer. Kein Code übernommen. |
| [cubetribe/ClaudeCode_GodMode-On](https://github.com/cubetribe/ClaudeCode_GodMode-On) | CC_GodMode, ein Regelwerk für Claude Code. Eigenständig und proprietär, **nicht** in diesem Repo enthalten. ensemble-next verträgt sich damit, braucht es aber nicht. |
| [cubetribe/CODEX_GodMode_ON](https://github.com/cubetribe/CODEX_GodMode_ON) | Das Gegenstück für Codex. Ebenfalls nicht enthalten. |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) und [Codex CLI](https://github.com/openai/codex) | Die beiden Werkzeuge, die hier zusammenarbeiten. |

ensemble-next steht in keiner Verbindung zu Anthropic oder OpenAI und wird von ihnen weder unterstützt noch geprüft.

## Lizenz

MIT, wie das Ursprungsprojekt. Der ursprüngliche Urheberrechtsvermerk bleibt erhalten; siehe [LICENSE](LICENSE). Die Software wird ohne jede Gewährleistung bereitgestellt.
