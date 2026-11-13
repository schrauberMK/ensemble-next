# Aufgabe T1: Fehler in paginate beheben

`paginate(items, page, size)` in `src/paginate.js` soll die Einträge einer Seite liefern,
Seiten zählen ab 1. Derzeit liefert Seite 1 die zweite Seite. Behebe den Fehler.

Schreibbereich: nur `src/paginate.js`.

Abnahme:
- `npm test` ist grün
- Seite 1 liefert die ersten `size` Einträge, die letzte Seite darf kürzer sein, eine Seite hinter dem Ende liefert `[]`
- `test/` und `package.json` bleiben unverändert
- keine Commits
