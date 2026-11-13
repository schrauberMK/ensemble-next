/**
 * Pane log: an agent CLI that quits at startup clears its screen, so the raw pane output
 * is recorded from the spawn on (Codex in test run T1 A 0, 29.10.).
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let root: string
const pipe = vi.fn(async (_name: string, _file: string) => {})
let withPipe = true

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pane-log-'))
  vi.stubEnv('COLLAB_RUNTIME_ROOT', root)
  vi.resetModules()
  pipe.mockReset()
  withPipe = true
  vi.doMock('../lib/agent-runtime', () => ({
    getRuntime: () => (withPipe ? { pipePaneToFile: pipe } : {}),
  }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock('../lib/agent-runtime')
  vi.resetModules()
  fs.rmSync(root, { recursive: true, force: true })
})

it('pipes the pane into a private file under the runtime root', async () => {
  const { startPaneLog } = await import('../lib/agent-spawner')
  const file = await startPaneLog('collabnext-1-codex-1')
  expect(file).toBe(path.join(root, 'panes', 'collabnext-1-codex-1.log'))
  expect(pipe).toHaveBeenCalledWith('collabnext-1-codex-1', file)
  expect(fs.statSync(file!).mode & 0o777).toBe(0o600)
})

it('can be switched off with ENSEMBLE_PANE_LOG=0', async () => {
  vi.stubEnv('ENSEMBLE_PANE_LOG', '0')
  const { startPaneLog } = await import('../lib/agent-spawner')
  expect(await startPaneLog('s')).toBeNull()
  expect(pipe).not.toHaveBeenCalled()
})

it('skips runtimes without pipe-pane and never throws when piping fails', async () => {
  withPipe = false
  const { startPaneLog } = await import('../lib/agent-spawner')
  expect(await startPaneLog('s')).toBeNull()

  withPipe = true
  pipe.mockRejectedValueOnce(new Error('no server running'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await startPaneLog('s')).toBeNull()
})
