"""Aggregate bench results into REPORT.md and apply the decision rule of Paket 3.

Usage: python3 -I bench/report.py [--results-dir <dir>] [--out <file>] [--prices <file>] [--include-dry]

Claude cost in USD needs bench/prices.json (looked up when evaluating, with source and date):
  {"source": "...", "date": "YYYY-MM-DD",
   "models": {"claude-opus-5-5": {"input": 0.0, "cacheWrite": 0.0, "cacheRead": 0.0, "output": 0.0}}}
prices per million tokens. Without it the cost criterion stays open; nothing is guessed.
"""
import json
import statistics
import sys
from pathlib import Path

BENCH = Path(__file__).resolve().parent


def load(results_dir, include_dry):
    rows = []
    for f in sorted(Path(results_dir).glob('*.json')):
        try:
            r = json.loads(f.read_text(encoding='utf-8'))
        except json.JSONDecodeError:
            continue
        if not isinstance(r, dict) or 'runId' not in r or 'variant' not in r:
            continue  # not a result file (prices.json and the like)
        if r.get('dryRun') and not include_dry:
            continue
        rows.append(r)
    return rows


def valid(rows):
    return [r for r in rows if not (r.get('quality') or {}).get('invalid')]


def claude_usd(r, prices):
    if not prices:
        return None
    c = r['usage']['claude']
    models = c.get('models') or []
    if len(models) != 1 or models[0] not in prices.get('models', {}):
        return None
    p = prices['models'][models[0]]
    t = c['tokens']
    return round((t['input_tokens'] * p['input'] + t['cache_creation_input_tokens'] * p['cacheWrite']
                  + t['cache_read_input_tokens'] * p['cacheRead'] + t['output_tokens'] * p['output']) / 1e6, 4)


def codex_tokens(r):
    c = r['usage']['codex']
    return c.get('leadTotal', 0) + c.get('reviewerTotal', 0)


def median(values):
    values = [v for v in values if v is not None]
    return statistics.median(values) if values else None


def summarize(rows, prices):
    out = {}
    for v in ('A', 'B'):
        rs = [r for r in rows if r['variant'] == v]
        q = [r['quality'] for r in rs]
        esc = [x for x in q if x['escalationExpected']]
        usd = [claude_usd(r, prices) for r in rs]
        out[v] = {
            'runs': len(rs),
            'hiddenPass': sum(1 for x in q if x['hiddenPass'] and not x['aborted']),
            'violations': sum(1 for x in q if x['scopeViolation']),
            'accepted': sum(1 for x in q if x['verdict'] == 'ACCEPTED'),
            'escalationCorrect': sum(1 for x in esc if x['escalationCorrect']),
            'escalationRuns': len(esc),
            'falseEscalations': sum(1 for x in q if x['falseEscalation']),
            'readyWithoutPass': sum(1 for x in q if x['readyWithoutPass']),
            'aborted': sum(1 for x in q if x['aborted']),
            'medianDurationS': median([r['time']['durationS'] for r in rs]),
            'medianClaudeTokens': median([r['usage']['claude']['tokens']['total'] for r in rs]),
            'medianClaudeUsd': median(usd) if rs and all(u is not None for u in usd) else None,
            'medianCodexTokens': median([codex_tokens(r) for r in rs]),
            'medianMessages': median([r['messages']['total'] for r in rs]),
            'hookBlocks': sum(r['rework']['hookBlocks'] for r in rs),
        }
    return out


def better(b, a, factor=0.8):
    return None if a is None or b is None else b <= a * factor


def decide(s):
    A, B = s['A'], s['B']
    if not A['runs'] or not B['runs']:
        return {'decision': 'offen', 'reason': 'eine Variante hat keine Läufe', 'checks': {}}
    checks = {
        'hidden_B>=A': B['hiddenPass'] >= A['hiddenPass'],
        'violations_B<=A': B['violations'] <= A['violations'],
        'accepted_B>=A-1': B['accepted'] >= A['accepted'] - 1,
        'escalation_B>=A': B['escalationCorrect'] >= A['escalationCorrect'],
    }
    quality = all(checks.values())
    duration = better(B['medianDurationS'], A['medianDurationS'])
    # Cost: Claude USD and Codex tokens are not commensurable. B counts as cheaper when one is
    # at least 20 % lower and the other is not higher.
    usd_b, usd_a = B['medianClaudeUsd'], A['medianClaudeUsd']
    cdx_b, cdx_a = B['medianCodexTokens'], A['medianCodexTokens']
    if usd_a is None or usd_b is None:
        cost = None
    else:
        cost = (better(usd_b, usd_a) and cdx_b <= cdx_a) or (usd_b <= usd_a and better(cdx_b, cdx_a))
    checks['duration_B<=0.8A'] = duration
    checks['cost_B_20pct_better'] = cost
    if not quality:
        return {'decision': 'A bleibt Standard', 'reason': 'B ist bei der Qualität schlechter', 'checks': checks}
    if duration or cost:
        return {'decision': 'B wird Standard für diese Aufgabenarten', 'reason': 'Qualität mindestens gleich, Dauer oder Verbrauch mindestens 20 % besser', 'checks': checks}
    if cost is None and not duration:
        return {'decision': 'offen', 'reason': 'Qualität gleich, Dauer nicht 20 % besser, Kostenkriterium offen (bench/prices.json fehlt)', 'checks': checks}
    return {'decision': 'je nach Aufgabe, keine Umstellung', 'reason': 'Qualität gleich, aber weder Dauer noch Verbrauch 20 % besser', 'checks': checks}


