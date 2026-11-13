/**
 * scripts/verdict-grounding.py: file:line citations of a blind review verdict are compared with
 * the bundle of scripts/review-bundle.sh and the work tree. No model, no agent run.
 */
import { execFileSync, spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, expect, it } from 'vitest'

const SCRIPT = path.resolve(process.cwd(), 'scripts/verdict-grounding.py')
const BUNDLE = path.resolve(process.cwd(), 'scripts/review-bundle.sh')
let root: string, work: string, bundle: string

function ground(lines: string[], withWork = true) {
  const verdict = path.join(root, 'verdict.txt'), out = path.join(root, 'grounding.json')
  fs.writeFileSync(verdict, lines.join('\n') + '\n')
  const r = spawnSync('python3', ['-I', SCRIPT, verdict, bundle, ...(withWork ? ['--work', work] : []), '--json', out], { encoding: 'utf8' })
  expect(r.stderr).toBe('')
  expect(r.status).toBe(0)
  return { note: r.stdout, result: JSON.parse(fs.readFileSync(out, 'utf8')) }
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-'))
  work = path.join(root, 'work'); bundle = path.join(root, 'bundle.md')
  fs.mkdirSync(path.join(work, 'src'), { recursive: true })
  const git = (...args: string[]) => execFileSync('git', ['-C', work, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim()
  git('init', '-q')
  const body = Array.from({ length: 40 }, (_, i) => `const line${i + 1} = ${i + 1}`)
  fs.writeFileSync(path.join(work, 'src', 'dates.js'), body.join('\n') + '\n')
  fs.writeFileSync(path.join(work, 'README.md'), '# Projekt\nzweite Zeile\n')
  git('add', '.'); git('commit', '-qm', 'base')
  const base = git('rev-parse', 'HEAD')
  body[19] = 'const line20 = daysBetween(a, b) + 1'
  fs.writeFileSync(path.join(work, 'src', 'dates.js'), body.join('\n') + '\n')
  fs.writeFileSync(path.join(work, 'notes.txt'), 'neu\n')
  // The task text carries its own "## 3." heading and a fence: the diff section must survive that.
  fs.writeFileSync(path.join(root, 'task.md'), '# Aufgabe\n## 3. Automatic final check\n```\nnpm test\n```\n')
  fs.writeFileSync(bundle, execFileSync('bash', [BUNDLE, work, path.join(root, 'task.md'), '--base', base], { encoding: 'utf8' }))
})

afterAll(() => { fs.rmSync(root, { recursive: true, force: true }) })

it('grounded: citations in the diff, by full path, by unique file name and for a new file', () => {
  const { note, result } = ground([
    'VERDICT: ACCEPTED', 'blind: yes', 'criteria:',
    '  - Off-by-one behoben: met — src/dates.js:20 `daysBetween(a, b) + 1`',
    '  - Test grün: met — dates.js:18-21',
    '  - Notiz: met — ./notes.txt:1',
  ])
  expect(result.status).toBe('grounded')
  expect(result.citations).toEqual({ total: 3, inDiff: 3, outsideDiff: 0, notInDiff: 0, wrong: 0 })
  expect(result.quotes).toEqual({ checked: 1, missing: 0 })
  expect(result.acceptedUnproven).toBe(false)
  expect(note).toContain('grounding: grounded')
  // Bound to the bundle it was checked against; without a later bundle "current" stays open.
  expect(result.binding.changeSha256).toMatch(/^[0-9a-f]{64}$/)
  expect(result.binding.current).toBeNull()
  expect(note).toContain(`Geprüfter Stand: Änderung sha256 ${result.binding.changeSha256.slice(0, 12)}`)
})

it('invalid: a file that does not exist or a line past the end of the file', () => {
  const missing = ground(['VERDICT: ACCEPTED', '  - x: met — src/dates.js:20', '  - y: met — src/gibtsnicht.js:5'])
  expect(missing.result.status).toBe('invalid')
  expect(missing.result.details[0]).toMatchObject({ cite: 'src/gibtsnicht.js:5', result: 'unknown_file' })
  expect(missing.note).toContain('falsch: src/gibtsnicht.js:5')
  const past = ground(['VERDICT: CHANGES_REQUESTED', '  - x: not met — src/dates.js:999'])
  expect(past.result.status).toBe('invalid')
  expect(past.result.details[0]).toMatchObject({ result: 'bad_line', detail: 'Datei hat 40 Zeilen' })
})

it('ungrounded: an acceptance without a citation in the diff counts as unproven', () => {
  const bare = ground(['VERDICT: ACCEPTED', 'blind: yes', 'findings:', '  - keine'])
  expect(bare.result).toMatchObject({ status: 'ungrounded', acceptedUnproven: true })
  expect(bare.note).toContain('gilt als nicht geprüft')
  // A real file outside the change and a line the reviewer could not see are warnings, not proof.
  const outside = ground(['VERDICT: ACCEPTED', '  - a: met — README.md:1', '  - b: met — src/dates.js:38'])
  expect(outside.result.status).toBe('ungrounded')
  expect(outside.result.citations).toMatchObject({ notInDiff: 1, outsideDiff: 1, wrong: 0 })
  // A rejection without citations is ungrounded too, but nothing was accepted on trust.
  expect(ground(['VERDICT: REJECTED']).result.acceptedUnproven).toBe(false)
})

it('a quoted snippet that occurs nowhere is a warning and keeps the status', () => {
  const { note, result } = ground(['VERDICT: CHANGES_REQUESTED', '  - x: not met — src/dates.js:20 `return totallyInvented()`'])
  expect(result.status).toBe('grounded')
  expect(result.missingQuotes).toEqual(['return totallyInvented()'])
  expect(note).toContain('Zitat nicht gefunden')
})

it('without --work the diff alone decides; times, URLs and versions are not citations', () => {
  const { result } = ground([
    'VERDICT: ACCEPTED', '  - x: met — src/dates.js:20',
    'final_check: PASS um 12:30, siehe http://example.com:8080/a.js:1 und v1.2:3',
  ], false)
  expect(result.status).toBe('grounded')
  expect(result.citations.total).toBe(1)
  expect(result.workChecked).toBe(false)
})

it('exits 2 when the verdict cannot be read', () => {
  const r = spawnSync('python3', ['-I', SCRIPT, path.join(root, 'fehlt.txt'), bundle], { encoding: 'utf8' })
  expect(r.status).toBe(2)
})
