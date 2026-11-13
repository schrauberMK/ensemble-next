# Monitoring and cleanup per monitor mode

Read the section for the mode Step 0 detected.

## `TMUX_NO`: poll and PRESENT messages inline

Use `collab-poll.sh` — a single-shot poller that tracks state automatically and gives clean output.

**Poll command:**
```bash
"$ES/collab-poll.sh" "$TEAM_ID" --sleep <seconds>
```

Output format: `sender\tcontent` lines, ending with one of:
- `---STATUS:ACTIVE` — new messages were found
- `---STATUS:QUIET` — no new messages (agents in deep work)
- `---STATUS:DONE` — team finished, followed by summary.txt content
- `---STATUS:WAITING` — messages file not yet created

**Presentation rules — THIS IS THE KEY PART:**
After each poll, present the new messages to the user like this:

> **codex-1**: [message content]
>
> **claude-2**: [message content]

Use markdown bold for agent names. Show the FULL message content (up to 500 chars), not truncated summaries. Between polls, add a brief status line like "Team is working... next check in 15s."

**Polling cadence:**
- First poll: `--sleep 10`
- Normal: `--sleep 15` to `--sleep 20`
- If 3+ polls QUIET: `--sleep 30` (agents in deep work)
- On `---STATUS:DONE`: stop polling, present final summary

**When done**, present structured summary, then the blind review: if `$RD/review/started` exists, wait
for `$RD/review/.done` (up to 15 min) and show `verdict.txt` (or `error.txt`). The review is the
acceptance check of the default claude-alone run; `CHANGES_REQUESTED`/`REJECTED` go to the user
with their findings, never quietly fixed. Then clean up:
```bash
TEAM_ID="<id>" && RD="/tmp/ensemble-next/$TEAM_ID" && kill "$(cat "$RD/poller.pid" 2>/dev/null)" 2>/dev/null || true; kill "$(cat "$RD/bridge.pid" 2>/dev/null)" 2>/dev/null || true; tmux kill-session -t "ensemble-$TEAM_ID" 2>/dev/null || true
```

## `TMUX_YES`: background summary watcher

Monitor visible in right pane. Wait in background:
```bash
TEAM_ID="<id>" && RD="/tmp/ensemble-next/$TEAM_ID" && while [ ! -f "$RD/.finished" ]; do sleep 8; done && echo "COLLAB_COMPLETE" && cat "$RD/summary.txt" 2>/dev/null; if [ -f "$RD/review/started" ]; then for _ in $(seq 1 90); do [ -f "$RD/review/.done" ] && break; sleep 10; done; echo "BLIND_REVIEW"; cat "$RD/review/verdict.txt" 2>/dev/null || cat "$RD/review/error.txt" 2>/dev/null || echo "review still running: $RD/review"; fi
```
Run with `run_in_background: true`, `timeout: 600000`.

When done: summarize + cleanup poller/bridge PIDs.

## `HERDR`: background summary watcher

Same as `TMUX_YES`: the monitor pane is visible to the user, so don't inline-poll. Wait for
completion in the background and present the final summary. The monitor closes its own herdr
pane on exit (pane id in `/tmp/ensemble-next/<TEAM_ID>/herdr-pane-id`), so no `tmux kill-session`.

## `ITERM_NATIVE`: background summary watcher

Same as `TMUX_YES`: the monitor pane is visible to the user, so don't inline-poll. Wait for completion in the background (same snippet as `TMUX_YES`) and present the final summary when done. On cleanup, the iTerm pane lives on — the user closes it with `q` or Cmd+W. Do NOT try to `tmux kill-session` (no tmux session exists in this mode).
