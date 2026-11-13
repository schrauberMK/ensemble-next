# Optional external brain integration

Read this only when the user configures roster/plan/event hooks, stalled-agent replacement,
or a shared team worktree.

Configuration supports `rosterCommand`, `planCommand`, `eventsCommand`,
`replaceStalledAgents` (default false), and `maxReplacementsPerTeam` (default 2).
Use generic commands such as `"rosterCommand": "my-brain roster"`.
Environment overrides are `ENSEMBLE_ROSTER_CMD`, `ENSEMBLE_PLAN_CMD`,
`ENSEMBLE_EVENTS_CMD`, and `ENSEMBLE_REPLACE_STALLED`.

Hooks are trusted shell code invoked as `/bin/bash -c '<cmd> "$@"' ensemble-<name> <args...>`.
The entire process group is killed on timeout. Roster takes no arguments, has a
5-second timeout, and returns the healthCommand schema: agent keys mapped to
`{ "status": "ok|down|limit|slow|unknown", "detail": "optional" }`.
Plan receives task text as `$1`, has a 20-second timeout, and returns
`{ "agents": ["codex", "mimo"], "template": "implement", "reason": "Complementary roles" }`.
Extra plan fields are ignored. Explicit agents bypass planning; an explicit
template wins. Failed planning uses the default team.

Events take no arguments, receive exactly one JSON line on stdin followed by EOF,
and have a 5-second timeout. Delivery is nonblocking and nonfatal, with at most one
warning per team. Common fields: `event`, `teamId`, `team`, ISO-8601 `ts`.
Types: `team_started` (`agents`, `cwd`, `branch`), `agent_ready` and `agent_done`
(`agent`), `agent_stalled` and `agent_failed` (`agent`, `detail`), `agent_replaced`
(`agent`, `replacement`, `detail`), `team_finished` (`status`: `ok|failed|stopped`,
`durationS`, `branch`, `cwd`, `detail`). Unavailable fields are omitted.

Launch with `COLLAB_WORKTREE=team` for a shared local git worktree, or send
`worktree: "team"` through the API. All local agents share its branch
`ensemble/<short-team-id>`. The worktree is retained, never automatically merged.
Path and branch appear in the summary and finish event. Replacement checks local
sessions every 20 seconds and preserves role, directory, task, and bounded recent
context. It selects an unused `fallbackOrder` key with status `ok`, using roster,
then health, then no check. Remote replacements remain on the original host. MiMo (`mimo`) is
available as an explicit agent key.
