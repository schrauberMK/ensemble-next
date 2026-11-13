import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnsembleMessage, EnsembleTeam } from '../types/ensemble'
import {
  AgentWatchdog,
  getWatchdogNudgeMs,
  getWatchdogStallMs,
} from '../lib/agent-watchdog'

function makeTeam(overrides: Partial<EnsembleTeam> = {}): EnsembleTeam {
  return {
    id: overrides.id ?? 'team-1',
    name: overrides.name ?? 'alpha',
    description: overrides.description ?? 'test team',
    status: overrides.status ?? 'active',
    agents: overrides.agents ?? [
      {
        agentId: 'agent-1',
        name: 'codex-1',
        program: 'codex',
        role: 'lead',
        hostId: 'local',
        status: 'active',
        startedAt: '2026-03-19T10:00:00.000Z',
      },
    ],
    createdBy: overrides.createdBy ?? 'test',
    createdAt: overrides.createdAt ?? '2026-03-19T10:00:00.000Z',
    completedAt: overrides.completedAt,
    feedMode: overrides.feedMode ?? 'live',
    result: overrides.result,
  }
}

function makeMessage(overrides: Partial<EnsembleMessage> = {}): EnsembleMessage {
  return {
    id: overrides.id ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
    teamId: overrides.teamId ?? 'team-1',
    from: overrides.from ?? 'codex-1',
    to: overrides.to ?? 'team',
    content: overrides.content ?? 'progress',
    type: overrides.type ?? 'chat',
    timestamp: overrides.timestamp ?? '2026-03-19T10:00:00.000Z',
  }
}

