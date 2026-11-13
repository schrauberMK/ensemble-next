/**
 * The ready marker must stay on screen before the prompt goes in. Codex 0.166 shows its
 * input line while loading and only then "Trust this folder?"; the prompt pasted into that
 * dialog quit Codex (pane log of test run T1 A 0, 30.10.).
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const COMPOSER = '>_ OpenAI Codex (v0.166.0)\n  loading\n› Ask Codex to do anything\n  ? for shortcuts'
const TRUST = [
  '  Trust this folder? Codex can read, edit, and run files here, subject to your',
  '  permission settings. Continue only if you trust these files.',
  '› 1. Trust and continue',
  '  2. Quit',
  '  enter continue · esc quit',
].join('\n')

let root: string
let screens: string[]
let foreground: string[]
const sendKeys = vi.fn(async (_name: string, _keys: string, _opts?: unknown) => {})

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-settle-'))
  vi.stubEnv('COLLAB_RUNTIME_ROOT', root)
  vi.stubEnv('ENSEMBLE_DATA_DIR', path.join(root, 'data'))
  vi.stubEnv('ENSEMBLE_READY_SETTLE_MS', '') // vitest.config sets 0; these cases check the default
  vi.useFakeTimers()
  vi.resetModules()
  sendKeys.mockClear()
  // Each capture shows the next screen; the last one stays.
  const next = (list: string[]) => (list.length > 1 ? list.shift()! : list[0])
  vi.doMock('../lib/agent-runtime', () => ({
    getRuntime: () => ({
      getForegroundCommand: async () => next(foreground),
      capturePane: async () => next(screens),
      sendKeys,
    }),
  }))
  vi.doMock('../lib/hosts-config', () => ({ isSelf: () => true, getSelfHostId: () => 'local', getHostById: vi.fn() }))
  vi.doMock('../lib/agent-watchdog', () => ({ AgentWatchdog: class { stop() {} } }))
  vi.doMock('../lib/memory-export', () => ({
    checkMemoryEndpoint: async () => ({ ok: true, endpoint: 'disabled-in-test' }),
    exportObservation: async () => ({ ok: true }),
  }))
})

afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules()
  for (const name of ['agent-runtime', 'hosts-config', 'agent-watchdog', 'memory-export']) vi.doUnmock(`../lib/${name}`)
  fs.rmSync(root, { recursive: true, force: true })
})

it('confirms a trust dialog that appears after the ready marker, then reports ready', async () => {
  screens = [COMPOSER, TRUST, TRUST, COMPOSER]
  foreground = ['codex']
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const { __testing } = await import('../services/ensemble-service')
  expect(__testing.READY_SETTLE_MS).toBe(2_000)
  const ready = __testing.waitForReady('t-codex-1', 'codex', 'local')
  await vi.advanceTimersByTimeAsync(20_000)
  expect(await ready).toBe(true)
  expect(sendKeys).toHaveBeenCalledWith('t-codex-1', 'Enter')
})

it('does not report ready when the agent CLI quits after showing the marker', async () => {
  screens = [COMPOSER]
  foreground = ['codex', 'bash']
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { __testing } = await import('../services/ensemble-service')
  const ready = __testing.waitForReady('t-codex-1', 'codex', 'local')
  await vi.advanceTimersByTimeAsync(20_000)
  expect(await ready).toBe(false)
  expect(sendKeys).not.toHaveBeenCalled()
})

it('reports ready once the marker has stayed for the settle time', async () => {
  screens = [COMPOSER]
  foreground = ['codex']
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const { __testing } = await import('../services/ensemble-service')
  let done = false
  const ready = __testing.waitForReady('t-codex-1', 'codex', 'local').then(r => { done = true; return r })
  await vi.advanceTimersByTimeAsync(1_000)
  expect(done).toBe(false)
  await vi.advanceTimersByTimeAsync(5_000)
  expect(await ready).toBe(true)
})
