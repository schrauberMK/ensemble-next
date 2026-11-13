# Troubleshooting and runtime files

## Troubleshooting

Work through these in order before reporting a failure to the user.

| Symptom | Action |
|---|---|
| Team died within a minute | `cat /tmp/ensemble-next/$TEAM_ID/postcheck.log`, it names the broken agent |
| Agents visible but `messages.jsonl` stays empty | `"$ES/collab-rescue.sh" "$TEAM_ID"`, re-injects the prompts the service failed to deliver |
| Launch aborted before creating a team | Preflight printed the fix command; run it, then relaunch |
| Not sure what is still running | `"$ES/collab-status.sh"` |
| `/tmp` filling up with old runs | `"$ES/collab-cleanup.sh"` (dry-run), then `--force` |
| Want to review a finished session | `"$ES/collab-replay.sh" "$TEAM_ID"`, or open the auto-generated HTML replay |

Preflight exit codes and the postcheck are described in `launch-options.md`.

## Runtime files

All collab artifacts live in `/tmp/ensemble-next/<TEAM_ID>/`:
- `messages.jsonl` — agent + ensemble message log
- `summary.txt` — written on disband by ensemble-service
- `bridge.pid`, `bridge.log` — bridge process
- `poller.pid`, `feed.txt` — background poller
- `postcheck.log`: output of the automatic post-spawn health check
- `prompts/`, `delivery/` — agent prompt/delivery files
- `.finished` — written by ensemble-service AFTER summary.txt
- `review/` — blind Codex review, started on disband when the last RETURN says `READY_FOR_REVIEW`
  (skipped with `COLLAB_AUTO_REVIEW=0`): `started` (before `.finished`), `verdict.txt` or
  `error.txt`, `.done` last. Takes 1–3 minutes after the team ends.
- `team-id` — team ID marker
- `sessions`: this team's tmux session names, one per line, written by ensemble-service on
  every successful agent spawn; what postcheck and rescue use to only touch this team's panes

## Internals worth knowing

- Multiple collabs can run simultaneously — each has own `/tmp/ensemble-next/<TEAM_ID>/` namespace
- `team-say.sh` uses `fcntl.flock` for atomic JSONL writes
- `ensemble-bridge.sh` has single-instance guard, health check, exponential backoff
- `.finished` and `summary.txt` are written by ensemble-service, NOT by scripts
- Bridge auto-stops when it sees `.finished` marker