describe('AgentWatchdog', () => {
  const originalNudgeMs = process.env.ENSEMBLE_WATCHDOG_NUDGE_MS
  const originalStallMs = process.env.ENSEMBLE_WATCHDOG_STALL_MS

  let nowMs: number
  let teams: EnsembleTeam[]
  let messages: EnsembleMessage[]
  let appended: EnsembleMessage[]
  let sendKeys: ReturnType<typeof vi.fn>
  let pasteFromFile: ReturnType<typeof vi.fn>
  let postRemoteSessionCommand: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.restoreAllMocks()
    nowMs = new Date('2026-03-19T10:00:00.000Z').getTime()
    teams = [makeTeam()]
    messages = [makeMessage({ timestamp: '2026-03-19T10:00:00.000Z' })]
    appended = []
    sendKeys = vi.fn(async () => {})
    pasteFromFile = vi.fn(async () => {})
    postRemoteSessionCommand = vi.fn(async () => {})
  })

  afterEach(() => {
    if (originalNudgeMs === undefined) {
      delete process.env.ENSEMBLE_WATCHDOG_NUDGE_MS
    } else {
      process.env.ENSEMBLE_WATCHDOG_NUDGE_MS = originalNudgeMs
    }
    if (originalStallMs === undefined) {
      delete process.env.ENSEMBLE_WATCHDOG_STALL_MS
    } else {
      process.env.ENSEMBLE_WATCHDOG_STALL_MS = originalStallMs
    }
  })

  function createWatchdog() {
    return new AgentWatchdog({
      loadTeams: () => teams,
      getMessages: () => messages,
      appendMessage: (_teamId, message) => appended.push(message),
      getRuntime: () => ({ sendKeys, pasteFromFile }),
      resolveAgentProgram: () => ({ inputMethod: 'sendKeys' }),
      isSelf: () => true,
      getHostById: () => undefined,
      postRemoteSessionCommand,
      collabDeliveryFile: (teamId, sessionName) => path.resolve('tmp/watchdog', teamId, `${sessionName}.txt`),
      now: () => nowMs,
      pollIntervalMs: 60_000,
      nudgeAfterMs: 90_000,
      stallAfterMs: 180_000,
    })
  }

  it('replaces a remote session only after two consecutive explicit absences', async () => {
    teams = [makeTeam({ agents: [{ ...makeTeam().agents[0], hostId: 'remote' }] })]
    const sessionExists = vi.fn<() => Promise<boolean | undefined>>()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
    const replaceAgent = vi.fn(async () => true)
    const watchdog = new AgentWatchdog({
      loadTeams: () => teams, getMessages: () => messages,
      appendMessage: (_teamId, message) => appended.push(message),
      getRuntime: () => ({ sendKeys, pasteFromFile }),
      resolveAgentProgram: () => ({ inputMethod: 'sendKeys' }),
      isSelf: hostId => hostId !== 'remote', getHostById: () => undefined,
      postRemoteSessionCommand, collabDeliveryFile: () => path.resolve('tmp/watchdog/nudge'),
      replacementEnabled: () => true, sessionExists, replaceAgent,
      now: () => nowMs, nudgeAfterMs: 90_000,
    })
    try {
      for (let i = 0; i < 5; i++) {
        await watchdog.poll()
        expect(replaceAgent).not.toHaveBeenCalled()
      }
      await watchdog.poll()
      expect(replaceAgent).toHaveBeenCalledOnce()
    } finally { watchdog.stop() }
  })

  it('replaces a local session when its foreground process is a shell', async () => {
    const replaceAgent = vi.fn(async () => true)
    const getForegroundCommand = vi.fn(async () => 'zsh')
    const watchdog = new AgentWatchdog({
      loadTeams: () => teams, getMessages: () => messages,
      appendMessage: (_teamId, message) => appended.push(message),
      getRuntime: () => ({ sendKeys, pasteFromFile, getForegroundCommand }),
      resolveAgentProgram: () => ({ inputMethod: 'sendKeys' }),
      isSelf: () => true, getHostById: () => undefined,
      postRemoteSessionCommand, collabDeliveryFile: () => path.resolve('tmp/watchdog/nudge'),
      replacementEnabled: () => true, sessionExists: async () => true, replaceAgent,
      now: () => nowMs,
    })
    try {
      await watchdog.poll()
      expect(replaceAgent).toHaveBeenCalledOnce()
      expect(pasteFromFile).not.toHaveBeenCalled()
    } finally { watchdog.stop() }
  })

  it('leaves a starting agent alone while its pane still shows the launch shell', async () => {
    // Regression 2026-10-17: before prompt delivery the pane shows the shell the
    // CLI is typed into. That read as "Agent CLI exited to shell", every agent
    // was failed and the team ended with "all 0 agent session(s) unreachable".
    const starting = { ...makeTeam().agents[0], startedAt: undefined }
    teams = [makeTeam({ createdAt: new Date(nowMs).toISOString(), agents: [starting] })]
    messages = []
    const replaceAgent = vi.fn(async () => false)
    const onTeamUnreachable = vi.fn()
    const watchdog = new AgentWatchdog({
      loadTeams: () => teams, getMessages: () => messages,
      appendMessage: (_teamId, message) => appended.push(message),
      getRuntime: () => ({ sendKeys, pasteFromFile, getForegroundCommand: async () => 'bash' }),
      resolveAgentProgram: () => ({ inputMethod: 'sendKeys' }),
      isSelf: () => true, getHostById: () => undefined,
      postRemoteSessionCommand, collabDeliveryFile: () => path.resolve('tmp/watchdog/nudge'),
      replacementEnabled: () => true, sessionExists: async () => true, replaceAgent, onTeamUnreachable,
      now: () => nowMs, nudgeAfterMs: 0, startupGraceMs: 300_000,
    })
    try {
      nowMs += 60_000
      await watchdog.poll()
      expect(replaceAgent).not.toHaveBeenCalled()
      expect(pasteFromFile).not.toHaveBeenCalled()
      expect(onTeamUnreachable).not.toHaveBeenCalled()
      expect(teams[0].agents[0].status).toBe('active')

      // Delivered: from now on a shell in the foreground means the CLI is gone.
      teams[0].agents[0].startedAt = new Date(nowMs).toISOString()
      await watchdog.poll()
      expect(replaceAgent).toHaveBeenCalledOnce()
    } finally { watchdog.stop() }
  })

  it('judges an agent without startedAt once the startup grace has passed', async () => {
    const starting = { ...makeTeam().agents[0], startedAt: undefined }
    teams = [makeTeam({ createdAt: new Date(nowMs).toISOString(), agents: [starting] })]
    const replaceAgent = vi.fn(async () => true)
    const watchdog = new AgentWatchdog({
      loadTeams: () => teams, getMessages: () => messages,
      appendMessage: (_teamId, message) => appended.push(message),
      getRuntime: () => ({ sendKeys, pasteFromFile, getForegroundCommand: async () => 'zsh' }),
      resolveAgentProgram: () => ({ inputMethod: 'sendKeys' }),
      isSelf: () => true, getHostById: () => undefined,
      postRemoteSessionCommand, collabDeliveryFile: () => path.resolve('tmp/watchdog/nudge'),
      replacementEnabled: () => true, sessionExists: async () => true, replaceAgent,
      now: () => nowMs, startupGraceMs: 300_000,
    })
    try {
      nowMs += 299_000
      await watchdog.poll()
      expect(replaceAgent).not.toHaveBeenCalled()
      nowMs += 1_000
      await watchdog.poll()
      expect(replaceAgent).toHaveBeenCalledOnce()
    } finally { watchdog.stop() }
  })

  it('ends a team with an honest reason once every agent failed without replacement', async () => {
    teams = [makeTeam({ agents: [
      { agentId: 'agent-1', name: 'codex-1', program: 'codex', role: 'lead', hostId: 'local', status: 'active', startedAt: '2026-03-19T10:00:00.000Z' },
      { agentId: 'agent-2', name: 'claude-2', program: 'claude', role: 'member', hostId: 'local', status: 'active', startedAt: '2026-03-19T10:00:00.000Z' },
    ] })]
    const onTeamUnreachable = vi.fn()
    const watchdog = new AgentWatchdog({
      loadTeams: () => teams, getMessages: () => messages,
      markAgentFailed: (_id, name) => { teams[0].agents.find(agent => agent.name === name)!.status = 'failed' },
      appendMessage: (_teamId, message) => appended.push(message),
      getRuntime: () => ({ sendKeys, pasteFromFile, getForegroundCommand: async () => 'zsh' }),
      resolveAgentProgram: () => ({ inputMethod: 'sendKeys' }),
      isSelf: () => true, getHostById: () => undefined,
      postRemoteSessionCommand, collabDeliveryFile: () => path.resolve('tmp/watchdog/nudge'),
      replacementEnabled: () => true, sessionExists: async () => true,
      replaceAgent: async () => false, onTeamUnreachable,
      now: () => nowMs,
    })
    try {
      await watchdog.poll()
      expect(onTeamUnreachable).toHaveBeenCalledOnce()
      const reason = onTeamUnreachable.mock.calls[0][1] as string
      expect(reason).toBe('no active agent left: codex-1, claude-2 failed without replacement')
      expect(reason).not.toMatch(/all 0/)
    } finally { watchdog.stop() }
  })

  it('does not end a team with no active agents when the watchdog failed none of them', async () => {
    teams = [makeTeam({ agents: [
      { agentId: 'agent-1', name: 'codex-1', program: 'codex', role: 'lead', hostId: 'local', status: 'replaced', startedAt: '2026-03-19T10:00:00.000Z' },
      { agentId: 'agent-2', name: 'claude-2', program: 'claude', role: 'member', hostId: 'local', status: 'spawning' },
    ] })]
    const onTeamUnreachable = vi.fn()
    const watchdog = new AgentWatchdog({
      loadTeams: () => teams, getMessages: () => messages,
      appendMessage: (_teamId, message) => appended.push(message),
      getRuntime: () => ({ sendKeys, pasteFromFile }),
      resolveAgentProgram: () => ({ inputMethod: 'sendKeys' }),
      isSelf: () => true, getHostById: () => undefined,
      postRemoteSessionCommand, collabDeliveryFile: () => path.resolve('tmp/watchdog/nudge'),
      onTeamUnreachable, now: () => nowMs,
    })
    try {
      // reportIfTeamUnreachable is private; call it the way handleStall does.
      await (watchdog as unknown as { reportIfTeamUnreachable(team: EnsembleTeam): Promise<void> }).reportIfTeamUnreachable(teams[0])
      expect(onTeamUnreachable).not.toHaveBeenCalled()
    } finally { watchdog.stop() }
  })

  it('keeps the existing nudge behavior when replacement is disabled', async () => {
    const replaceAgent = vi.fn(async () => true)
    const watchdog = new AgentWatchdog({
      loadTeams: () => teams, getMessages: () => messages,
      appendMessage: (_teamId, message) => appended.push(message),
      getRuntime: () => ({ sendKeys, pasteFromFile, getForegroundCommand: async () => 'zsh' }),
      resolveAgentProgram: () => ({ inputMethod: 'sendKeys' }),
      isSelf: () => true, getHostById: () => undefined,
      postRemoteSessionCommand, collabDeliveryFile: () => path.resolve('tmp/watchdog/nudge'),
      replacementEnabled: () => false, sessionExists: async () => true, replaceAgent,
      now: () => nowMs, nudgeAfterMs: 0,
    })
    try {
      await watchdog.poll()
      expect(replaceAgent).not.toHaveBeenCalled()
      expect(pasteFromFile).toHaveBeenCalledOnce()
    } finally { watchdog.stop() }
  })

  it('nudges an active agent after prolonged silence and logs it to the team feed', async () => {
    const watchdog = createWatchdog()
    await watchdog.poll()

    nowMs += 91_000
    await watchdog.poll()

    expect(pasteFromFile).toHaveBeenCalledWith('alpha-codex-1', path.resolve('tmp/watchdog/team-1/alpha-codex-1.txt'), { bracketed: false })
    expect(appended).toHaveLength(1)
    expect(appended[0].content).toContain('Watchdog nudged codex-1')
    watchdog.stop()
  })

  it('nudges with bracketed paste when the agent program asks for it', async () => {
    const watchdog = new AgentWatchdog({
      loadTeams: () => teams, getMessages: () => messages,
      appendMessage: (_teamId, message) => appended.push(message),
      getRuntime: () => ({ sendKeys, pasteFromFile, getForegroundCommand: async () => 'zsh' }),
      resolveAgentProgram: () => ({ inputMethod: 'sendKeys', bracketedPaste: true }),
      isSelf: () => true, getHostById: () => undefined,
      postRemoteSessionCommand, collabDeliveryFile: () => path.resolve('tmp/watchdog/nudge'),
      replacementEnabled: () => false, sessionExists: async () => true,
      now: () => nowMs, nudgeAfterMs: 0,
    })
    try {
      await watchdog.poll()
      expect(pasteFromFile).toHaveBeenCalledWith(expect.any(String), expect.any(String), { bracketed: true })
    } finally { watchdog.stop() }
  })

  it('leaves a finished agent alone even after later team messages', async () => {
    const watchdog = createWatchdog()
    messages.push(makeMessage({ content: '<<COLLAB_DONE>>' }))
    messages.push(makeMessage({ from: 'other-agent', content: 'Still checking' }))
    try {
      nowMs += 91_000
      await watchdog.poll()
      nowMs += 181_000
      await watchdog.poll()
      expect(pasteFromFile).not.toHaveBeenCalled()
      expect(appended).toEqual([])
    } finally { watchdog.stop() }
  })

  it('resumes monitoring when an agent posts content after its sentinel', async () => {
    const watchdog = createWatchdog()
    messages.push(makeMessage({ content: '<<COLLAB_DONE>>' }))
    try {
      await watchdog.poll()
      nowMs += 1_000
      messages.push(makeMessage({ content: 'Reopened the investigation', timestamp: new Date(nowMs).toISOString() }))
      await watchdog.poll()
      nowMs += 91_000
      await watchdog.poll()
      expect(pasteFromFile).toHaveBeenCalledTimes(1)
    } finally { watchdog.stop() }
  })

  it('marks an agent stalled when silence continues after the nudge', async () => {
    const watchdog = createWatchdog()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await watchdog.poll()
    nowMs += 91_000
    await watchdog.poll()

    nowMs += 181_000
    await watchdog.poll()

    expect(appended).toHaveLength(2)
    expect(appended[1].content).toContain('marked codex-1 as stalled')
    expect(warnSpy).toHaveBeenCalledWith('[Watchdog] Agent codex-1 in team team-1 stalled after watchdog nudge')
    watchdog.stop()
  })

  it('marks an unreachable agent failed so a surviving teammate remains eligible', async () => {
    teams = [makeTeam({ agents: [
      { agentId: 'agent-1', name: 'codex-1', program: 'codex', role: 'lead', hostId: 'local', status: 'active', startedAt: '2026-03-19T10:00:00.000Z' },
      { agentId: 'agent-2', name: 'claude-2', program: 'claude', role: 'member', hostId: 'local', status: 'active', startedAt: '2026-03-19T10:00:00.000Z' },
    ] })]
    pasteFromFile.mockImplementation(async (session: string) => {
      if (session.includes('codex-1')) throw new Error('AgentNotRunningError')
    })
    const watchdog = new AgentWatchdog({
      loadTeams: () => teams,
      markAgentFailed: (_id, name) => {
        teams[0].agents.find(agent => agent.name === name)!.status = 'failed'
      },
      getMessages: () => messages,
      appendMessage: (_teamId, message) => appended.push(message),
      getRuntime: () => ({ sendKeys, pasteFromFile }),
      resolveAgentProgram: () => ({ inputMethod: 'sendKeys' }),
      isSelf: () => true,
      getHostById: () => undefined,
      postRemoteSessionCommand,
      collabDeliveryFile: (teamId, sessionName) => path.resolve('tmp/watchdog', teamId, `${sessionName}.txt`),
      now: () => nowMs,
      pollIntervalMs: 60_000,
      nudgeAfterMs: 0,
      stallAfterMs: 180_000,
      maxFailedNudges: 1,
    })
    try {
      await watchdog.poll()
      expect(teams[0].agents[0].status).toBe('failed')
      expect(teams[0].agents[1].status).toBe('active')
    } finally { watchdog.stop() }
  })

  it('continues polling other teams when one team data source throws', async () => {
    const healthy = makeTeam({ id: 'healthy' })
    teams = [makeTeam({ id: 'broken' }), healthy]
    const getMessages = vi.fn((teamId: string) => {
      if (teamId === 'broken') throw new Error('corrupt feed')
      return [makeMessage({ teamId, timestamp: '2026-03-19T10:00:00.000Z' })]
    })
    const watchdog = new AgentWatchdog({
      loadTeams: () => teams,
      getMessages,
      appendMessage: (_teamId, message) => appended.push(message),
      getRuntime: () => ({ sendKeys, pasteFromFile }),
      resolveAgentProgram: () => ({ inputMethod: 'sendKeys' }),
      isSelf: () => true,
      getHostById: () => undefined,
      postRemoteSessionCommand,
      collabDeliveryFile: (teamId, sessionName) => path.resolve('tmp/watchdog', teamId, `${sessionName}.txt`),
      now: () => nowMs,
      pollIntervalMs: 60_000,
      nudgeAfterMs: 90_000,
      stallAfterMs: 180_000,
    })
    try {
      await watchdog.poll()
      expect(getMessages).toHaveBeenCalledWith('healthy')
    } finally { watchdog.stop() }
  })

  it('resets stall tracking when a new agent message arrives after a nudge', async () => {
    const watchdog = createWatchdog()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await watchdog.poll()
    nowMs += 91_000
    await watchdog.poll()

    messages = [
      ...messages,
      makeMessage({ id: 'msg-new', timestamp: new Date(nowMs + 1_000).toISOString(), content: 'Still working' }),
    ]
    nowMs += 2_000
    await watchdog.poll()

    // Advance 80s — below nudge threshold, so no new nudge and no stall
    nowMs += 80_000
    await watchdog.poll()

    expect(appended).toHaveLength(1) // only the original nudge
    expect(warnSpy).not.toHaveBeenCalled()
    watchdog.stop()
  })

  it('drops watchdog state for non-active teams so disbanded teams are no longer monitored', async () => {
    const watchdog = createWatchdog()

    await watchdog.poll()
    nowMs += 91_000
    await watchdog.poll()

    teams = []
    nowMs += 181_000
    await watchdog.poll()

    teams = [makeTeam()]
    await watchdog.poll()

    expect(appended).toHaveLength(2)
    expect(appended[0].content).toContain('Watchdog nudged codex-1')
    expect(appended[1].content).toContain('Watchdog nudged codex-1')
    expect(appended.some(message => message.content.includes('marked codex-1 as stalled'))).toBe(false)
    watchdog.stop()
  })

  it('reads watchdog thresholds from environment variables', () => {
    process.env.ENSEMBLE_WATCHDOG_NUDGE_MS = '1234'
    process.env.ENSEMBLE_WATCHDOG_STALL_MS = '5678'

    expect(getWatchdogNudgeMs()).toBe(1234)
    expect(getWatchdogStallMs()).toBe(5678)
  })
})
