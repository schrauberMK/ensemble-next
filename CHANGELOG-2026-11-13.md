# ensemble-next: changelog 13 November 2026 (v1.2.0-beta.1)

Beta. Four additions around the blind review and the final check. The ideas for all four come
from a comparison with [nyldn/claude-octopus](https://github.com/nyldn/claude-octopus) (council
grounding, refinement limits, artifact hashes, read-only judge adapter); the code is new.

## Citation check of the verdict

- `scripts/verdict-grounding.py` compares the `file:line` citations of a verdict with the diff in
  the review bundle and with the work tree. No model, no tokens.
- Status `grounded`, `ungrounded` (an `ACCEPTED` then counts as unproven) or `invalid` (a file
  that does not exist, a line past the end of the file).
- `scripts/collab-review.sh` appends the note to `verdict.txt`; the reviewer's own text stays in
  `verdict.raw.txt`, details in `grounding.json`.

## Verdict bound to the reviewed state

- `grounding.json` carries the SHA-256 of the bundle and of its change section.
- The bundle is built again after the review; if the work tree changed meanwhile, the note says
  that the verdict belongs to the older state.
- `scripts/verdict-check.sh <review-dir>` repeats that comparison later (0 current, 1 stale,
  2 cannot tell).

## Rework limits in the final check

- The Stop hook (`hooks/verify-on-stop.cjs`) limited blocks per change set only; every new edit
  reset the count. Now also across change sets, from the first failing check until one passes:
  `ENSEMBLE_VERIFY_MAX_ROUNDS` (6), `ENSEMBLE_VERIFY_MAX_MINUTES` (30),
  `ENSEMBLE_VERIFY_STALL_ROUNDS` (2 edits in a row with the same failure output). `0` = off.
- The record carries `stopReason` and `rounds`; the team summary shows them.

## Reviewer without MCP servers, plugins, apps and memories

- `scripts/reviewer-args.py` adds `--ignore-user-config --ignore-rules --disable apps
  --disable memories` to the reviewer's `codex exec` and passes the configured model and
  reasoning effort on explicitly. `COLLAB_REVIEW_MODEL` / `COLLAB_REVIEW_EFFORT` override,
  `COLLAB_REVIEW_ISOLATED=0` switches it off.
- Measured with codex-cli 0.167.1: 405 MCP tools became 0; two reviews cost 9.9k and 10.4k
  tokens instead of 17.1k and 19.4k, with the same verdicts.
- Codex as a team member is not affected: it starts with the full user configuration.
- Known limit: the global `~/.codex/AGENTS.md` is still loaded.

## Housekeeping

- Documentation for publication: `README.md` (German), `docs/ensemble-next-doku.pdf` with its
  LaTeX source, upstream README kept as `docs/README-upstream.md`.
- Local paths removed from test data and bench results; the machine-specific skill copy under
  `.claude/skills/collab-next/` is no longer tracked.
