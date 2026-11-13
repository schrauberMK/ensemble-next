---
name: collab-next
description: Start the EXPERIMENTAL ensemble-next collab team (separate install on port 23100, runtime /tmp/ensemble-next). Use only when the user explicitly says "collab-next", "/collab-next" or "ensemble-next". For the regular team use /collab.
allowed-tools: Bash, Read, Write, Agent, TaskOutput
metadata:
  author: michel
  version: 6.3.0
---

# Collab-next: Autonomous AI Team Collaboration (ensemble-next, experimental)

**Language rule:** ALWAYS respond in the same language the user used to invoke /collab. If the user writes in English, all your output (status updates, summaries, everything) must be in English. If Dutch, respond in Dutch. Never mix languages.

For a single review, a team is often overkill; use single-agent delegation if available.

Launch an ensemble-next team (default: Claude Code alone, then a blind Codex review). Runtime files are namespaced under `/tmp/ensemble-next/<TEAM_ID>/`.

## Reference files

Read one only when its situation comes up:

| File | Read when |
|---|---|
| `references/launch-options.md` | the user names agents (agy, grok, codex as lead, …) or a template, or preflight/launch exits non-zero |
| `references/monitoring.md` | after launch, for the poll/watch/cleanup steps of the detected monitor mode |
| `references/troubleshooting.md` | a team dies, stays silent, or you need the runtime file layout |
| `references/external-brain.md` | roster/plan/event hooks, stalled-agent replacement, `COLLAB_WORKTREE=team` |

## Script Paths

Every script lives in `__ENSEMBLE_DIR__/scripts/` and MUST be called with its full path and
`.sh` extension. They are not on `$PATH`, and the permission allowlist installed by
`setup-claude-code.sh` only covers the full paths. Calling a bare `collab-launch` fails.

Set this once per session and reuse it:

```bash
ES="__ENSEMBLE_DIR__/scripts"
```

| Script | Purpose |
|---|---|
| `collab-launch.sh` | Start a team (runs preflight, opens the monitor, arms postcheck) |
| `collab-poll.sh` | Single-shot message poll with seen-state tracking |
| `collab-status.sh` | Dashboard of active and recent collabs |
| `collab-rescue.sh` | Re-inject prompts when `messages.jsonl` stays empty |
| `collab-replay.sh` | Replay a finished session in the terminal |
| `collab-livefeed.sh` | Live colored feed (non-tmux) |
| `collab-cleanup.sh` | Remove old finished runtime dirs (dry-run by default) |
| `open-herdr-monitor.sh` | Open the monitor in a herdr pane, called by launch |
| `collab-preflight.sh` | Auth/DNS/service checks, auto-run by launch |
| `collab-postcheck.sh` | Agent health check ~30s after spawn, auto-armed by launch |

## Workflow

### Step 0: Detect environment
```bash
if [ "${HERDR_ENV:-}" = "1" ]; then
  echo "HERDR"
elif [ -n "$TMUX" ]; then
  echo "TMUX_YES"
elif [ "$(uname)" = "Darwin" ] && [ "${TERM_PROGRAM:-}" = "iTerm.app" ]; then
  echo "ITERM_NATIVE"
else
  echo "TMUX_NO"
fi
```

Four monitor modes:
- `HERDR` — inside a herdr workspace; `collab-launch.sh` asks herdr for the split
- `TMUX_YES` — already inside tmux; `collab-launch.sh` opens a split pane right
- `ITERM_NATIVE` — macOS iTerm2 without tmux; `collab-launch.sh` uses `osascript` to open a native iTerm split pane (no `tmux attach` needed)
- `TMUX_NO` — fallback: detached tmux session the user must attach to

**Check `HERDR_ENV` first, and never conclude "iTerm" from `TERM_PROGRAM` alone.**
herdr owns the terminal and draws its own panes inside a host session, but passes
`TERM_PROGRAM=iTerm.app` straight through. An AppleScript split then opens a real iTerm
pane outside the layout the user is watching: it succeeds, reports success, and is never
seen. `HERDR_ENV=1` is the reliable signal (`HERDR_PANE_ID`, `HERDR_TAB_ID` and
`HERDR_WORKSPACE_ID` name the exact pane).

