---
name: verify-deliverable
description: Blind, non-interactive review of a finished change against its original task. Use when an independent reviewer (Codex, AGY or a fresh Claude) has to accept or reject a RETURN marked READY_FOR_REVIEW, or when the user says "verify-deliverable" or asks for an independent acceptance check. Not for interviewing the user; that is grill-me.
---

# verify-deliverable

You review a change you did not write. You do not ask questions and you do not wait for
answers. You decide from the evidence in front of you.

## Input (fixed, nothing else)

1. **Task and acceptance criteria** as originally given to the implementer.
2. **The change**: the diff, including new files.
3. **The automatic final check**: the record of `hooks/verify-on-stop.cjs`, or the explicit
   note that there is none.

Build it with `scripts/review-bundle.sh <repo> <task-file> [<verify-record.json>] --base <start-commit>`.
Without `--base` commits made during the work are invisible; then treat "no commits" and
anything committed as not verifiable.
Do not read the implementer's chat, plan or RETURN text. If you helped write the plan, say
so in the verdict: the review is then not blind.

## Procedure

1. List the acceptance criteria. If the task has none, derive the minimum from the task
   text and mark them as derived.
2. For each criterion, decide from the diff and the check record: met, not met, or not
   verifiable from this input. Quote the file and line that decides it.
3. Read the check record as a fact:
   - `FAIL` or `unresolved: true`: the change is not acceptable as it stands.
   - `INCOMPLETE`, `SKIPPED`, `ERROR` or no record: the checks are unverified. Say which.
   - `PASS`: the project's own checks ran green. It does not prove the criteria.
4. Look for changes outside the task: files the task did not call for, weakened tests or
   checks, disabled lint rules, changed check scripts. Any weakened check is a blocker.
5. Look for the obvious failure the criteria do not mention (crash on empty input, broken
   import, secret in the diff). Report only what the diff shows, not guesses.

## Verdict (exactly this shape)

```
VERDICT: ACCEPTED | CHANGES_REQUESTED | REJECTED
blind: yes | no (<why not>)
criteria:
  - <criterion>: met | not met | not verifiable — <file:line or reason>
final_check: <status from the record, or "none">
out_of_scope: <files or "none">
findings:
  - <severity: blocker|major|minor> <one sentence> — <file:line>
```

- `ACCEPTED`: every criterion met, final check `PASS` (or no checks defined and that is stated), no blocker.
- `CHANGES_REQUESTED`: fixable gaps, at least one criterion not met or not verifiable.
- `REJECTED`: wrong direction, weakened checks, or changes far outside the task.

Write every reference as `path:line` with the path from the diff header and the line number
of the new file (old file for removed lines). A script compares these citations with the diff
afterwards: a place that does not exist makes the verdict unreliable, and an `ACCEPTED`
without a single citation in the diff counts as unproven.

Send the verdict as one message. In a collab use `team-say --type result`.
