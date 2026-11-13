"""Shared helpers for the Paket-3 bench: usage from Claude and Codex logs, team data.

Only reads. Every location can be overridden by environment, which the tests use:
  CLAUDE_PROJECTS_DIR   default ~/.claude/projects
  CODEX_SESSIONS_DIR    default ~/.codex/sessions
  ENSEMBLE_NEXT_RUNTIME default /tmp/ensemble-next
  ENSEMBLE_NEXT_DATA    default ~/.ensemble-next
"""
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

USAGE_KEYS = ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens')
RETURN_RE = re.compile(r'status\s*[:=]?\s*\**\s*(READY_FOR_REVIEW|BLOCKED|NEEDS_DECISION)', re.I)
HOOK_BLOCK_RE = re.compile(r'Abschlusscheck (FAIL|INCOMPLETE) \(Versuch')


def env_path(name, default):
    return Path(os.environ.get(name) or os.path.expanduser(default))


def claude_projects_dir():
    return env_path('CLAUDE_PROJECTS_DIR', '~/.claude/projects')


def codex_sessions_dir():
    return env_path('CODEX_SESSIONS_DIR', '~/.codex/sessions')


def runtime_dir():
    return env_path('ENSEMBLE_NEXT_RUNTIME', '/tmp/ensemble-next')


def data_dir():
    return env_path('ENSEMBLE_NEXT_DATA', '~/.ensemble-next')


