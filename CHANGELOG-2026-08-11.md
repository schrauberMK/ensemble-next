# Ensemble: changelog 11 August 2026

Theme of the day: **three-agent teams became real, and the monitor started opening where the
user is actually looking.** Most of the work was found by ensemble reviewing its own scripts in
a three-agent collab, which is also what exposed the assumptions that only ever held for a pair.

---

## Teams of three

### Grok joins the roster

`agents.json` gained a `grok` entry (`--always-approve --trust`, `pasteFromFile` input). Two
interactive gates would otherwise freeze a spawned pane: the project-directory picker, killed by
`hints = { project_picker_disabled = true }` in `~/.grok/config.toml`, and the folder-trust
dialog, killed by `--trust`. Preflight checks both and warns when the picker is still armed.

### The third agent stopped being killed

Two `grok + claude + codex` runs exposed three places that quietly assumed a pair. The first
trio was disbanded 90 seconds in, while the third agent was still measuring.

The cause was `shouldAutoDisband` treating two completion-worded messages from different agents
as immediate consent. Rule 7 of the agent prompt tells agents to *announce* closure with "I think
we're done because X", and that sentence is itself a completion pattern, so the protocol was ending
teams at the moment they proposed ending, not when they agreed. A team now disbands only when
every member has sent the exact `<<COLLAB_DONE>>` sentinel.

The launcher's steer hint follows the real roster too. A hardcoded `1/2 codex / claude` is wrong
for any team that is not the default pair, so the keys and names are read back from the created
team.

### `COLLAB_AGENTS` as the default line-up

`collab-preflight.sh` already read `COLLAB_AGENTS` to decide which CLIs to check, but
`collab-launch.sh` ignored it when picking agents, so a preferred line-up had to be retyped on
every run. It now falls back to the variable, mirroring what `TEMPLATE` does with
`COLLAB_TEMPLATE`.

Precedence: **3rd argument > `COLLAB_AGENTS` > the default pair.**

Setting the variable also disables the auto-fallback, exactly as passing the argument does.
Naming your agents means a dead one should fail loudly instead of being swapped out silently.

---

## The monitor opens where you are looking

### herdr panes

The monitor pane opened correctly, reported success, and was never seen.

[herdr](https://github.com/herdrdev/herdr) is a terminal workspace manager that owns the terminal
and draws its own panes inside a host session. It passes `TERM_PROGRAM=iTerm.app` straight
through, so auto-detect concluded "iTerm2" and asked AppleScript for a split. That split is a
real iTerm pane, created *outside* the herdr layout the user is watching.

- `open-herdr-monitor.sh` asks herdr for the split (`herdr pane split`, then `herdr pane run`)
- `HERDR_ENV` is checked **before** the iTerm branch, because `TERM_PROGRAM` cannot be trusted
  inside herdr
- `COLLAB_MONITOR=herdr` and `COLLAB_HERDR_MODE=split|tab` to override
- the pane closes itself on monitor exit, matching the existing iTerm behaviour
- the pane is labelled after the project directory (e.g. `ensemble collab`), so a workspace
  holding several monitors still says which project each one belongs to

### iTerm splits that landed on the wrong tab

An iTerm split now selects the source tab, so the pane is visible even when collab was launched
from a tab the user is not currently on.

The AppleScript heredocs were also unquoted, so the shell expanded the program text and ran the
backticks inside its comments as commands. That is where `write: text is not logged in` and
`correct: command not found` in `/tmp/ensemble-iterm.err` came from. Session id and command now
travel as `osascript` argv.

---

## Preflight tells the truth

### Codex must return a sentinel

The quota probe asked whether codex *answers*, not whether codex *works*. Its else branch
declared healthy everything that contained no quota wording, so a plain HTTP 400 scored green:

```
The 'gpt-5.6' model is not supported when using Codex with a ChatGPT account
```

Preflight cleared the run, the agent spawned, reported ready within a second, and stayed silent
for the entire session while its teammates worked around it.

The probe now demands the exact string `PROBE-OK-7391` back. Anything else marks codex dead and
prints the last lines of the real output, with hook/MCP chatter filtered out so the actual error
stays readable. Quota detection is unchanged.

### A named agent with no binary is a hard failure

The claude branch warned "Claude-2 will be disabled, codex-only mode", wrote the codex-only
override, and never set `CLAUDE_DEAD`. The explicit-agents branch then found an empty dead-list,
deleted the override it had just written, and printed *All preflight checks passed*.

Measured before the fix, with the claude binary off `PATH`:

```
$ COLLAB_AGENTS="claude" ./scripts/collab-preflight.sh ; echo $?
  ! claude binary not in PATH — Claude-2 will be disabled, codex-only mode
  All preflight checks passed
0
```

That is the one shape `COLLAB_AGENTS` support made easy to hit: the launcher would go on to spawn
an agent whose CLI does not exist. The branch now sets `CLAUDE_DEAD=1` and lets the decision block
choose, exactly like the codex and grok probes do. A run that names claude fails with exit 3; a
run that did not name its agents still falls back to codex-only, unchanged.

---

## Security fixes

Found by a three-agent collab reviewing this repo's own scripts.

`ensemble-bridge.sh` embedded `TEAM_ID`, `API`, `POSTED` and the messages path directly in the
source of an inline `python3 -c` program. A single quote anywhere in those values did not just
break a string, it broke the program:

```python
with open('/tmp/bridge it's-test/messages.jsonl') as f:
SyntaxError: unterminated string literal
```

The bridge carries every agent message to the API, so this was a silent total stall for anyone
whose path contained an apostrophe, and a code-execution shape for attacker-influenced values.
`setup-claude-code.sh` had the same pattern in both branches of its permission merge.

Both now pass values as argv inside a quoted heredoc, so the shell never expands the program
text. The bridge URL is additionally hardened with `urllib.parse.quote(team_id, safe="")`, so a
team id cannot escape its path segment.

---

## Documentation

`--full-auto` was **removed from Codex CLI in 0.147.0** and replaced by `--sandbox
workspace-write`. `agents.json` ships `--dangerously-bypass-approvals-and-sandbox`, so nothing
was broken, but `docs/configuration.md` still documented the dead flag in four places, and still
listed `--dangerously-skip-permissions` for Claude Code where `agents.json` uses
`--permission-mode auto`.

Verified against the installed CLI:

```
$ codex --version
codex-cli 0.147.0
$ codex exec --full-auto --help
error: unexpected argument '--full-auto' found
```

Also corrected across README and docs: the default team is **Codex (lead) + Claude Code
(worker)**, not the other way around; Grok, herdr, `COLLAB_AGENTS`, `COLLAB_TEMPLATE`, the
template argument and the preflight exit codes are now documented; and `collab-cleanup.sh` is
described as the dry-run-by-default runtime-directory cleaner it is, rather than something that
ends a running team.

---

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 64 passed, 4 files |
| Preflight, three agents named | passes, codex sentinel returned |
| Live three-agent collab | `codex-1 + claude-2 + grok-3`, 14 messages, converged |
| Auto-disband | all three sentinels, disbanded within 10s, tmux sessions gone |
| herdr monitor | pane `wW:p2`, label `ensemble collab`, closed itself on disband |
| Agent precedence | 3rd argument `claude,grok` beat `COLLAB_AGENTS="codex,claude,grok"` |
| Preflight, named agent missing | exit 3, no override file written |
| Preflight, unnamed agents missing | exit 0, falls back to codex-only |
