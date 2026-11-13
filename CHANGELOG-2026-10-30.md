# ensemble-next: changelog 30 October 2026 (v1.1.0)

## Default flow: Claude Code alone, then a blind Codex review

Measured in Paket 3 (16 runs, 4 tasks): Claude Code planning and implementing alone, followed by
a blind Codex review, matched the quality of Codex planning for Claude in about a third of the time
(median 57 s against 156 s). This flow is now the default.

- Without named agents a team is Claude Code alone (`collab-launch.sh`, `collab-preflight.sh`,
  `DEFAULT_AGENTS`). Naming agents, by argument or `COLLAB_AGENTS`, still builds a team.
- On disband the service starts the blind review when the last RETURN says `READY_FOR_REVIEW`
  (`lib/auto-review.ts`, `scripts/collab-review.sh`). Codex runs read-only on a fixed bundle:
  task, diff since the base commit, final check record. Results in `<runtime>/<team>/review/`:
  `verdict.txt` (or `error.txt`), `.done` last. "At capacity" is retried up to three times.
- Off for the server with `ENSEMBLE_AUTO_REVIEW=0`, per launch with `COLLAB_AUTO_REVIEW=0`
  (the bench runs its own review).
- The team stores its base commit at creation, so the review sees commits made during the work.
- Startup wait raised from 12 s to 60 s (`COLLAB_AGENT_WAIT_SECS`).
- tmux sessions of failed agents are killed on disband.

## Final check: Python projects

`hooks/verify-on-stop.cjs` runs pytest when the project has pytest tests (`test_*.py`, `*_test.py`,
`conftest.py`, or a pytest section in `pytest.ini`, `pyproject.toml`, `setup.cfg`, `tox.ini`), with
the project's `.venv`/`venv` interpreter if present, else `python3`. pytest missing or no tests
collected is `INCOMPLETE`. Before, every Python task ended `SKIPPED` and the review could not
accept "all tests green".

## Fixes

- The review never started in the real server: `__dirname` is undefined in the ES module server
  (Vitest provides it). A regression test checks every server module.

## Verification

Suite green (515 passed, 3 skipped), typecheck and lint clean. Probe run 2 on 30 October
(`wordcount` CLI with pytest): Claude alone 1 min, final check PASS, review started on its own,
verdict ACCEPTED after 20 s, no findings.
