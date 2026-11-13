/* eslint-disable @typescript-eslint/no-explicit-any -- the test reads arbitrary result JSON */
/**
 * Paket 3a: bench tooling. No agent runs: run.sh and review.sh only in --dry-run, and the
 * agent's side of a run is simulated with files.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BENCH = path.join(__dirname, '..', 'bench')

function slug(p: string) {
  return p.replace(/[^A-Za-z0-9]/g, '-')
}

function writeJsonl(file: string, records: unknown[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n')
}

describe('fixtures', () => {
  it('hidden tests are red on the fixture and green with the reference solution', () => {
    const res = spawnSync(path.join(BENCH, 'selftest.sh'), { encoding: 'utf8', timeout: 120_000 })
    expect(res.stdout).not.toContain('MISMATCH')
    expect(res.status).toBe(0)
  }, 130_000)
})

describe('run.sh / collect.py / review.sh on a simulated run', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-sim-'))
  const env = {
    ...process.env,
    BENCH_ROOT: path.join(root, 'runs'),
    ENSEMBLE_NEXT_RUNTIME: path.join(root, 'rt'),
    ENSEMBLE_NEXT_DATA: path.join(root, 'data'),
    CLAUDE_PROJECTS_DIR: path.join(root, 'claude'),
    CODEX_SESSIONS_DIR: path.join(root, 'codex'),
  }
  let run = ''
  let result: Record<string, any>

  beforeAll(() => {
    const prep = spawnSync(path.join(BENCH, 'run.sh'), ['T1', 'A', '1', '--dry-run'], { env, encoding: 'utf8' })
    expect(prep.status).toBe(0)
    run = prep.stdout.trim().split('\n').pop()!
    const meta = JSON.parse(fs.readFileSync(path.join(run, 'meta.json'), 'utf8'))
    const work = meta.work as string
    const teamId = 'team-sim'
    const teamName = 'collabnext-1-1'
    const created = new Date(Date.now() - 60_000).toISOString()

    // The agent's side: fix + one file outside the write scope.
    fs.cpSync(path.join(BENCH, 'fixtures', 'T1', 'solution'), work, { recursive: true })
    fs.writeFileSync(path.join(work, 'notes.txt'), 'nicht im Schreibbereich\n')
    Object.assign(meta, { teamId, teamName, status: 'finished', dryRun: false })
    fs.writeFileSync(path.join(run, 'meta.json'), JSON.stringify(meta))

    fs.mkdirSync(path.join(root, 'data', 'ensemble'), { recursive: true })
    fs.writeFileSync(path.join(root, 'data', 'ensemble', 'teams.json'), JSON.stringify([{ id: teamId, name: teamName, createdAt: created }]))
    writeJsonl(path.join(root, 'rt', teamId, 'messages.jsonl'), [
      { id: '1', from: 'codex-1', to: 'claude-2', type: 'decision', content: 'HANDOFF ...', timestamp: created },
      { id: '2', from: 'claude-2', to: 'codex-1', type: 'question', content: 'Frage?', timestamp: created },
      { id: '3', from: 'claude-2', to: 'codex-1', type: 'result', content: 'RETURN status: READY_FOR_REVIEW', timestamp: created },
      { id: '4', from: 'claude-2', to: 'codex-1', type: 'chat', content: '<<COLLAB_DONE>>', timestamp: created },
      { id: '5', from: 'ensemble', to: 'team', type: 'chat', content: 'claude-2 has left', timestamp: created },
    ])
    fs.writeFileSync(path.join(root, 'rt', teamId, '.finished'), '')
    fs.mkdirSync(path.join(root, 'rt', 'verify'), { recursive: true })
    const record = path.join(root, 'rt', 'verify', 's1.json')
    fs.writeFileSync(record, JSON.stringify({ status: 'PASS', tmuxSession: `${teamName}-claude-2`, checkedAt: created, file: record, checks: [] }))

    const later = new Date(Date.now() - 30_000).toISOString()
    const before = new Date(Date.now() - 3_600_000).toISOString()
    const usage = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 }
    writeJsonl(path.join(root, 'claude', slug(work), 's1.jsonl'), [
      { type: 'assistant', timestamp: before, sessionId: 's0', message: { id: 'old', model: 'claude-opus-5-5', usage } },
      { type: 'assistant', timestamp: later, sessionId: 's1', message: { id: 'm1', model: 'claude-opus-5-5', usage } },
      { type: 'assistant', timestamp: later, sessionId: 's1', message: { id: 'm1', model: 'claude-opus-5-5', usage } },
      { type: 'system', subtype: 'stop_hook_summary', timestamp: later, hookInfos: ['Abschlusscheck FAIL (Versuch 1/3) für 1 geänderte Datei(en).'] },
    ])
    writeJsonl(path.join(root, 'claude', slug(work), 's1', 'subagents', 'a.jsonl'), [
      { type: 'assistant', timestamp: later, isSidechain: true, sessionId: 's1', message: { id: 'sub1', model: 'claude-opus-5-5', usage } },
    ])
    const tc = (total: number) => ({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: total, cached_input_tokens: 0, output_tokens: 0, total_tokens: total } } } })
    writeJsonl(path.join(root, 'codex', '2026', '10', '25', 'rollout-lead.jsonl'), [
      { type: 'session_meta', payload: { cwd: work, originator: 'codex-tui', timestamp: later } }, tc(1000),
    ])
    writeJsonl(path.join(root, 'codex', '2026', '10', '25', 'rollout-probe.jsonl'), [
      { type: 'session_meta', payload: { cwd: work, originator: 'codex_exec', timestamp: before } }, tc(99),
    ])
    writeJsonl(path.join(root, 'codex', '2026', '10', '25', 'rollout-review.jsonl'), [
      { type: 'session_meta', payload: { cwd: path.join(run, 'review', 'cwd'), originator: 'codex_exec', timestamp: later } }, tc(200),
    ])
    fs.mkdirSync(path.join(run, 'review'), { recursive: true })
    fs.writeFileSync(path.join(run, 'review', 'verdict.txt'), [
      'VERDICT: CHANGES_REQUESTED', 'blind: yes', 'criteria:', '  - npm test grün: met — x',
      '  - nur src/paginate.js: not met — notes.txt', '  - keine Commits: met — y', 'final_check: PASS',
      'findings:', '  - blocker Datei außerhalb des Schreibbereichs — notes.txt',
    ].join('\n'))

    const col = spawnSync('python3', ['-I', path.join(BENCH, 'collect.py'), run, '--results-dir', path.join(root, 'results')], { env, encoding: 'utf8' })
    expect(col.stderr).toBe('')
    expect(col.status).toBe(0)
    result = JSON.parse(fs.readFileSync(path.join(run, 'result.json'), 'utf8'))
  }, 60_000)

  it('run.sh --dry-run prepares a base commit and guard checksums without launching', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(run, 'meta.json'), 'utf8'))
    expect(meta.base).toMatch(/^[0-9a-f]{40}$/)
    expect(Object.keys(meta.guard)).toEqual(['package.json', 'test/paginate.test.js'])
    expect(fs.existsSync(path.join(run, 'launch.log'))).toBe(false)
  })

  it('quality: hidden tests, scope, guard, return status', () => {
    expect(result.quality.hiddenPass).toBe(true)
    expect(result.quality.visiblePass).toBe(true)
    expect(result.quality.guardIntact).toBe(true)
    expect(result.changes.outOfScope).toEqual(['notes.txt'])
    expect(result.quality.scopeViolation).toBe(true)
    expect(result.messages.returnStatus).toBe('READY_FOR_REVIEW')
    expect(result.quality.readyWithoutPass).toBe(false)
    expect(result.quality.escalationCorrect).toBeNull()
    expect(result.quality.invalid).toBeNull()
    expect(result.messages.senders).toEqual(['claude-2', 'codex-1'])
  })

  it('usage: Claude deduplicated with subagents and from team creation on, Codex lead/probe/reviewer apart', () => {
    const c = result.usage.claude
    expect(c.messages).toBe(2)
    expect(c.tokens.total).toBe(2 * 1160)
    expect(c.sidechainMessages).toBe(1)
    expect(result.rework.hookBlocks).toBe(1)
    expect(result.usage.codex.leadTotal).toBe(1000)
    expect(result.usage.codex.reviewerTotal).toBe(200)
    expect(result.usage.codex.probes).toEqual([])
  })

  it('messages, review and time', () => {
    expect(result.messages.total).toBe(3)
    expect(result.messages.byType).toEqual({ decision: 1, question: 1, result: 1 })
    expect(result.review.verdict).toBe('CHANGES_REQUESTED')
    expect(result.review.blind).toBe(true)
    expect(result.review.criteria).toEqual({ met: 2, 'not met': 1, 'not verifiable': 0 })
    expect(result.review.blockers).toBe(1)
    expect(result.time.durationS).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(root, 'results', `${result.runId}.json`))).toBe(true)
  })

  it('review.sh --dry-run builds a blind bundle and starts no reviewer', () => {
    const res = spawnSync(path.join(BENCH, 'review.sh'), [run, '--dry-run'], { env, encoding: 'utf8' })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('dry run, not started')
    const bundle = fs.readFileSync(path.join(run, 'review', 'bundle.md'), 'utf8')
    expect(bundle).toContain('Aufgabe T1')
    expect(bundle).toContain('Commits since base:')
    expect(bundle).toContain('+nicht im Schreibbereich')
    expect(bundle).toContain('"status":"PASS"')
    expect(bundle).not.toContain('NO RECORD')
    expect(bundle).not.toContain('HANDOFF')
    expect(fs.readFileSync(path.join(run, 'review', 'prompt.md'), 'utf8')).toContain('# verify-deliverable')
    expect(fs.readdirSync(path.join(run, 'review', 'cwd'))).toEqual([])
  })
})

describe('codex usage when the lead continues inside the probe session', () => {
  it('books each turn on its own cwd, not on the file header', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-codex-'))
    const work = path.join(root, 'work')
    const t = (offsetS: number) => new Date(Date.UTC(2026, 9, 25, 18, 0, offsetS)).toISOString()
    const tc = (ts: string, total: number) => ({ type: 'event_msg', timestamp: ts, payload: { type: 'token_count', info: { total_token_usage: { input_tokens: total, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: total } } } })
    writeJsonl(path.join(root, 'codex', 'rollout-x.jsonl'), [
      { type: 'session_meta', timestamp: t(0), payload: { cwd: '/home/user/ensemble-next', originator: 'codex_exec', timestamp: t(0) } },
      { type: 'turn_context', timestamp: t(1), payload: { cwd: '/home/user/ensemble-next', model: 'gpt-6.1-sol' } },
      tc(t(2), 24_000),
      { type: 'turn_context', timestamp: t(60), payload: { cwd: work, model: 'gpt-6.1-sol' } },
      tc(t(61), 300_000),
      tc(t(90), 590_000),
    ])
    const py = [
      'import sys, json', `sys.path.insert(0, ${JSON.stringify(BENCH)})`, 'import common',
      `print(json.dumps(common.codex_rollouts(${JSON.stringify(work)}, ${JSON.stringify(t(30))})))`,
    ].join('\n')
    const res = spawnSync('python3', ['-I', '-c', py], { encoding: 'utf8', env: { ...process.env, CODEX_SESSIONS_DIR: path.join(root, 'codex') } })
    const segs = JSON.parse(res.stdout)
    expect(segs).toHaveLength(1)
    expect(segs[0].usage.total_tokens).toBe(590_000 - 24_000)
    expect(segs[0].headerCwd).toBe('/home/user/ensemble-next')
  })
})

describe('report.py decision rule', () => {
  function row(variant: 'A' | 'B', rep: number, over: Record<string, any> = {}) {
    return {
      runId: `T1-${variant}-r${rep}`, task: 'T1', variant, rep, status: 'finished', dryRun: false,
      quality: { hiddenPass: true, scopeViolation: false, escalationExpected: false, escalationCorrect: null, falseEscalation: false, readyWithoutPass: false, verdict: 'ACCEPTED', aborted: false, ...over.quality },
      time: { durationS: over.duration ?? 300 },
      usage: { claude: { models: ['claude-opus-5-5'], tokens: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: over.out ?? 10_000, total: over.out ?? 10_000 } }, codex: { leadTotal: variant === 'A' ? 500_000 : 0, reviewerTotal: 50_000 } },
      messages: { total: 5 }, rework: { hookBlocks: 0 },
    }
  }
  function report(rows: unknown[], prices?: unknown) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-report-'))
    rows.forEach((r: any) => fs.writeFileSync(path.join(dir, `${r.runId}.json`), JSON.stringify(r)))
    const args = ['-I', path.join(BENCH, 'report.py'), '--results-dir', dir]
    const pricesFile = path.join(dir, 'prices.json')
    if (prices) fs.writeFileSync(pricesFile, JSON.stringify(prices))
    args.push('--prices', pricesFile)
    const res = spawnSync('python3', args, { encoding: 'utf8' })
    expect(res.status).toBe(0)
    return fs.readFileSync(path.join(dir, 'REPORT.md'), 'utf8')
  }
  const prices = { source: 'test', date: '2026-10-25', models: { 'claude-opus-5-5': { input: 1, cacheWrite: 1, cacheRead: 1, output: 10 } } }

  it('B becomes standard when quality is equal and B is 20 % faster', () => {
    const out = report([row('A', 1), row('A', 2), row('B', 1, { duration: 200 }), row('B', 2, { duration: 200 })])
    expect(out).toContain('**B wird Standard')
  })

  it('A stays when B fails hidden tests more often', () => {
    const out = report([row('A', 1), row('B', 1, { duration: 100, quality: { hiddenPass: false } })])
    expect(out).toContain('**A bleibt Standard')
  })

  it('cost criterion stays open without prices, and counts with prices', () => {
    const rows = [row('A', 1), row('B', 1, { out: 5_000 })]
    expect(report(rows)).toContain('**offen**')
    expect(report(rows, prices)).toContain('**B wird Standard')
  })

  it('a run marked invalid (no Codex lead) is listed but left out of the decision', () => {
    const bad = { ...row('A', 9), quality: { ...row('A', 9).quality, invalid: 'codex lead sent no message' } }
    const out = report([bad, row('A', 1), row('B', 1, { duration: 200 })])
    expect(out).toContain('Ungültig, nicht in der Entscheidung: T1-A-r9 (codex lead sent no message)')
    expect(out).toContain('| Läufe | 1 | 1 |')
  })

  it('dry runs are left out', () => {
    const out = report([{ ...row('A', 1), dryRun: true }, row('B', 1)])
    expect(out).toContain('Läufe: 1.')
  })
})
