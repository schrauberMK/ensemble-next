/**
 * Paket 2: read cursor by message id, heartbeat for the watchdog, summary by type,
 * and the HANDOFF/RETURN prompt contract.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { spawnSync, execFile } from 'child_process'
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import type { AddressInfo } from 'net'
import { AgentWatchdog } from '../lib/agent-watchdog'
import { buildAgentSummarySection, latestVerifyRecord, parseReturnStatus } from '../lib/collab-summary'
import type { EnsembleMessage, EnsembleTeam } from '../types/ensemble'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS = path.join(__dirname, '..', 'scripts')

function msg(id: string, from: string, content: string, type: EnsembleMessage['type'] = 'chat', timestamp = '2026-10-25T10:00:00.000Z'): EnsembleMessage {
  return { id, teamId: 't1', from, to: 'team', content, type, timestamp }
}

describe('team-read cursor', () => {
  let server: http.Server
  let url: string
  let runtime: string
  let feed: EnsembleMessage[] = []
  let failNext = false

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (failNext) { failNext = false; res.statusCode = 500; res.end('{}'); return }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ messages: feed }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => { server.close() })
  beforeEach(() => {
    runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'read-rt-'))
    feed = []
  })

  // Async on purpose: spawnSync would block the event loop the feed server runs on.
  function read(args: string[] = [], root = runtime): Promise<{ code: number; out: string }> {
    return new Promise(resolve => {
      execFile(path.join(SCRIPTS, 'team-read.sh'), ['t1', ...args], {
        encoding: 'utf8', timeout: 10_000, env: { ...process.env, ENSEMBLE_URL: url, COLLAB_RUNTIME_ROOT: root },
      }, (err, stdout) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout).trim() }))
    })
  }

  it('shows each message once, also with identical timestamps, and skips own messages', async () => {
    feed = [msg('m1', 'codex-1', 'eins'), msg('m2', 'codex-1', 'zwei'), msg('m3', 'claude-2', 'eigene')]
    const first = await read(['claude-2'])
    expect(first.out).toContain('eins')
    expect(first.out).toContain('zwei')
    expect(first.out).not.toContain('eigene')
    // A late message with the same timestamp as the last one read: a since-cursor would drop it.
    feed.push(msg('m4', 'codex-1', 'gleiche Zeit'))
    expect((await read(['claude-2'])).out).toBe('codex-1 -> team: gleiche Zeit')
    expect((await read(['claude-2'])).out).toMatch(/^\(no new messages; 4 in feed/)
  })

  it('keeps the read state across restarts and per reader', async () => {
    feed = [msg('m1', 'codex-1', 'eins')]
    await read(['claude-2'])
    expect((await read(['claude-2'])).out).toMatch(/no new messages/)
    expect((await read(['agy-3'])).out).toContain('eins')
  })

  it('records nothing when the fetch fails', async () => {
    feed = [msg('m1', 'codex-1', 'eins')]
    failNext = true
    expect((await read(['claude-2'])).code).toBe(1)
    expect((await read(['claude-2'])).out).toContain('eins')
  })

  it('team-read writes its state where the TS path helper points', async () => {
    const { collabReadStateFile } = await import('../lib/collab-paths')
    const teamId = 't1'
    // collab-paths fixes its root at import; point team-read at that same root.
    const stateFile = collabReadStateFile(teamId, 'claude-2')
    const root = path.dirname(path.dirname(path.dirname(stateFile)))
    feed = [msg('m1', 'codex-1', 'eins')]
    try {
      await read(['claude-2'], root)
      expect(fs.readFileSync(stateFile, 'utf8').trim()).toBe('m1')
    } finally {
      fs.rmSync(path.join(root, teamId, 'read-state'), { recursive: true, force: true })
    }
  })

  it('regression (probe T1 A 1): a message delivered into the pane still shows in team-read', async () => {
    // The HANDOFF was pasted into a pane whose agent sat in a wait loop. Delivery used to mark it
    // seen, so team-read inside that loop never showed it and ~90 s were lost. Only team-read marks now.
    const service = fs.readFileSync(path.join(__dirname, '..', 'services', 'ensemble-service.ts'), 'utf8')
    expect(service).not.toMatch(/markMessagesSeen|collabReadStateFile|read-state/)
    feed = [msg('h1', 'codex-1', 'HANDOFF auftrag: T1', 'decision')]
    expect((await read(['claude-2'])).out).toContain('HANDOFF auftrag: T1')
  })

  it('prints the whole feed without a reader or with --all, and tags typed messages', async () => {
    feed = [msg('m1', 'codex-1', 'plan', 'decision'), msg('m2', 'claude-2', 'eigene')]
    expect((await read()).out.split('\n')).toHaveLength(2)
    await read(['claude-2'])
    const all = (await read(['claude-2', '--all'])).out
    expect(all).toContain('codex-1 -> team [decision]: plan')
    expect(all).toContain('eigene')
  })
})

describe('team-alive heartbeat', () => {
  it('touches the heartbeat file without writing a feed message', () => {
    const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'alive-rt-'))
    const res = spawnSync(path.join(SCRIPTS, 'team-alive.sh'), ['t1', 'claude-2'], { encoding: 'utf8', env: { ...process.env, COLLAB_RUNTIME_ROOT: runtime } })
    expect(res.status).toBe(0)
    expect(fs.existsSync(path.join(runtime, 't1', 'alive', 'claude-2'))).toBe(true)
    expect(fs.existsSync(path.join(runtime, 't1', 'messages.jsonl'))).toBe(false)
  })

  function harness(heartbeatAt: () => string | undefined) {
    const team = {
      id: 't1', name: 'collabnext-test', description: '', status: 'active',
      createdAt: new Date(0).toISOString(), createdBy: 'test', feedMode: 'chat',
      agents: [{ id: 'a1', name: 'claude-2', program: 'claude', role: 'worker', status: 'active' }],
    } as unknown as EnsembleTeam
    let nudges = 0
    let now = 1_000_000
    const watchdog = new AgentWatchdog({
      loadTeams: () => [team],
      getMessages: () => [],
      getHeartbeatAt: () => heartbeatAt(),
      appendMessage: () => {},
      getRuntime: () => ({ sendKeys: async () => {}, pasteFromFile: async () => { nudges++ } }),
      resolveAgentProgram: () => ({ inputMethod: 'pasteFromFile' as const }),
      isSelf: () => true,
      getHostById: () => undefined,
      postRemoteSessionCommand: async () => {},
      collabDeliveryFile: (_t, s) => path.join(os.tmpdir(), `${s}.txt`),
      now: () => now,
      nudgeAfterMs: 60_000,
      stallAfterMs: 600_000,
      pollIntervalMs: 1_000_000,
    })
    return { watchdog, nudges: () => nudges, advance: (ms: number) => { now += ms }, now: () => now }
  }

  it('a fresh heartbeat keeps the watchdog from nudging', async () => {
    const h: ReturnType<typeof harness> = harness(() => new Date(h.now() - 5_000).toISOString())
    for (let i = 0; i < 4; i++) { h.advance(30_000); await h.watchdog.poll() }
    expect(h.nudges()).toBe(0)
  })

  it('without heartbeat a silent agent is nudged as before', async () => {
    const h = harness(() => undefined)
    for (let i = 0; i < 4; i++) { h.advance(30_000); await h.watchdog.poll() }
    expect(h.nudges()).toBeGreaterThan(0)
  })
})

describe('summary by type', () => {
  it('keeps short typed results and decisions over long chat', () => {
    const msgs = [
      msg('1', 'claude-2', 'x'.repeat(3000)),
      msg('2', 'claude-2', 'Entscheidung: Variante B', 'decision'),
      msg('3', 'claude-2', 'status: READY_FOR_REVIEW\nfiles_changed: a.ts', 'result'),
    ]
    const out = buildAgentSummarySection({ agent: 'claude-2', msgs, tokens: 'unknown' })
    expect(out).toContain('Return status: READY_FOR_REVIEW')
    expect(out).toContain('Entscheidung: Variante B')
    expect(out).toContain('Chat: 1 untyped message(s)')
    expect(out).not.toContain('xxxxxxxxxx'.repeat(10))
  })

  it('falls back to the longest messages when nothing is typed', () => {
    const msgs = [msg('1', 'codex-1', 'kurz'), msg('2', 'codex-1', 'ziemlich lange Nachricht')]
    const out = buildAgentSummarySection({ agent: 'codex-1', msgs, tokens: 'unknown' })
    expect(out).toContain('Key messages (untyped, longest first)')
    expect(out.indexOf('ziemlich lange')).toBeLessThan(out.indexOf('kurz'))
  })

  it('flags READY_FOR_REVIEW against a failed final check', () => {
    const msgs = [msg('1', 'claude-2', 'status: READY_FOR_REVIEW', 'result')]
    const out = buildAgentSummarySection({
      agent: 'claude-2', msgs, tokens: 'unknown',
      verify: { status: 'FAIL', unresolved: true, checks: [{ name: 'npm run test', status: 'FAIL' }] },
    })
    expect(out).toContain('Final check: FAIL (npm run test FAIL), unresolved')
    expect(out).toContain('⚠ READY_FOR_REVIEW claimed, but the final check is FAIL')
    const none = buildAgentSummarySection({ agent: 'claude-2', msgs, tokens: 'unknown', verify: null })
    expect(none).toContain('Final check: no record')
  })

  it('parses RETURN status variants', () => {
    expect(parseReturnStatus('STATUS: BLOCKED – Grund')).toBe('BLOCKED')
    expect(parseReturnStatus('status = needs_decision')).toBe('NEEDS_DECISION')
    // Seen in the first bench run: no separator at all.
    expect(parseReturnStatus('RETURN T1 rev1: status READY_FOR_REVIEW (kein Blocker)')).toBe('READY_FOR_REVIEW')
    expect(parseReturnStatus('**status:** READY_FOR_REVIEW')).toBe('READY_FOR_REVIEW')
    expect(parseReturnStatus('Ich bin bereit für ein Review')).toBeUndefined()
    expect(parseReturnStatus('status: **READY_FOR_REVIEW**')).toBe('READY_FOR_REVIEW')
  })

  it('finds the latest verify record of a tmux session', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-dir-'))
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ status: 'FAIL', tmuxSession: 's1', checkedAt: '2026-10-25T10:00:00Z' }))
    fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ status: 'PASS', tmuxSession: 's1', checkedAt: '2026-10-25T11:00:00Z' }))
    fs.writeFileSync(path.join(dir, 'c.json'), JSON.stringify({ status: 'FAIL', tmuxSession: 's2', checkedAt: '2026-10-25T12:00:00Z' }))
    expect(latestVerifyRecord('s1', dir)?.status).toBe('PASS')
    expect(latestVerifyRecord('s3', dir)).toBeUndefined()
  })
})

describe('prompt contract', () => {
  it('worker prompt carries HANDOFF/RETURN, the per-reader team-read and team-alive', async () => {
    const { buildPromptPreview } = await import('../services/ensemble-service')
    const worker = buildPromptPreview({
      teamId: 't1', teamName: 'collabnext-x', description: 'Aufgabe', agentName: 'claude-2',
      teammateNames: ['codex-1'], agentIndex: 1, program: 'claude',
    })
    expect(worker).toContain('team-read.sh t1 claude-2')
    expect(worker).toContain('team-alive.sh t1 claude-2')
    expect(worker).toContain('RETURN (worker to lead, --type result)')
    expect(worker).toContain('do not re-plan it and do not delegate')
    expect(worker).toContain('never wait inside a tool call: no sleep loops, no repeated team-read')
    expect(worker).toContain('end your turn and wait for the lead')
    expect(worker).not.toContain('After EVERY analysis step')
    const lead = buildPromptPreview({
      teamId: 't1', teamName: 'collabnext-x', description: 'Aufgabe', agentName: 'codex-1',
      teammateNames: ['claude-2'], agentIndex: 0, program: 'codex',
    })
    expect(lead).toContain('HANDOFF to the worker')
    expect(lead).toContain('verworfen')
  })
})

describe('review-bundle', () => {
  it('shows commits since --base and new files, and says when no check record exists', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-repo-'))
    const env = { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(repo) }
    const git = (...a: string[]) => spawnSync('git', a, { cwd: repo, env, encoding: 'utf8' })
    git('init', '-q'); git('config', 'user.email', 't@example.invalid'); git('config', 'user.name', 't')
    fs.writeFileSync(path.join(repo, 'a.txt'), 'alt\n'); git('add', '-A'); git('commit', '-q', '-m', 'base')
    const base = git('rev-parse', 'HEAD').stdout.trim()
    fs.writeFileSync(path.join(repo, 'a.txt'), 'neu\n'); git('commit', '-q', '-am', 'heimlicher commit')
    fs.writeFileSync(path.join(repo, 'b.txt'), 'neue datei\n')
    const task = path.join(repo, '..', `${path.basename(repo)}-task.md`)
    fs.writeFileSync(task, 'Aufgabe X\nAbnahme: keine Commits\n')
    const run = (...a: string[]) => spawnSync(path.join(SCRIPTS, 'review-bundle.sh'), [repo, task, ...a], { env, encoding: 'utf8' }).stdout
    const withBase = run('--base', base)
    expect(withBase).toContain('heimlicher commit')
    expect(withBase).toContain('+neu')
    expect(withBase).toContain('+neue datei')
    expect(withBase).toContain('NO RECORD')
    const withoutBase = run()
    expect(withoutBase).not.toMatch(/^\+neu$/m)
    expect(withoutBase).toContain('no --base given')
  })
})

describe('closing a team after an acceptance (bench run T1 A 2)', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 25, 18, 28, 0) + s * 1000).toISOString()
  const active = new Set(['codex-1', 'claude-2'])
  // The real order from T1 A 2: worker RETURN + sentinel, then the lead's acceptance + sentinel.
  const run = [
    msg('1', 'codex-1', 'HANDOFF ...', 'decision', at(0)),
    msg('2', 'claude-2', 'RETURN status: READY_FOR_REVIEW', 'result', at(18)),
    msg('3', 'claude-2', '<<COLLAB_DONE>>', 'chat', at(18)),
    msg('4', 'codex-1', 'T1 rev1 abgenommen', 'result', at(35)),
    msg('5', 'codex-1', '<<COLLAB_DONE>>', 'result', at(39)),
  ]
  const lastMs = Date.parse(at(39))

  it('closes after 60 s quiet when only results followed a sentinel', async () => {
    const { closesAfterAcceptance, __testing } = await import('../services/ensemble-service')
    expect(__testing.ACCEPTED_CLOSE_IDLE_MS).toBe(60_000)
    expect(closesAfterAcceptance(run, active, lastMs + 59_000)).toBe(false)
    expect(closesAfterAcceptance(run, active, lastMs + 60_000)).toBe(true)
  })

  it('keeps waiting when a question or new decision came after a sentinel', async () => {
    const { closesAfterAcceptance } = await import('../services/ensemble-service')
    for (const type of ['question', 'decision', 'chat'] as const) {
      const msgs = [...run.slice(0, 3), msg('4', 'codex-1', 'Noch eine Sache?', type, at(35)), run[4]]
      expect(closesAfterAcceptance(msgs, active, lastMs + 600_000)).toBe(false)
    }
  })

  it('never closes while an agent has not ended on the sentinel', async () => {
    const { closesAfterAcceptance } = await import('../services/ensemble-service')
    expect(closesAfterAcceptance(run.slice(0, 4), active, lastMs + 600_000)).toBe(false)
    expect(closesAfterAcceptance(run, new Set(), lastMs + 600_000)).toBe(false)
  })
})

describe('waiting for the final check before closing (bench runs T1 B 1/2)', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 29, 21, 29, 58) + s * 1000).toISOString()
  const agent = (name: string, program: string) =>
    ({ agentId: name, name, program, role: 'worker', hostId: 'local', status: 'active' as const })
  const team = { agents: [agent('claude-1', 'claude')] } as unknown as EnsembleTeam
  // The real order from T1 B 1: plan, RETURN and sentinel in the same turn.
  const run = [
    msg('1', 'claude-1', 'Plan: Off-by-one in src/paginate.js', 'chat', at(0)),
    msg('2', 'claude-1', 'status: READY_FOR_REVIEW', 'result', at(12)),
    msg('3', 'claude-1', '<<COLLAB_DONE>>', 'chat', at(12)),
  ]
  const sentMs = Date.parse(at(12))

  it('holds a one-agent team until the Stop hook has written a record after the sentinel', async () => {
    const { awaitingFinalCheck } = await import('../services/ensemble-service')
    expect(awaitingFinalCheck(team, run, sentMs + 20_000, () => undefined)).toEqual(['claude-1'])
    // A record from an earlier stop does not count.
    expect(awaitingFinalCheck(team, run, sentMs + 20_000, () => at(5))).toEqual(['claude-1'])
    expect(awaitingFinalCheck(team, run, sentMs + 20_000, () => at(30))).toEqual([])
  })

  it('gives up after the hook timeout and ignores agents without the hook', async () => {
    const { awaitingFinalCheck, __testing } = await import('../services/ensemble-service')
    expect(__testing.FINAL_CHECK_WAIT_MS).toBe(600_000)
    expect(awaitingFinalCheck(team, run, sentMs + 600_000, () => undefined)).toEqual([])
    const codexOnly = { agents: [agent('codex-1', 'codex')] } as unknown as EnsembleTeam
    const codexRun = run.map(m => ({ ...m, from: 'codex-1' }))
    expect(awaitingFinalCheck(codexOnly, codexRun, sentMs + 20_000, () => undefined)).toEqual([])
  })

  it('does not wait while the agent has not ended on the sentinel', async () => {
    const { awaitingFinalCheck } = await import('../services/ensemble-service')
    expect(awaitingFinalCheck(team, run.slice(0, 2), sentMs + 20_000, () => undefined)).toEqual([])
  })

  it('does not wait when the final check is turned off', async () => {
    const { awaitingFinalCheck } = await import('../services/ensemble-service')
    const before = process.env.ENSEMBLE_VERIFY_ON_STOP
    process.env.ENSEMBLE_VERIFY_ON_STOP = '0'
    try {
      expect(awaitingFinalCheck(team, run, sentMs + 20_000, () => undefined)).toEqual([])
    } finally {
      if (before === undefined) delete process.env.ENSEMBLE_VERIFY_ON_STOP
      else process.env.ENSEMBLE_VERIFY_ON_STOP = before
    }
  })
})

describe('codex runs without the shared app-server daemon (bench run T1 A 2)', () => {
  it('starts codex with --no-daemon so a new team never continues an old thread', async () => {
    const { buildAgentCommandParts } = await import('../lib/agent-config')
    expect(buildAgentCommandParts('codex')).toContain('--no-daemon')
    expect(buildAgentCommandParts('claude')).not.toContain('--no-daemon')
  })
})
