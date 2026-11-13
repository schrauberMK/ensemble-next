#!/usr/bin/env python3
"""verdict-grounding — Check the file:line citations of a blind review verdict against its bundle.

Usage: verdict-grounding.py <verdict.txt> <bundle.md> [--work <dir>] [--json <out.json>]
                            [--current-bundle <bundle.md>]

The reviewer (verify-deliverable) must quote the file and line that decides each criterion.
Nothing checked that so far: a verdict could cite places that do not exist. This script reads
the citations and compares them with the diff in the bundle (scripts/review-bundle.sh) and,
with --work, with the files in the work tree. It runs no model and costs no tokens.

Status:
  grounded    at least one citation lies in the reviewed diff and none is wrong
  ungrounded  no citation lies in the reviewed diff (an ACCEPTED then counts as unproven)
  invalid     at least one citation names a file that does not exist or a line past its end

Warnings do not change the status: a line outside every diff hunk (the reviewer only saw the
hunks), a file outside the diff, and a `quoted` snippet on a citation line that occurs neither
in the bundle nor in the cited file.

Binding: the result carries the SHA-256 of the reviewed bundle and of its change section (the
diff since the base commit incl. new files and the commit list), so a verdict names exactly the
state it judged. With --current-bundle (a bundle built again after the review) the two change
sections are compared: binding.current is false when the work tree moved on in the meantime,
and the note says that the verdict belongs to the older state. scripts/verdict-check.sh does
the same comparison later, e.g. before a merge.

Limits: a citation that resolves does not prove the reviewer read the place or judged it
correctly. Line numbers are only compared with ranges (hunk +/- 3 lines, file length), because
a reviewer counting lines inside a hunk is easily off by a few.

Prints a short German note to stdout; --json writes the full result. Exit 0 when the check
ran (whatever the status), 2 on wrong usage or unreadable input.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

TOLERANCE = 3
MIN_QUOTE = 8
CITATION = re.compile(
    r'(?<![\w/.:@-])((?:[\w@+~-]+/)*[\w@+.-]*\.[A-Za-z]\w*|(?:[\w@+~.-]+/)+[\w@+.-]+)'
    r':(\d+)(?:\s*[-–]\s*(\d+))?')
HUNK = re.compile(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@')


def diff_section(bundle):
    """The lines between the '## 2.' and the last '## 3. Automatic final check' heading."""
    lines = bundle.splitlines()
    start = next((i for i, l in enumerate(lines) if l.startswith('## 2. Change')), None)
    if start is None:
        return []
    ends = [i for i, l in enumerate(lines) if l.startswith('## 3. Automatic final check') and i > start]
    return lines[start + 1:ends[-1] if ends else len(lines)]


def sha(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def binding(bundle, current_bundle=None):
    """Checksums of the reviewed bundle; with a bundle built later, whether the change is still the same."""
    change = sha('\n'.join(diff_section(bundle)))
    out = {'bundleSha256': sha(bundle), 'changeSha256': change, 'current': None}
    if current_bundle is not None:
        out['currentChangeSha256'] = sha('\n'.join(diff_section(current_bundle)))
        out['current'] = out['currentChangeSha256'] == change
    return out


def parse_diff(lines):
    """{path: {'new': [(from, to)], 'old': [(from, to)], 'deleted': bool}} for both path sides."""
    files, cur = {}, None
    old_path = None
    for line in lines:
        if line.startswith('--- '):
            old_path = strip_side(line[4:])
            continue
        if line.startswith('+++ '):
            new_path = strip_side(line[4:])
            cur = {'new': [], 'old': [], 'deleted': new_path is None}
            for p in {old_path, new_path} - {None}:
                files[p] = cur
            continue
        m = HUNK.match(line)
        if m and cur is not None:
            o, oc, n, nc = int(m[1]), int(m[2] or 1), int(m[3]), int(m[4] or 1)
            if oc:
                cur['old'].append((o, o + oc - 1))
            if nc:
                cur['new'].append((n, n + nc - 1))
    return files


def strip_side(path):
    path = path.split('\t')[0].strip()
    if path == '/dev/null':
        return None
    return path[2:] if path[:2] in ('a/', 'b/') else path


def work_files(work):
    try:
        out = subprocess.run(['git', '-C', str(work), 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
                             capture_output=True, timeout=20).stdout.decode('utf-8', 'replace')
        return [p for p in out.split('\0') if p]
    except (OSError, subprocess.SubprocessError):
        return []


def read_inside(work, rel):
    """Text of work/rel, or None when it is missing or leaves the work tree."""
    if work is None:
        return None
    try:
        root = Path(work).resolve()
        target = (root / rel).resolve()
        if root != target and root not in target.parents:
            return None
        return target.read_text(encoding='utf-8', errors='replace') if target.is_file() else None
    except OSError:
        return None


def resolve(path, known):
    """Exact path, else the single known path that ends with it."""
    if path in known:
        return path
    hits = [k for k in known if k.endswith('/' + path)]
    return hits[0] if len(hits) == 1 else None


def near(ranges, first, last):
    return any(first <= hi + TOLERANCE and last >= lo - TOLERANCE for lo, hi in ranges)


def squash(text):
    return re.sub(r'\s+', ' ', text).strip()


def check(verdict, bundle, work=None, current_bundle=None):
    diff_lines = diff_section(bundle)
    diff = parse_diff(diff_lines)
    tracked = work_files(work) if work else []
    # Diff lines also without their +/-/space marker, so a quoted code line matches.
    corpus = squash(bundle + '\n' + '\n'.join(l[1:] for l in diff_lines if l[:1] in '+- '))

    citations, quotes, seen = [], [], set()
    for line in verdict.splitlines():
        found = []
        for m in CITATION.finditer(line):
            raw = m[1]
            path = raw[2:] if raw[:2] in ('./', 'a/', 'b/') else raw
            first, last = int(m[2]), int(m[3] or m[2])
            if last < first:
                first, last = last, first
            entry = {'cite': f'{raw}:{m[2]}' + (f'-{m[3]}' if m[3] else ''), 'path': path, 'line': first, 'lineEnd': last}
            in_diff = resolve(path, diff)
            in_work = None if in_diff else resolve(path, tracked) or (path if read_inside(work, path) is not None else None)
            text = read_inside(work, in_diff or in_work) if (in_diff or in_work) else None
            length = len(text.splitlines()) if text is not None else None
            if not in_diff and not in_work:
                entry.update(result='unknown_file', detail='Datei kommt weder im Diff noch im Arbeitsordner vor')
            elif length is not None and last > length:
                entry.update(result='bad_line', detail=f'Datei hat {length} Zeilen')
            elif in_diff:
                info = diff[in_diff]
                ranges = info['new'] + info['old']
                if text is None and not info['deleted'] and work is not None:
                    entry.update(result='unknown_file', detail='Datei steht im Diff, fehlt aber im Arbeitsordner')
                elif near(ranges, first, last):
                    entry.update(result='in_diff', resolved=in_diff)
                else:
                    entry.update(result='outside_diff', resolved=in_diff,
                                 detail='Zeile liegt in keinem Abschnitt des Diffs, der Prüfer konnte sie nicht sehen')
            else:
                entry.update(result='not_in_diff', resolved=in_work, detail='Datei ist nicht Teil der Änderung')
            found.append((entry, text))
            if entry['cite'] not in seen:
                seen.add(entry['cite'])
                citations.append(entry)
        if not found:
            continue
        for span in re.findall(r'`([^`\n]+)`', line):
            snippet = squash(span)
            if len(snippet) < MIN_QUOTE or CITATION.fullmatch(snippet) or snippet in seen:
                continue
            seen.add(snippet)
            ok = snippet in corpus or any(t is not None and snippet in squash(t) for _, t in found)
            quotes.append({'quote': snippet, 'found': ok})

    count = lambda *kinds: sum(1 for c in citations if c['result'] in kinds)
    wrong = count('unknown_file', 'bad_line')
    status = 'invalid' if wrong else 'grounded' if count('in_diff') else 'ungrounded'
    m = re.search(r'VERDICT:\s*(ACCEPTED|CHANGES_REQUESTED|REJECTED)', verdict)
    return {
        'status': status,
        'verdict': m[1] if m else None,
        'acceptedUnproven': bool(m and m[1] == 'ACCEPTED' and status != 'grounded'),
        'citations': {'total': len(citations), 'inDiff': count('in_diff'), 'outsideDiff': count('outside_diff'),
                      'notInDiff': count('not_in_diff'), 'wrong': wrong},
        'quotes': {'checked': len(quotes), 'missing': sum(1 for q in quotes if not q['found'])},
        'details': [c for c in citations if c['result'] != 'in_diff'],
        'missingQuotes': [q['quote'] for q in quotes if not q['found']],
        'workChecked': work is not None,
        'binding': binding(bundle, current_bundle),
    }


def note(result):
    c, q = result['citations'], result['quotes']
    label = {'grounded': 'belegt', 'ungrounded': 'nicht belegt', 'invalid': 'fehlerhaft'}[result['status']]
    out = [
        '--- Zitatprüfung (automatisch, ohne Modell) ---',
        f"grounding: {result['status']} ({label})",
        f"Fundstellen: {c['total']}, davon im Diff {c['inDiff']}, außerhalb des Diffs {c['outsideDiff'] + c['notInDiff']}, falsch {c['wrong']}",
    ]
    for d in result['details']:
        kind = 'falsch' if d['result'] in ('unknown_file', 'bad_line') else 'Hinweis'
        out.append(f"- {kind}: {d['cite']} ({d['detail']})")
    if q['checked']:
        out.append(f"Zitate: {q['checked']} geprüft, {q['missing']} nicht gefunden")
        out += [f'- Hinweis: Zitat nicht gefunden: `{s}`' for s in result['missingQuotes']]
    if result['status'] == 'invalid':
        out.append('Das Verdict nennt Stellen, die es nicht gibt. Es gilt als nicht verlässlich; die Prüfung wiederholen oder selbst nachsehen.')
    elif result['acceptedUnproven']:
        out.append('ACCEPTED ohne Fundstelle im Diff: Die Abnahme ist nicht belegt und gilt als nicht geprüft.')
    b = result['binding']
    out.append(f"Geprüfter Stand: Änderung sha256 {b['changeSha256'][:12]} (Bündel {b['bundleSha256'][:12]})")
    if b['current'] is False:
        out.append(f"ACHTUNG: Der Arbeitsordner hat sich seit dem Bau des Bündels geändert (jetzt {b['currentChangeSha256'][:12]}). "
                   'Das Verdict gilt für den älteren Stand, nicht für den jetzigen.')
    return '\n'.join(out) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('verdict')
    ap.add_argument('bundle')
    ap.add_argument('--work')
    ap.add_argument('--json', dest='json_out')
    ap.add_argument('--current-bundle')
    args = ap.parse_args()
    try:
        verdict = Path(args.verdict).read_text(encoding='utf-8', errors='replace')
        bundle = Path(args.bundle).read_text(encoding='utf-8', errors='replace')
    except OSError as e:
        print(f'verdict-grounding: {e}', file=sys.stderr)
        return 2
    work = args.work if args.work and Path(args.work).is_dir() else None
    current = None
    if args.current_bundle:
        try:
            current = Path(args.current_bundle).read_text(encoding='utf-8', errors='replace')
        except OSError as e:
            print(f'verdict-grounding: {e}', file=sys.stderr)
            return 2
    result = check(verdict, bundle, work, current)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    sys.stdout.write(note(result))
    return 0


if __name__ == '__main__':
    sys.exit(main())
