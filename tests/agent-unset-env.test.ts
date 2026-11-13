import fs from 'fs'
import path from 'path'
import { afterEach, expect, it, vi } from 'vitest'
import { clearAgentsConfigCache, loadAgentsConfig } from '../lib/agent-config'

let root: string | undefined
afterEach(() => {
  vi.unstubAllEnvs()
  clearAgentsConfigCache()
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = undefined
})

it('loads agy with its startup and input configuration while retaining gemini', () => {
  vi.stubEnv('ENSEMBLE_AGENTS_CONFIG', path.resolve('agents.json'))
  const config = loadAgentsConfig()
  expect(config.agy).toEqual({
    name: 'agy', command: 'agy', flags: ['--dangerously-skip-permissions'],
    readyMarker: '? for shortcuts', inputMethod: 'sendKeys', bracketedPaste: true, color: 'red', icon: '▲',
    // agy runs on the plan login only; provider keys the spawner forwards stay out.
    unsetEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'NVIDIA_API_KEY'],
    teamRole: { role: 'RESEARCHER/GRILLER', focus: expect.stringContaining('you do not write code') },
  })
  expect(config.gemini.command).toBe('gemini')
})

it.each([
  ['lowercase'], ['1INVALID'], ['BAD-NAME'], ['X;touch bad'], ['KEY\n'], [42],
  'GEMINI_API_KEY', null, {},
].map(unsetEnv => [unsetEnv]))('rejects invalid unsetEnv: %j', unsetEnv => {
  root = fs.mkdtempSync(path.resolve('tmp/unset-env-'))
  const file = path.join(root, 'agents.json')
  fs.writeFileSync(file, JSON.stringify({ probe: { name: 'probe', unsetEnv } }))
  vi.stubEnv('ENSEMBLE_AGENTS_CONFIG', file)
  expect(() => loadAgentsConfig()).toThrow(/unsetEnv/)
  // A rejected configuration must not become the cached configuration.
  expect(() => loadAgentsConfig()).toThrow(/unsetEnv/)
})

it('accepts uppercase names, underscores and digits, and empty or absent lists', () => {
  root = fs.mkdtempSync(path.resolve('tmp/unset-env-'))
  const file = path.join(root, 'agents.json')
  const config = { probe: { unsetEnv: ['_KEY_2', 'A'] }, empty: { unsetEnv: [] }, absent: {} }
  fs.writeFileSync(file, JSON.stringify(config))
  vi.stubEnv('ENSEMBLE_AGENTS_CONFIG', file)
  expect(loadAgentsConfig()).toEqual(config)
})

it.each([['yes'], [1], [null]])('rejects invalid bracketedPaste: %j', bracketedPaste => {
  root = fs.mkdtempSync(path.resolve('tmp/unset-env-'))
  const file = path.join(root, 'agents.json')
  fs.writeFileSync(file, JSON.stringify({ probe: { name: 'probe', bracketedPaste } }))
  vi.stubEnv('ENSEMBLE_AGENTS_CONFIG', file)
  expect(() => loadAgentsConfig()).toThrow(/bracketedPaste/)
})

it('loads the MiMo CLI contract', () => {
  vi.stubEnv('ENSEMBLE_AGENTS_CONFIG', path.resolve('agents.json'))
  expect(loadAgentsConfig().mimo).toEqual({ name: 'mimo', command: 'mimo', flags: ['--trust', '--dangerously-skip-permissions'], readyMarker: 'Type your message', inputMethod: 'pasteFromFile', color: 'cyan', icon: '◇' })
})
