/**
 * Per-agent summary sections, built from message types instead of message length.
 *
 * The old summary kept the three longest messages per agent, which is why agents
 * were told to write long messages: a short, precise decision lost to a long
 * interim status. Now results, decisions and questions are kept by type, and the
 * longest-three rule only remains as a fallback for agents that never typed a
 * message. For claude agents the latest record of hooks/verify-on-stop.cjs is
 * attached, so a READY_FOR_REVIEW claim can be held against the actual check.
 */

import fs from 'fs'
import path from 'path'
import type { EnsembleMessage } from '../types/ensemble'
import { collabVerifyDir } from './collab-paths'

const MAX_CHARS = 1500
const MAX_PER_TYPE = 5

export interface VerifyRecord {
  status: string
  checkedAt?: string
  /** Last stop that ran the hook, also when it reused the result of an unchanged change set */
  stoppedAt?: string
  tmuxSession?: string
  changedFiles?: string[]
  checks?: { name: string; status: string }[]
  unresolved?: boolean
  /** Blocks in total since the first failing check (rework rounds) */
  rounds?: number
  /** Why the hook stopped blocking a failing check: same_change_set, max_rounds, max_minutes, no_progress */
  stopReason?: string
  file?: string
}

export type ReturnStatus = 'READY_FOR_REVIEW' | 'BLOCKED' | 'NEEDS_DECISION'

/** The status named in a RETURN message, if any. */
export function parseReturnStatus(content: string): ReturnStatus | undefined {
  const match = content.match(/status\s*[:=]?\s*\**\s*(READY_FOR_REVIEW|BLOCKED|NEEDS_DECISION)/i)
  return match ? (match[1].toUpperCase() as ReturnStatus) : undefined
}

/** False when ENSEMBLE_VERIFY_ON_STOP=0 turns the claude final check (Stop hook) off. */
export function verifyOnStopEnabled(): boolean {
  return (process.env.ENSEMBLE_VERIFY_ON_STOP ?? '').trim() !== '0'
}

/** Latest verify record written for a tmux session, or undefined. */
export function latestVerifyRecord(sessionName: string, dir = collabVerifyDir()): VerifyRecord | undefined {
  let files: string[]
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')) } catch { return undefined }
  let latest: VerifyRecord | undefined
  for (const f of files) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as VerifyRecord
      if (rec.tmuxSession !== sessionName) continue
      if (!latest || (rec.checkedAt ?? '') > (latest.checkedAt ?? '')) latest = rec
    } catch { /* a half-written record is skipped */ }
  }
  return latest
}

function indent(content: string): string {
  const text = content.length > MAX_CHARS ? `${content.slice(0, MAX_CHARS)} …` : content
  return `    ${text.replace(/\n/g, '\n    ')}`
}

function section(title: string, msgs: EnsembleMessage[]): string[] {
  if (msgs.length === 0) return []
  const shown = msgs.slice(-MAX_PER_TYPE)
  const skipped = msgs.length - shown.length
  return [
    `${title}${skipped ? ` (last ${shown.length} of ${msgs.length})` : ''}:`,
    ...shown.map(m => indent(m.content)),
  ]
}

export function buildAgentSummarySection(params: {
  agent: string
  msgs: EnsembleMessage[]
  tokens: string
  verify?: VerifyRecord | null
}): string {
  const { agent, msgs, tokens } = params
  const results = msgs.filter(m => m.type === 'result')
  const decisions = msgs.filter(m => m.type === 'decision')
  const questions = msgs.filter(m => m.type === 'question')
  const chat = msgs.filter(m => !m.type || m.type === 'chat')
  const lines = [`${agent} (${msgs.length} msgs, tokens: ${tokens})`]

  const lastReturn = [...results].reverse().map(m => parseReturnStatus(m.content)).find(Boolean)
  if (lastReturn) lines.push(`Return status: ${lastReturn}`)

  if (params.verify !== undefined) {
    const v = params.verify
    if (!v) {
      lines.push('Final check: no record (the agent never stopped with changes, or the hook was off)')
    } else {
      const checks = (v.checks ?? []).map(c => `${c.name} ${c.status}`).join(', ')
      lines.push(`Final check: ${v.status}${checks ? ` (${checks})` : ''}${v.unresolved ? ', unresolved' : ''}${v.stopReason ? `, rework stopped: ${v.stopReason} after ${v.rounds ?? '?'} round(s)` : ''}${v.file ? ` · ${v.file}` : ''}`)
      if (lastReturn === 'READY_FOR_REVIEW' && v.status !== 'PASS' && v.status !== 'NO_CHANGES') {
        lines.push(`⚠ READY_FOR_REVIEW claimed, but the final check is ${v.status}`)
      }
    }
  }

  const typed = [...section('Results', results), ...section('Decisions', decisions), ...section('Questions', questions)]
  if (typed.length > 0) {
    lines.push(...typed)
    if (chat.length) lines.push(`Chat: ${chat.length} untyped message(s), see transcript`)
  } else {
    // No typed messages: keep the old longest-three rule so nothing is lost.
    const ranked = [...msgs].sort((a, b) => b.content.length - a.content.length).slice(0, 3)
    lines.push('Key messages (untyped, longest first):')
    lines.push(...(ranked.length
      ? ranked.map((m, i) => `  [${i + 1}] (${m.content.length} chars)\n${indent(m.content)}`)
      : ['  (no substantive messages)']))
  }
  return lines.join('\n')
}
