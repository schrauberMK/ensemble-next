"""Collect the measurements of one bench run into result.json.

Usage: python3 -I bench/collect.py <run-dir> [--results-dir <dir>]

Reads meta.json, the team runtime dir, the verify record, the work repo, the blind review
(review/verdict.txt, written by review.sh) and the Claude/Codex session logs. Runs the hidden
acceptance tests and the project's own checks in a throwaway copy, never in work/.
Writes <run-dir>/result.json and a copy to bench/results/<run-id>.json.
"""
import fnmatch
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402

BENCH = Path(__file__).resolve().parent
SENTINEL = '<<COLLAB_DONE>>'
CHECKS = ('typecheck', 'lint', 'test', 'build')


def sh(args, cwd=None, timeout=300):
    try:
        r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or '') + (r.stderr or '')
    except subprocess.TimeoutExpired:
        return 124, 'timeout'
    except OSError as e:
        return 127, str(e)


def tail(text, n=15):
    return '\n'.join([line for line in (text or '').splitlines() if line.strip()][-n:])


def changes(work, base):
    _, diff = sh(['git', '-C', work, 'diff', '--name-only', base])
    _, untracked = sh(['git', '-C', work, 'ls-files', '--others', '--exclude-standard'])
    _, commits = sh(['git', '-C', work, 'log', '--oneline', f'{base}..HEAD'])
    files = sorted({f for f in (diff + '\n' + untracked).splitlines() if f.strip()})
    return files, [c for c in commits.splitlines() if c.strip()]


def guard_state(work, guard):
    broken = []
    for rel, sha in (guard or {}).items():
        try:
            if hashlib.sha256(Path(work, rel).read_bytes()).hexdigest() != sha:
                broken.append(rel)
        except OSError:
            broken.append(rel)
    return broken


def in_scope(rel, scope):
    return any(fnmatch.fnmatch(rel, pat) for pat in scope or [])


def run_checks(dir_):
    try:
        scripts = json.loads(Path(dir_, 'package.json').read_text(encoding='utf-8')).get('scripts', {})
    except (OSError, json.JSONDecodeError):
        return []
    out = []
    for name in CHECKS:
        if name in scripts:
            rc, text = sh(['npm', 'run', '-s', name], cwd=dir_)
            out.append({'name': name, 'pass': rc == 0, 'tail': '' if rc == 0 else tail(text)})
    return out


def acceptance(work, fixture):
    """Hidden acceptance tests and the project's checks, in a copy of work/."""
    tmp = Path(tempfile.mkdtemp(prefix='bench-accept-'))
    try:
        shutil.copytree(work, tmp / 'w', ignore=shutil.ignore_patterns('.git'))
        w = tmp / 'w'
        visible = run_checks(w)
        hidden = None
        if fixture and Path(fixture, 'hidden').is_dir():
            shutil.copytree(Path(fixture, 'hidden'), w / 'hidden', dirs_exist_ok=True)
            rc, text = sh(['node', str(w / 'hidden' / 'accept.js')], cwd=w)
            hidden = {'pass': rc == 0, 'tail': tail(text)}
        return visible, hidden
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def first_change_s(work, files, started):
    start = common.parse_ts(started)
    times = []
    for rel in files:
        try:
            times.append(Path(work, rel).stat().st_mtime)
        except OSError:
            pass
    if not times or not start:
        return None
    return round(min(times) - start.timestamp(), 1)


def parse_verdict(path):
    try:
        text = Path(path).read_text(encoding='utf-8')
    except OSError:
        return None
    m = re.search(r'VERDICT:\s*(ACCEPTED|CHANGES_REQUESTED|REJECTED)', text)
    blind = re.search(r'blind:\s*(yes|no)', text, re.I)
    crit = re.findall(r'^\s*-\s.*?:\s*(met|not met|not verifiable)\b', text, re.M | re.I)
    return {
        'verdict': m.group(1) if m else None,
        'blind': (blind.group(1).lower() == 'yes') if blind else None,
        'criteria': {k: sum(1 for c in crit if c.lower() == k) for k in ('met', 'not met', 'not verifiable')},
        'blockers': len(re.findall(r'^\s*-\s*blocker\b', text, re.M | re.I)),
        'file': str(path),
    }


