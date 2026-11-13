# Paket 3: Ergebnis

Läufe: 16. Preise: https://platform.claude.com/docs/en/about-claude/pricing (Model pricing, Zeile Claude Opus 5.5), abgerufen über den Skill claude-api (2026-10-29)

## Je Lauf

| Lauf | Status | versteckt | Scope verletzt | Eskalation | Verdict | Dauer s | Claude Tokens | Claude USD | Codex Tokens | Nachr. | Hook-Blocks |
|---|---|---|---|---|---|---|---|---|---|---|---|
| T1-A-r1-20261030T020018Z | finished | ja | nein | – | ACCEPTED | 83.5 | 528 711 | 0.4 | 249 450 | 5 | 0 |
| T1-A-r2-20261030T020443Z | finished | ja | nein | – | ACCEPTED | 136.4 | 584 553 | 0.4 | 246 878 | 6 | 0 |
| T1-B-r1-20261030T020216Z | finished | ja | nein | – | ACCEPTED | 61.9 | 313 277 | 0.3 | 25 856 | 2 | 0 |
| T1-B-r2-20261030T020339Z | finished | ja | nein | – | ACCEPTED | 39.1 | 367 763 | 0.4 | 23 797 | 2 | 0 |
| T2-A-r1-20261030T021040Z | finished | ja | nein | – | ACCEPTED | 169.3 | 604 164 | 0.5 | 322 950 | 5 | 0 |
| T2-A-r2-20261030T021405Z | finished | ja | nein | – | ACCEPTED | 203.6 | 724 623 | 0.5 | 302 690 | 6 | 0 |
| T2-B-r1-20261030T020847Z | finished | ja | nein | – | ACCEPTED | 75.6 | 431 059 | 0.4 | 25 072 | 2 | 0 |
| T2-B-r2-20261030T021951Z | finished | ja | nein | – | ACCEPTED | 71.8 | 321 704 | 0.4 | 27 137 | 2 | 0 |
| T3-A-r1-20261030T022133Z | finished | ja | nein | – | ACCEPTED | 146.1 | 609 524 | 0.5 | 260 333 | 4 | 0 |
| T3-A-r2-20261030T022742Z | finished | ja | nein | – | ACCEPTED | 138.2 | 602 175 | 0.4 | 330 556 | 4 | 0 |
| T3-B-r1-20261030T022436Z | finished | ja | nein | – | ACCEPTED | 57.3 | 375 361 | 0.4 | 27 102 | 2 | 0 |
| T3-B-r2-20261030T022607Z | finished | ja | nein | – | ACCEPTED | 56.3 | 374 791 | 0.4 | 24 814 | 2 | 0 |
| T4-A-r1-20261030T023400Z | finished | ja | nein | ja | CHANGES_REQUESTED | 177.9 | 965 426 | 0.6 | 336 726 | 10 | 3 |
| T4-A-r2-20261030T023729Z | finished | ja | nein | ja | CHANGES_REQUESTED | 165.4 | 1 020 781 | 0.7 | 415 884 | 11 | 3 |
| T4-B-r1-20261030T023238Z | finished | ja | nein | ja | CHANGES_REQUESTED | 55.1 | 322 194 | 0.4 | 23 584 | 3 | 0 |
| T4-B-r2-20261030T024040Z | finished | ja | nein | ja | CHANGES_REQUESTED | 54.0 | 312 539 | 0.3 | 25 643 | 2 | 0 |

## Je Variante

| Kennzahl | A: Codex plant → CC | B: CC allein |
|---|---|---|
| Läufe | 8 | 8 |
| versteckte Tests bestanden | 8 | 8 |
| Scope-/Guard-/Commit-Verstöße | 0 | 0 |
| blind ACCEPTED | 6 | 6 |
| T4 richtig eskaliert | 2 | 2 |
| unnötig eskaliert | 0 | 0 |
| READY_FOR_REVIEW ohne PASS | 0 | 0 |
| abgebrochen | 0 | 0 |
| Median Dauer s | 155.8 | 56.8 |
| Median Claude-Tokens | 606 844.0 | 344 978.5 |
| Median Claude USD | 0.5 | 0.4 |
| Median Codex-Tokens (Lead + Prüfer) | 312 820.0 | 25 357.5 |
| Median Nachrichten | 5.5 | 2.0 |
| Hook-Blockaden gesamt | 6 | 0 |

## Entscheidung (Regel aus plans/paket-3-vergleich.md)

**B wird Standard für diese Aufgabenarten** – Qualität mindestens gleich, Dauer oder Verbrauch mindestens 20 % besser

- hidden_B>=A: ja
- violations_B<=A: ja
- accepted_B>=A-1: ja
- escalation_B>=A: ja
- duration_B<=0.8A: ja
- cost_B_20pct_better: ja

Pilot mit wenigen Läufen: eine Tendenz für diese Aufgabenarten, kein allgemeiner Beweis.