Force a specific mode with `COLLAB_MONITOR=herdr|tmux|iterm|none`, change the herdr layout
with `COLLAB_HERDR_MODE=split|tab`, or the iTerm layout with
`COLLAB_ITERM_MODE=split|tab|window` (both default `split`).

### Step 1: Launch the team
```bash
"$ES/collab-launch.sh" "$(pwd)" "$TASK_DESCRIPTION" [AGENTS] [TEMPLATE]
```

Pass the whole task in `$TASK_DESCRIPTION`. Leave `[AGENTS]` and `[TEMPLATE]` empty unless the
user explicitly names agents or the task clearly matches a template; then read
`references/launch-options.md` first.
Available keys: `codex`, `claude`, `grok`, `agy`, `gemini`, `glm`, `opencode` (all defined in `agents.json`).
Templates: `review`, `implement`, `research`, `debug`.

**Extract TEAM_ID** from the launch output (last line is `TEAM_ID=<id>`):
```bash
TEAM_ID=$(printf '%s\n' "$LAUNCH_OUTPUT" | sed -n 's/^TEAM_ID=//p' | tail -1)
```
Do not read `/tmp/collab-next-team-id.txt` unless you have no launch output: it is a single
global file that a concurrent collab overwrites.

**Check that the launch actually succeeded** before doing Step 2. `collab-launch.sh` can fail
after the team already exists: exit `3` means a team was created but no message was exchanged
within the wait window, exit `4` means the bridge or poller died right after starting. Both
print a `TEAM_ID=` trailer anyway, but neither one printed `Team is live!`. Only tell the user
the team is live when that exact line is in the output. On exit `3`, run
`"$ES/collab-rescue.sh" "$TEAM_ID"` before saying anything is running.

Preflight (before) and postcheck (~25s after spawn) run automatically; do not re-run them.
A non-zero preflight exit printed its fix command; exit codes are in `references/launch-options.md`.

### Step 2: Tell the user where the monitor is

- `HERDR`: "Team is live in the new herdr pane on the right."
- `TMUX_YES`: "Team is live in the right tmux pane."
- `ITERM_NATIVE`: "Team is live in the new iTerm pane on the right."
- `TMUX_NO`: "`tmux attach -t ensemble-$TEAM_ID` — live TUI monitor (steer, disband, scroll)"

### Step 3: Monitoring — the user MUST see the conversation

**CRITICAL RULE**: The user wants to SEE the team's conversation as it happens.

- `TMUX_NO`: poll inline with `collab-poll.sh` and present every new message as a readable
  dialogue (bold agent names, full content up to 500 chars).
- `TMUX_YES`, `HERDR`, `ITERM_NATIVE`: the monitor pane is visible; wait in the background for
  `.finished`, then present the summary.

In every mode, after the summary show the blind review verdict when `review/started` exists.
`CHANGES_REQUESTED`/`REJECTED` go to the user with their findings, never quietly fixed. Then clean up.
The exact poll command, cadence, background watcher snippet and per-mode cleanup are in
`references/monitoring.md`; read it before Step 3.

## How a team ends

Auto-disband triggers on one of two paths:

1. **Explicit sentinel (preferred).** EVERY active agent sends a team-say whose entire content
   is `<<COLLAB_DONE>>`. This bypasses the message-count minimum and the idle wait. The agent
   prompts already instruct this. The bar is every agent, not two, so a third agent is never
   cut off while its teammates close up.
2. **Idle + completion signals.** A safety net for teams that go quiet without sending the
   sentinel: it needs a minimum number of exchanged messages AND at least 60s of silence.

Ordinary words like "done" or "klaar" in a status update do not kill a team while the
conversation is running. Do not warn agents to avoid those words.

## When something fails

Use `references/troubleshooting.md` (symptom → action table) before reporting a failure.

**Escalation.** Two failed rescue or relaunch attempts on the same task is the limit. Stop,
report to the user what was tried, what the logs said (`postcheck.log`, `bridge.log`,
`/tmp/ensemble-next-server.log`), and ask how to proceed. Never keep relaunching a team that
fails the same way. Each retry spawns real CLI sessions and burns real tokens.

## Important Notes
- Agents run with auto-accept permissions (configured in agents.json: codex `--dangerously-bypass-approvals-and-sandbox`, claude `--permission-mode auto`). They should NEVER ask for file write approval.
- Do not modify project code during a collab session unless the user explicitly asks
- Do not truncate or remove `messages.jsonl`