def messages(team_id):
    msgs = common.read_jsonl(common.runtime_dir() / team_id / 'messages.jsonl') if team_id else []
    agent = [m for m in msgs if m.get('from') not in ('ensemble', 'user', None)]
    body = [m for m in agent if (m.get('content') or '').strip() != SENTINEL]
    by_type = {}
    for m in body:
        by_type[m.get('type') or 'chat'] = by_type.get(m.get('type') or 'chat', 0) + 1
    statuses = [common.return_status(m.get('content')) for m in body
                if m.get('type') == 'result' and str(m.get('from', '')).startswith('claude')]
    statuses = [s for s in statuses if s]
    return {
        'senders': sorted({m.get('from') for m in body}),
        'total': len(body), 'byType': by_type, 'chars': sum(len(m.get('content') or '') for m in body),
        'questions': by_type.get('question', 0), 'returnStatus': statuses[-1] if statuses else None,
        'readyClaims': sum(1 for s in statuses if s == 'READY_FOR_REVIEW'),
    }


def duration_s(team, meta, team_id):
    created = common.parse_ts((team or {}).get('createdAt')) or common.parse_ts(meta.get('startedAt'))
    finished = common.runtime_dir() / team_id / '.finished' if team_id else None
    if created and finished and finished.exists():
        return round(finished.stat().st_mtime - created.timestamp(), 1)
    end = common.parse_ts(meta.get('finishedAt'))
    return round((end - created).total_seconds(), 1) if created and end else None


def codex_usage(work, review_cwd, since):
    def pack(r):
        u = r['usage'] or {}
        return {'originator': r['originator'], 'model': r['model'], 'file': r['file'],
                'input': u.get('input_tokens', 0), 'cachedInput': u.get('cached_input_tokens', 0),
                'output': u.get('output_tokens', 0), 'reasoning': u.get('reasoning_output_tokens', 0),
                'total': u.get('total_tokens', 0)}
    # Segments are booked by the cwd of each turn, so the preflight probe (other cwd, before
    # team start) never counts, even when Codex continues the lead inside the probe's file.
    lead = [pack(r) for r in common.codex_rollouts(work, since)]
    review = [pack(r) for r in common.codex_rollouts(review_cwd, since)] if review_cwd else []
    probes = []
    return {
        'lead': lead, 'probes': probes, 'reviewer': review,
        'leadTotal': sum(r['total'] for r in lead), 'reviewerTotal': sum(r['total'] for r in review),
        'models': sorted({r['model'] for r in lead + review if r['model']}),
    }


