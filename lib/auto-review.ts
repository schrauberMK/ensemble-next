/**
 * Blind review after a team finishes (Paket 4: "CC plans and implements, then the same review").
 *
 * The bench (Paket 3, 30.10.2026) ran this review by hand via bench/review.sh. Here the service
 * starts it on disband when the team's last RETURN says READY_FOR_REVIEW: scripts/collab-review.sh
 * builds the fixed bundle (task, diff since the base commit, final check record) and runs Codex
 * read-only on it. Nothing of the implementer's chat goes in, so the review stays blind.
 *
 * Files in <runtime>/<team>/review/: task.md, started (written before .finished, so a watcher
 * knows to wait), bundle.md, prompt.md, codex.log, verdict.txt or error.txt, and .done last.
 * Off for the whole server with ENSEMBLE_AUTO_REVIEW=0, per team with autoReview: false.
 */

import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import type { EnsembleMessage, EnsembleTeam } from '../types/ensemble'
import { collabRuntimeDir, collabVerifyDir } from './collab-paths'
import { latestVerifyRecord, parseReturnStatus, type VerifyRecord } from './collab-summary'

// The server runs as an ES module (package.json "type": "module"): no CommonJS __dirname.
const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function autoReviewEnabled(team: Pick<EnsembleTeam, 'autoReview'>): boolean {
  if ((process.env.ENSEMBLE_AUTO_REVIEW ?? '').trim() === '0') return false
  return team.autoReview !== false
}

/** True when the last RETURN of an agent names READY_FOR_REVIEW (a later BLOCKED wins). */
export function readyForReview(messages: EnsembleMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.from === 'ensemble' || m.from === 'user') continue
    const status = parseReturnStatus(m.content)
    if (status) return status === 'READY_FOR_REVIEW'
  }
  return false
}

/** Latest final check record of any claude agent of the team, with its file path. */
export function teamVerifyRecord(team: EnsembleTeam, dir = collabVerifyDir()): VerifyRecord | undefined {
  let latest: VerifyRecord | undefined
  for (const agent of team.agents) {
    if (!/claude/i.test(agent.program)) continue
    const rec = latestVerifyRecord(`${team.name}-${agent.name}`, dir)
    if (rec && (!latest || (rec.checkedAt ?? '') > (latest.checkedAt ?? ''))) latest = rec
  }
  return latest
}

export function reviewDir(teamId: string): string {
  return path.join(collabRuntimeDir(teamId), 'review')
}

/**
 * Starts the review in the background if the team qualifies. Returns the review directory,
 * or undefined with nothing started. Never throws: a failed start must not break a disband.
 */
export function startAutoReview(team: EnsembleTeam, messages: EnsembleMessage[]): string | undefined {
  try {
    if (!autoReviewEnabled(team) || !readyForReview(messages)) return undefined
    const work = team.worktreePath || team.workingDirectory
    if (!work || !fs.existsSync(work)) return undefined
    const dir = reviewDir(team.id)
    if (fs.existsSync(path.join(dir, 'started'))) return undefined
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'task.md'), team.description)
    const record = teamVerifyRecord(team)?.file ?? ''
    const script = path.join(__dirname, '../scripts/collab-review.sh')
    const log = fs.openSync(path.join(dir, 'review.log'), 'a')
    fs.writeFileSync(path.join(dir, 'started'), new Date().toISOString())
    const child = spawn('bash', [script, dir, work, team.baseCommit ?? '', record], {
      detached: true, stdio: ['ignore', log, log],
    })
    child.unref()
    fs.closeSync(log)
    console.log(`[Ensemble] ${team.name}: blind review started (${dir})`)
    return dir
  } catch (error) {
    console.error(`[Ensemble] ${team.name}: blind review not started:`, error instanceof Error ? error.message : error)
    return undefined
  }
}