def parse_ts(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def read_jsonl(path):
    out = []
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        pass
    return out


def claude_project_dir(cwd):
    """Claude Code stores a session under its cwd with every non-alphanumeric char as '-'."""
    return claude_projects_dir() / re.sub(r'[^A-Za-z0-9]', '-', str(cwd))


def claude_usage(cwd, since=None):
    """Token usage of all Claude sessions in cwd since `since`, each API message counted once.

    Subagent transcripts live in the same project dir (also in subfolders) and are included.
    Returns totals, models, session ids, sidechain message count and Stop-hook blocks.
    """
    since_dt = parse_ts(since)
    root = claude_project_dir(cwd)
    by_id = {}
    models, sessions = set(), set()
    sidechain = 0
    hook_blocks = 0
    for file in sorted(root.rglob('*.jsonl')) if root.exists() else []:
        for rec in read_jsonl(file):
            ts = parse_ts(rec.get('timestamp'))
            if since_dt and ts and ts < since_dt:
                continue
            # A blocked stop leaves one stop_hook_summary record carrying the hook's reason.
            if rec.get('type') == 'system' and rec.get('subtype') == 'stop_hook_summary' \
                    and HOOK_BLOCK_RE.search(json.dumps(rec, ensure_ascii=False)):
                hook_blocks += 1
            msg = rec.get('message') or {}
            usage = msg.get('usage')
            if rec.get('type') != 'assistant' or not usage:
                continue
            key = msg.get('id') or f"{file.name}:{rec.get('uuid')}"
            by_id[key] = usage
            if msg.get('model'):
                models.add(msg['model'])
            if rec.get('sessionId'):
                sessions.add(rec['sessionId'])
            if rec.get('isSidechain'):
                sidechain += 1
    totals = {k: 0 for k in USAGE_KEYS}
    for usage in by_id.values():
        for k in USAGE_KEYS:
            v = usage.get(k)
            if isinstance(v, (int, float)):
                totals[k] += v
    totals['total'] = sum(totals[k] for k in USAGE_KEYS)
    return {
        'messages': len(by_id), 'tokens': totals, 'models': sorted(models),
        'sessions': sorted(sessions), 'sidechainMessages': sidechain, 'hookBlocks': hook_blocks,
        'projectDir': str(root),
    }


USAGE_FIELDS = ('input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens')


def codex_rollouts(cwd=None, since=None):
    """Codex usage per (rollout file, working dir), optionally filtered by cwd and time.

    The header (session_meta) is not reliable: Codex can carry on in the session of the
    preflight probe, so a lead's work lands in a file whose header names another cwd.
    Usage is therefore split by turn: total_token_usage is cumulative, and each increase
    is booked on the cwd of the turn_context in force at that moment.
    """
    since_dt = parse_ts(since)
    want = os.path.realpath(str(cwd)) if cwd else None
    out = []
    root = codex_sessions_dir()
    for file in sorted(root.rglob('rollout-*.jsonl')) if root.exists() else []:
        if since_dt and datetime.fromtimestamp(file.stat().st_mtime, timezone.utc) < since_dt:
            continue
        meta, cur_cwd, model, prev, limits = None, None, None, {}, None
        segments = {}
        for rec in read_jsonl(file):
            payload = rec.get('payload') or {}
            ts = parse_ts(rec.get('timestamp'))
            if rec.get('type') == 'session_meta' and meta is None:
                meta = payload
                cur_cwd = payload.get('cwd')
                ts = ts or parse_ts(payload.get('timestamp'))
                continue
            if rec.get('type') == 'turn_context':
                cur_cwd = payload.get('cwd') or cur_cwd
                model = payload.get('model') or model
                continue
            if payload.get('type') != 'token_count':
                continue
            if payload.get('rate_limits'):
                limits = payload['rate_limits']
            total = (payload.get('info') or {}).get('total_token_usage')
            if not total:
                continue
            delta = {k: (total.get(k) or 0) - (prev.get(k) or 0) for k in USAGE_FIELDS}
            prev = total
            when = ts or parse_ts((meta or {}).get('timestamp'))
            if since_dt and when and when < since_dt:
                continue
            seg = segments.setdefault(os.path.realpath(cur_cwd or ''), {'cwd': cur_cwd, 'model': model, 'usage': {k: 0 for k in USAGE_FIELDS}, 'firstAt': rec.get('timestamp')})
            seg['model'] = model or seg['model']
            for k in USAGE_FIELDS:
                seg['usage'][k] += max(delta[k], 0)
        for real, seg in segments.items():
            if want and real != want:
                continue
            out.append({
                'file': str(file), 'originator': (meta or {}).get('originator'), 'headerCwd': (meta or {}).get('cwd'),
                'cwd': seg['cwd'], 'startedAt': seg['firstAt'], 'model': seg['model'], 'usage': seg['usage'],
                'rateLimits': limits,
            })
    return out


def codex_limits_now():
    """Rate-limit snapshot from the newest rollout file, or None."""
    root = codex_sessions_dir()
    files = sorted(root.rglob('rollout-*.jsonl'), key=lambda f: f.stat().st_mtime) if root.exists() else []
    for file in reversed(files[-20:]):
        limits = None
        for rec in read_jsonl(file):
            payload = rec.get('payload') or {}
            if payload.get('type') == 'token_count' and payload.get('rate_limits'):
                limits = payload['rate_limits']
        if limits:
            primary = limits.get('primary') or {}
            secondary = limits.get('secondary') or {}
            resets = primary.get('resets_at')
            # The snapshot is only as fresh as the last Codex turn; after the window reset it is stale.
            stale = isinstance(resets, (int, float)) and resets < datetime.now(timezone.utc).timestamp()
            return {'primaryUsedPercent': primary.get('used_percent'), 'secondaryUsedPercent': secondary.get('used_percent'),
                    'primaryResetsAt': resets, 'stale': stale, 'planType': limits.get('plan_type'), 'source': str(file)}
    return None


def team_record(team_id):
    try:
        teams = json.loads((data_dir() / 'ensemble' / 'teams.json').read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return None
    if isinstance(teams, dict):
        teams = teams.get('teams', [])
    return next((t for t in teams if t.get('id') == team_id), None)


def latest_verify_record(team_name):
    """Latest verify-on-stop record of any claude agent of this team."""
    best = None
    vdir = runtime_dir() / 'verify'
    for file in vdir.glob('*.json') if vdir.exists() else []:
        try:
            rec = json.loads(file.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError):
            continue
        session = rec.get('tmuxSession') or ''
        if not session.startswith(f'{team_name}-claude'):
            continue
        if best is None or (rec.get('checkedAt') or '') > (best.get('checkedAt') or ''):
            best = rec
    return best


def return_status(text):
    m = RETURN_RE.search(text or '')
    return m.group(1).upper() if m else None


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'codex-limits':
        print(json.dumps(codex_limits_now()))
    elif cmd == 'verify-record' and len(sys.argv) == 3:
        rec = latest_verify_record(sys.argv[2])
        print(rec['file'] if rec and rec.get('file') else '')
    else:
        print('usage: common.py codex-limits | verify-record <team-name>', file=sys.stderr)
        sys.exit(2)