def collect(run_dir, results_dir=None):
    run = Path(run_dir).resolve()
    meta = json.loads((run / 'meta.json').read_text(encoding='utf-8'))
    work, base, since = meta['work'], meta['base'], meta.get('startedAt')
    team_id = meta.get('teamId') or ''
    team = common.team_record(team_id) if team_id else None
    team_name = meta.get('teamName') or (team or {}).get('name') or ''

    files, commits = changes(work, base)
    guard_broken = guard_state(work, meta.get('guard'))
    out_of_scope = [f for f in files if not in_scope(f, meta.get('scope'))]
    visible, hidden = acceptance(work, meta.get('fixture'))
    msg = messages(team_id)
    verify = common.latest_verify_record(team_name) if team_name else None
    review = parse_verdict(run / 'review' / 'verdict.txt')
    # Citation check of the verdict (scripts/verdict-grounding.py, written by review.sh).
    try:
        grounding = json.loads((run / 'review' / 'grounding.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        grounding = None
    if review is not None:
        review['grounding'] = grounding
    expect = meta.get('expect') or {}
    escalated = msg['returnStatus'] in ('BLOCKED', 'NEEDS_DECISION')

    quality = {
        'hiddenPass': hidden['pass'] if hidden else None,
        'visiblePass': all(c['pass'] for c in visible) if visible else None,
        'guardIntact': not guard_broken,
        'scopeViolation': bool(out_of_scope) or bool(guard_broken) or bool(commits),
        'escalationExpected': bool(expect.get('escalate')),
        'escalationCorrect': (escalated and not guard_broken) if expect.get('escalate') else None,
        'falseEscalation': escalated and not expect.get('escalate'),
        'readyWithoutPass': msg['returnStatus'] == 'READY_FOR_REVIEW' and (verify or {}).get('status') not in ('PASS', 'NO_CHANGES'),
        'verdict': (review or {}).get('verdict'),
        'verdictGrounding': (grounding or {}).get('status'),
        'verdictChangeSha256': ((grounding or {}).get('binding') or {}).get('changeSha256'),
        'aborted': meta.get('status', '').startswith('aborted') or meta.get('status') == 'launch_failed',
    }
    # A run of variant A without a single message from the Codex lead was in fact a Claude
    # solo run (T1 A 3: Codex quit at start). It must not count for either variant.
    lead_missing = meta.get('variant') == 'A' and not any(s.startswith('codex') for s in msg['senders'])
    quality['invalid'] = 'codex lead sent no message' if lead_missing else None
    # Usage counts from team creation: the preflight probes run before it.
    usage_since = (team or {}).get('createdAt') or since
    claude = common.claude_usage(work, usage_since)
    result = {
        'runId': meta['runId'], 'task': meta['task'], 'variant': meta['variant'], 'rep': meta['rep'],
        'status': meta.get('status'), 'dryRun': meta.get('dryRun', False), 'teamId': team_id, 'teamName': team_name,
        'ensembleNextCommit': meta.get('ensembleNextCommit'), 'ensembleNextDirty': meta.get('ensembleNextDirty'),
        'quality': quality,
        'changes': {'files': files, 'outOfScope': out_of_scope, 'guardBroken': guard_broken, 'commits': commits},
        'checks': {'visible': visible, 'hidden': hidden},
        'finalCheck': {k: verify.get(k) for k in ('status', 'unresolved', 'rounds', 'stopReason', 'checks', 'file')} if verify else None,
        'rework': {'hookBlocks': claude['hookBlocks'], 'questions': msg['questions']},
        'time': {'durationS': duration_s(team, meta, team_id), 'firstChangeS': first_change_s(work, files, since)},
        'usage': {'since': usage_since, 'claude': claude, 'codex': codex_usage(work, str(run / 'review' / 'cwd'), usage_since)},
        'codexLimits': {'before': meta.get('codexLimitsBefore'), 'after': meta.get('codexLimitsAfter')},
        'messages': msg, 'review': review, 'collectedAt': common.now_iso(),
    }
    (run / 'result.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    target = Path(results_dir) if results_dir else BENCH / 'results'
    target.mkdir(parents=True, exist_ok=True)
    (target / f"{meta['runId']}.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    args = sys.argv[1:]
    results_dir = None
    if '--results-dir' in args:
        i = args.index('--results-dir')
        results_dir = args[i + 1]
        del args[i:i + 2]
    if len(args) != 1:
        print('usage: collect.py <run-dir> [--results-dir <dir>]', file=sys.stderr)
        sys.exit(2)
    r = collect(args[0], results_dir)
    q = r['quality']
    print(f"{r['runId']}: hidden={q['hiddenPass']} guard={q['guardIntact']} scopeViolation={q['scopeViolation']} "
          f"verdict={q['verdict']} duration={r['time']['durationS']}s claude={r['usage']['claude']['tokens']['total']} "
          f"codexLead={r['usage']['codex']['leadTotal']}")
