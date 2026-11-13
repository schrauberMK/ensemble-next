# Aufgabe T2: Option --json für wc

Das Werkzeug `bin/wc.js` gibt `words: N` aus. Ergänze eine Option `--json`, die stattdessen
ein JSON-Objekt `{ "file": <Pfad wie übergeben>, "words": N, "lines": M }` ausgibt. `lines` ist die
Anzahl der Zeilen der Datei, leere Zeilen zählen mit, ein abschließender Zeilenumbruch erzeugt keine
zusätzliche Zeile. Die Zeilenzählung gehört als `countLines` nach `lib/count.js`.

Schreibbereich: `bin/wc.js`, `lib/count.js`, `README.md`, neue Testdatei `test/json.test.js`.

Abnahme:
- `npm test` ist grün
- ohne `--json` bleibt die Ausgabe exakt wie bisher
- `--json` liefert gültiges JSON mit den drei Feldern
- README beschreibt `--json`
- ein Test für `countLines` liegt in `test/json.test.js`
- `package.json` und `test/count.test.js` bleiben unverändert
- keine Commits
