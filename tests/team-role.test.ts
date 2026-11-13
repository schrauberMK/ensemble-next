import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearAgentsConfigCache, loadAgentsConfig } from '../lib/agent-config'
import { buildPromptPreview, resolveTeamRole } from '../services/ensemble-service'

// agy joins teams as researcher/griller. The role lives on the program in
// agents.json, so it holds with or without a template and for any position
// after the lead; a template role at that position still wins.

const base = { teamId: 't', teamName: 't', description: 'Review the plan', teammateNames: ['codex-1', 'claude-2'] }
let root: string | undefined

beforeEach(() => {
  vi.stubEnv('ENSEMBLE_AGENTS_CONFIG', path.resolve('agents.json'))
  clearAgentsConfigCache()
})
afterEach(() => {
  vi.unstubAllEnvs()
  clearAgentsConfigCache()
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = undefined
})

it('gives agy the researcher/griller role as third teammate without a template', () => {
  const prompt = buildPromptPreview({ ...base, agentName: 'agy-3', agentIndex: 2, program: 'agy' })
  expect(prompt).toContain('ROLE: RESEARCHER/GRILLER.')
  expect(prompt).toContain('you do not write code and do not edit files')
  expect(prompt).not.toContain('ROLE: WORKER.')
})

it('gives agy the role after a two-role template too', () => {
  expect(resolveTeamRole({ agentIndex: 2, templateName: 'review', program: 'agy' })?.role).toBe('RESEARCHER/GRILLER')
})

it('lets a template role at the same position win over the program role', () => {
  expect(resolveTeamRole({ agentIndex: 1, templateName: 'review', program: 'agy' })?.role).toBe('CRITIC')
})

it('keeps agy as a normal lead when it is listed first', () => {
  const prompt = buildPromptPreview({ ...base, agentName: 'agy-1', agentIndex: 0, program: 'agy' })
  expect(prompt).toContain('ROLE: LEAD.')
  expect(resolveTeamRole({ agentIndex: 0, program: 'agy' })).toBeUndefined()
})

it('leaves programs without a teamRole on the generic worker role', () => {
  const prompt = buildPromptPreview({ ...base, agentName: 'claude-2', agentIndex: 1, program: 'claude' })
  expect(prompt).toContain('ROLE: WORKER.')
})

it.each([['text'], [{ role: 'X' }], [{ role: '', focus: 'f' }], [{ role: 'X', focus: 3 }], [null]])('rejects invalid teamRole: %j', teamRole => {
  root = fs.mkdtempSync(path.resolve('tmp/team-role-'))
  const file = path.join(root, 'agents.json')
  fs.writeFileSync(file, JSON.stringify({ probe: { name: 'probe', teamRole } }))
  vi.stubEnv('ENSEMBLE_AGENTS_CONFIG', file)
  expect(() => loadAgentsConfig()).toThrow(/teamRole/)
})
