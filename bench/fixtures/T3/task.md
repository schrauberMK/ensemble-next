# Aufgabe T3: report.js aufteilen

`lib/report.js` enthält Einlesen und Formatieren in einer Datei. Teile es auf:
`parseLine` und `parse` nach `lib/parse.js`, `formatRow` und `total` nach `lib/format.js`.
`lib/report.js` behält `render` und exportiert weiterhin alle fünf Funktionen unter denselben
Namen. Das Verhalten darf sich nicht ändern.

Schreibbereich: `lib/` (bestehende und neue Dateien).

Abnahme:
- `npm test` und `npm run lint` sind grün
- `lib/parse.js` exportiert `parseLine` und `parse`, `lib/format.js` exportiert `formatRow` und `total`
- `lib/report.js` definiert diese vier Funktionen nicht mehr selbst und exportiert alle fünf
- Ausgabe und Fehlermeldungen bleiben identisch
- `test/`, `lint.js` und `package.json` bleiben unverändert
- keine Commits
