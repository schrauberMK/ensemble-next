#!/usr/bin/env python3
"""reviewer-args — Extra `codex exec` arguments that start the blind reviewer without the user's
MCP servers, plugins, apps and memories. Prints one argument per line; nothing when switched off.

Usage: reviewer-args.py [--json]

Why: the reviewer only has to read a bundle and answer. With the user's config it also got every
MCP server and plugin of the Codex installation (probe 13.11.2026: 405 MCP tools, about 15.4k
tokens before the first word of the prompt; without them 0 tools and about 8.8k). That costs
tokens on every review and makes the review depend on whatever is installed that day.

How: `--ignore-user-config` skips $CODEX_HOME/config.toml (auth stays), `--ignore-rules` skips
execpolicy rules, apps and memories are switched off. Ignoring the config would also drop the
user's model choice, so `model` and `model_reasoning_effort` are read from the config and passed
on explicitly. COLLAB_REVIEW_MODEL / COLLAB_REVIEW_EFFORT override them.

COLLAB_REVIEW_ISOLATED=0 switches all of this off (plain `codex exec` as before).

Limit: the global $CODEX_HOME/AGENTS.md is still loaded; `-c project_doc_max_bytes=0` did not
remove it in codex-cli 0.167.1.

--json prints {"isolated": bool, "model": ..., "effort": ..., "args": [...]} instead.
"""
import json
import os
import sys
from pathlib import Path

try:
    import tomllib
except ImportError:  # Python < 3.11
    tomllib = None


def user_config():
    home = Path(os.environ.get('CODEX_HOME') or Path.home() / '.codex')
    if tomllib is None:
        return {}
    try:
        with open(home / 'config.toml', 'rb') as f:
            return tomllib.load(f)
    except (OSError, ValueError):
        return {}


def plain(value):
    """A model or effort name safe to pass on: letters, digits, dot, dash, underscore."""
    value = str(value or '').strip()
    return value if value and all(c.isalnum() or c in '._-' for c in value) else ''


def build():
    if os.environ.get('COLLAB_REVIEW_ISOLATED', '1').strip() == '0':
        return {'isolated': False, 'model': None, 'effort': None, 'args': []}
    config = user_config()
    model = plain(os.environ.get('COLLAB_REVIEW_MODEL') or config.get('model'))
    effort = plain(os.environ.get('COLLAB_REVIEW_EFFORT') or config.get('model_reasoning_effort'))
    args = ['--ignore-user-config', '--ignore-rules', '--disable', 'apps', '--disable', 'memories']
    if model:
        args += ['-m', model]
    if effort:
        args += ['-c', f'model_reasoning_effort="{effort}"']
    return {'isolated': True, 'model': model or None, 'effort': effort or None, 'args': args}


def main():
    result = build()
    if '--json' in sys.argv[1:]:
        print(json.dumps(result))
    else:
        for arg in result['args']:
            print(arg)
    return 0


if __name__ == '__main__':
    sys.exit(main())
