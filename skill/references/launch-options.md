# Launch options: agents, templates, preflight

Read this when the user names agents or a template, or when `collab-launch.sh` exits non-zero.

## Agent selection (3rd argument, optional)

Comma-separated keys from `agents.json`;
the first one becomes lead. Default when omitted: `claude code` alone; when its last RETURN says
`READY_FOR_REVIEW`, the service starts a blind Codex review on disband (`review/` in the runtime dir).
Pass `codex,claude` for Codex as lead with Claude Code as worker.
When configured, `healthCommand` checks which agents are currently usable
and catches an unavailable CLI before launch. An unknown key is an error: the server rejects the
team with HTTP 400 (`Unknown agent(s): ...`) before spawning anything, so a typo fails the launch
instead of spawning a second claude.
Only pass this when the user explicitly names agents in the task (for example, "use agy and claude").
Preflight checks only the CLIs you name here, so a codex quota wall does not block a
`grok,claude` run. Naming agents explicitly also disables the auto-fallback: a dead agent
becomes a hard failure instead of a silent swap.

Also settable via `COLLAB_AGENTS`, for a preferred line-up you do not want to retype
(`export COLLAB_AGENTS="codex,claude,grok"`). Precedence: 3rd argument > `COLLAB_AGENTS` >
the default pair. `COLLAB_AGENTS` behaves like the argument at launch: `collab-launch.sh` passes
it on as the chosen line-up and ignores the preflight override file, so no auto-fallback applies
and a dead agent in that list is spawned anyway. Preflight treats the variable as a soft default
and may print a fallback warning, but that swap does not reach the launch. If you want the
auto-fallback, leave both the argument and `COLLAB_AGENTS` unset.

## agy as third teammate (researcher/griller)

When the user wants Antigravity in the team
("mit agy", "agy als Griller", "zu dritt"), pass `codex,claude,agy`. Any agent after the lead
takes the `teamRole` its `agents.json` entry defines; for `agy` that is `RESEARCHER/GRILLER`:
it researches, challenges the plan and the findings with sources, asks at most three questions
per round, does not write code, and agrees to closure only once its objections are answered.
A template role at the same position takes precedence, so with a two-role template agy still
becomes the griller as third member. Keep agy out of the lead position: without a template the
lead gets the generic LEAD prompt, with a template it gets the template's first role; either way
the griller role never applies to the lead. agy runs on the plan login (`agy` CLI, no API key):
for agents spawned on this machine the spawner strips the provider API keys listed in `unsetEnv`
from its environment. An agent spawned on a remote host follows that host's `agents.json`. Because agy is named explicitly it is never swapped
silently. Preflight has no agy login check, so a logged-out agy only shows when it does not
answer: watch the postcheck, tell the user, and offer `codex,claude` instead.

## Template selection (4th argument, optional)

A key from `collab-templates.json` that
gives each agent an explicit role instead of the generic lead/worker prompt. Also settable
via `COLLAB_TEMPLATE`. Pick one when the task clearly matches:

| Template | Roles | Use when the task is |
|---|---|---|
| `review` | REVIEWER + CRITIC | reviewing existing code |
| `implement` | ARCHITECT + DEVELOPER | building a feature |
| `research` | RESEARCHER-A + RESEARCHER-B | comparing options or exploring a topic |
| `debug` | REPRODUCER + ANALYST | chasing a bug |

Leave it empty if the task does not fit cleanly. A wrong template is worse than none.

## Preflight and postcheck

- **Preflight** runs inside `collab-launch.sh` before the team is created. It checks the
  service, agent CLI auth, and DNS. Non-zero exit means launch aborted with the fix command
  printed. Do not paper over it with `COLLAB_SKIP_PREFLIGHT=1` unless the user asks.
  Exit codes: `1` service down, `2` service started in an unauthenticated shell (restart it),
  `3` claude CLI broken, `4` codex CLI broken, `5` DNS/network, `6` grok CLI broken,
  `7` health hook reports an unavailable requested agent or no healthy fallback.
  Exit `7` is also returned by the launcher; its message lists healthy alternatives.
- **Postcheck** is armed automatically and fires ~25s after spawn. It only ever looks at this
  team's own tmux sessions. If an agent is stuck in an error state, or zero messages were
  exchanged in its wait window, it kills the team and writes the diagnosis to
  `/tmp/ensemble-next/<TEAM_ID>/postcheck.log`. If a team dies within the first minute, read that
  file before guessing.