def fmt(v):
    if v is None:
        return '–'
    if isinstance(v, bool):
        return 'ja' if v else 'nein'
    if isinstance(v, float):
        return f'{v:,.1f}'.replace(',', ' ')
    if isinstance(v, int):
        return f'{v:,}'.replace(',', ' ')
    return str(v)


def render(rows, prices):
    s = summarize(valid(rows), prices)
    d = decide(s)
    lines = ['# Paket 3: Ergebnis', '']
    if any(r.get('dryRun') for r in rows):
        lines += ['**Enthält Trockenläufe; kein Ergebnis für die Entscheidung.**', '']
    invalid = [r for r in rows if (r.get('quality') or {}).get('invalid')]
    if invalid:
        lines += ['Ungültig, nicht in der Entscheidung: ' + ', '.join(f"{r['runId']} ({r['quality']['invalid']})" for r in invalid), '']
    lines += [f'Läufe: {len(rows)}. Preise: ' + (f"{prices.get('source')} ({prices.get('date')})" if prices else 'nicht hinterlegt'), '']
    lines += ['## Je Lauf', '',
              '| Lauf | Status | versteckt | Scope verletzt | Eskalation | Verdict | Dauer s | Claude Tokens | Claude USD | Codex Tokens | Nachr. | Hook-Blocks |',
              '|---|---|---|---|---|---|---|---|---|---|---|---|']
    for r in sorted(rows, key=lambda r: (r['task'], r['variant'], r['rep'])):
        q = r['quality']
        esc = q['escalationCorrect'] if q['escalationExpected'] else ('falsch' if q['falseEscalation'] else '–')
        lines.append('| ' + ' | '.join(fmt(x) for x in [
            r['runId'], r['status'], q['hiddenPass'], q['scopeViolation'], esc, q['verdict'],
            r['time']['durationS'], r['usage']['claude']['tokens']['total'], claude_usd(r, prices),
            codex_tokens(r), r['messages']['total'], r['rework']['hookBlocks']]) + ' |')
    lines += ['', '## Je Variante', '', '| Kennzahl | A: Codex plant → CC | B: CC allein |', '|---|---|---|']
    labels = [('runs', 'Läufe'), ('hiddenPass', 'versteckte Tests bestanden'), ('violations', 'Scope-/Guard-/Commit-Verstöße'),
              ('accepted', 'blind ACCEPTED'), ('escalationCorrect', 'T4 richtig eskaliert'), ('falseEscalations', 'unnötig eskaliert'),
              ('readyWithoutPass', 'READY_FOR_REVIEW ohne PASS'), ('aborted', 'abgebrochen'),
              ('medianDurationS', 'Median Dauer s'), ('medianClaudeTokens', 'Median Claude-Tokens'),
              ('medianClaudeUsd', 'Median Claude USD'), ('medianCodexTokens', 'Median Codex-Tokens (Lead + Prüfer)'),
              ('medianMessages', 'Median Nachrichten'), ('hookBlocks', 'Hook-Blockaden gesamt')]
    for key, label in labels:
        lines.append(f"| {label} | {fmt(s['A'][key])} | {fmt(s['B'][key])} |")
    lines += ['', '## Entscheidung (Regel aus plans/paket-3-vergleich.md)', '',
              f"**{d['decision']}** – {d['reason']}", '']
    for k, v in d['checks'].items():
        lines.append(f'- {k}: {fmt(v)}')
    lines += ['', 'Pilot mit wenigen Läufen: eine Tendenz für diese Aufgabenarten, kein allgemeiner Beweis.', '']
    return '\n'.join(lines), s, d


def main(argv):
    results_dir, out, include_dry = BENCH / 'results', None, '--include-dry' in argv
    if '--results-dir' in argv:
        results_dir = Path(argv[argv.index('--results-dir') + 1])
    if '--out' in argv:
        out = Path(argv[argv.index('--out') + 1])
    prices_file = Path(argv[argv.index('--prices') + 1]) if '--prices' in argv else BENCH / 'prices.json'
    prices = json.loads(prices_file.read_text(encoding='utf-8')) if prices_file.exists() else None
    rows = load(results_dir, include_dry)
    text, _, d = render(rows, prices)
    target = out or Path(results_dir) / 'REPORT.md'
    target.write_text(text, encoding='utf-8')
    print(f"{target}: {d['decision']}")


if __name__ == '__main__':
    main(sys.argv[1:])
