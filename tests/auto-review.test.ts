/**
 * Blind review on disband (lib/auto-review.ts): started only for READY_FOR_REVIEW, never
 * twice, and off per team (autoReview: false, the bench) or per server (ENSEMBLE_AUTO_REVIEW=0).
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnsembleMessage, EnsembleTeam } from '../types/ensemble'

const spawnMock = vi.fn(() => ({ unref: () => {} }))
vi.mock('child_process', async (orig) => ({ ...(await orig<typeof import('child_process')>()), spawn: spawnMock }))

let root: string
let work: string

function msg(from: string, content: string, type: EnsembleMessage['type'] = 'result'): EnsembleMessage {
  return { id: `${from}-${content.length}`, teamId: 't1', from, to: 'team', content, type, timestamp: new Date().toISOString() }
}

function team(extra: Partial<EnsembleTeam> = {}): EnsembleTeam {
  return {
    id: 't1', name: 'collabnext-1-1', description: '# Aufgabe\nTu was.', status: 'disbanded',
    agents: [{ agentId: '', name: 'claude-1', program: 'claude code', role: 'lead', hostId: '', status: 'active' }],
    createdBy: 'test', createdAt: new Date().toISOString(), feedMode: 'live', workingDirectory: work,
    baseCommit: 'abc123', ...extra,
  }
}

const ready = [msg('claude-1', 'status: READY_FOR_REVIEW\nfiles_changed: a.js'), msg('claude-1', '<<COLLAB_DONE>>', 'chat')]

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-review-'))
  work = path.join(root, 'work')
  fs.mkdirSync(work)
  vi.stubEnv('COLLAB_RUNTIME_ROOT', path.join(root, 'rt'))
  vi.stubEnv('ENSEMBLE_AUTO_REVIEW', '')
  vi.resetModules()
  spawnMock.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('readyForReview', () => {
  it('follows the last RETURN of an agent', async () => {
    const { readyForReview } = await import('../lib/auto-review')
    expect(readyForReview(ready)).toBe(true)
    expect(readyForReview([...ready, msg('claude-1', 'status: NEEDS_DECISION\nTest widerspricht')])).toBe(false)
    expect(readyForReview([msg('claude-1', 'status: BLOCKED'), msg('ensemble', 'status: READY_FOR_REVIEW')])).toBe(false)
    expect(readyForReview([msg('claude-1', 'Plan: erst lesen', 'chat')])).toBe(false)
  })
})

describe('startAutoReview', () => {
  it('starts collab-review.sh once, with task, base commit and the final check record', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const verify = path.join(root, 'rt', 'verify')
    fs.mkdirSync(verify, { recursive: true })
    const recFile = path.join(verify, 's1.json')
    fs.writeFileSync(recFile, JSON.stringify({ status: 'PASS', tmuxSession: 'collabnext-1-1-claude-1', checkedAt: '2026-10-30T01:00:00Z', file: recFile }))
    const { startAutoReview } = await import('../lib/auto-review')
    const dir = startAutoReview(team(), ready)
    expect(dir).toBe(path.join(root, 'rt', 't1', 'review'))
    expect(fs.readFileSync(path.join(dir!, 'task.md'), 'utf8')).toBe('# Aufgabe\nTu was.')
    expect(fs.existsSync(path.join(dir!, 'started'))).toBe(true)
    expect(spawnMock).toHaveBeenCalledTimes(1)
    const args = (spawnMock.mock.calls[0] as unknown as [string, string[]])[1]
    expect(args[0]).toMatch(/scripts\/collab-review\.sh$/)
    expect(fs.existsSync(args[0])).toBe(true)
    expect(args.slice(1)).toEqual([dir, work, 'abc123', recFile])
    expect(startAutoReview(team(), ready)).toBeUndefined()
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('starts nothing without READY_FOR_REVIEW, for a bench team or when the server turns it off', async () => {
    const { startAutoReview } = await import('../lib/auto-review')
    expect(startAutoReview(team(), [msg('claude-1', 'status: NEEDS_DECISION')])).toBeUndefined()
    expect(startAutoReview(team({ autoReview: false }), ready)).toBeUndefined()
    vi.stubEnv('ENSEMBLE_AUTO_REVIEW', '0')
    expect(startAutoReview(team(), ready)).toBeUndefined()
    expect(spawnMock).not.toHaveBeenCalled()
  })

  // Vitest provides a CommonJS __dirname, the tsx server (ESM) does not: the probe run on
  // 30.10. failed with "__dirname is not defined" while this suite was green.
  it('every server module that uses __dirname defines it for ESM', () => {
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const files = ['server.ts', ...['lib', 'services'].flatMap((d) =>
      fs.readdirSync(path.join(repo, d)).filter((f) => f.endsWith('.ts')).map((f) => path.join(d, f)))]
    const missing = files.filter((f) => {
      const src = fs.readFileSync(path.join(repo, f), 'utf8')
      return /\b__dirname\b/.test(src) && !/const __dirname\s*=/.test(src)
    })
    expect(missing).toEqual([])
  })
})
