import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, expect, it, vi } from 'vitest'

let root: string
const mocked = ['agent-runtime', 'agent-spawner', 'hosts-config', 'memory-export', 'auto-review']
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  for (const name of mocked) vi.doUnmock(`../lib/${name}`)
  vi.resetModules()
  if (root) fs.rmSync(root, { recursive: true, force: true })
})
it('persists a crashed agent and disbands when the surviving agent sends its sentinel', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'failed-agent-'))
  vi.stubEnv('ENSEMBLE_DATA_DIR', root)
  vi.stubEnv('COLLAB_RUNTIME_ROOT', path.join(root, 'runtime'))
  vi.stubEnv('ENSEMBLE_CREATED_BY', 'test')
  vi.stubEnv('ENSEMBLE_MAX_TEAM_MINUTES', '')
  vi.stubEnv('ENSEMBLE_WATCHDOG_NUDGE_MS', '1')
  vi.useFakeTimers()
  vi.resetModules()
  const now = Date.now()
  vi.doMock('../lib/agent-runtime', () => ({ getRuntime: () => ({
    pasteFromFile: async (session: string) => {
      if (session.endsWith('codex-1')) throw Object.assign(new Error('Agent stopped'), { name: 'AgentNotRunningError' })
    },
  }) }))
  const kill = vi.fn(async (_session: string) => {})
  const startAutoReview = vi.fn((_team: unknown, _messages: unknown) => undefined)
  vi.doMock('../lib/auto-review', () => ({ startAutoReview }))
  vi.doMock('../lib/agent-spawner', () => ({
    spawnLocalAgent: vi.fn(), spawnRemoteAgent: vi.fn(), killLocalAgent: kill, killRemoteAgent: async () => {},
    postRemoteSessionCommand: vi.fn(), isRemoteSessionReady: vi.fn(), getAgentTokenUsage: async () => 'unknown',
  }))
  vi.doMock('../lib/hosts-config', () => ({ isSelf: () => true, getHostById: () => undefined, getSelfHostId: () => 'local' }))
  vi.doMock('../lib/memory-export', () => ({ checkMemoryEndpoint: async () => ({ ok: true, endpoint: 'disabled-in-test' }), exportObservation: async () => ({ ok: true }) }))
  const service = await import('../services/ensemble-service')
  const registry = await import('../lib/ensemble-registry')
  const created = registry.createTeam({ name: 'recovery', description: 'Failure test', agents: [{ program: 'codex' }, { program: 'claude' }] })
  registry.updateTeam(created.id, { status: 'active', createdAt: new Date(now).toISOString(), agents: created.agents.map(a => ({ ...a, status: 'active', startedAt: new Date(now).toISOString() })) })
  await vi.advanceTimersByTimeAsync(90_000)
  expect(registry.getTeam(created.id)!.agents.map(a => a.status)).toEqual(['failed', 'active'])
  registry.appendMessage(created.id, { id: 'ret', teamId: created.id, from: 'claude-2', to: 'team', content: 'status: READY_FOR_REVIEW', type: 'result', timestamp: new Date().toISOString() })
  registry.appendMessage(created.id, { id: 'done', teamId: created.id, from: 'claude-2', to: 'team', content: '<<COLLAB_DONE>>', type: 'chat', timestamp: new Date().toISOString() })
  // claude-2 is a claude agent: the team waits for its final check (Stop hook record).
  await service.checkIdleTeams()
  expect(registry.getTeam(created.id)!.status).toBe('active')
  await vi.advanceTimersByTimeAsync(1_000)
  const verifyDir = path.join(root, 'runtime', 'verify')
  fs.mkdirSync(verifyDir, { recursive: true })
  // As in test run T1 A 0: the checks ran before the sentinel, the later stop only reused them.
  fs.writeFileSync(path.join(verifyDir, 'claude-2-session.json'), JSON.stringify({
    status: 'PASS', checkedAt: new Date(now).toISOString(), stoppedAt: new Date().toISOString(),
    tmuxSession: `${registry.getTeam(created.id)!.name}-claude-2`,
  }))
  await service.checkIdleTeams()
  expect(registry.getTeam(created.id)!.status).toBe('disbanded')
  // The crashed codex-1 left its tmux session behind (25.10.); disband ends it as well.
  const name = registry.getTeam(created.id)!.name
  expect(kill.mock.calls.map(c => c[0]).sort()).toEqual([`${name}-claude-2`, `${name}-codex-1`])
  // The blind review gets the disbanded team and the full feed, READY_FOR_REVIEW included.
  expect(startAutoReview).toHaveBeenCalledTimes(1)
  const [team, messages] = startAutoReview.mock.calls[0] as unknown as [{ status: string }, { id: string }[]]
  expect(team.status).toBe('disbanded')
  expect(messages.map(m => m.id)).toContain('ret')
})
