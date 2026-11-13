/**
 * scripts/collab-review.sh with a stand-in codex on PATH: verdict on success, retry on
 * "Selected model is at capacity" (bench #4 and #12, 30.10.), error.txt otherwise; .done last.
 */
import { execFileSync, spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, expect, it } from 'vitest'

const SCRIPT = path.resolve(process.cwd(), 'scripts/collab-review.sh')
const CHECK = path.resolve(process.cwd(), 'scripts/verdict-check.sh')
let root: string, work: string, dir: string, bin: string, base: string

// Fails with the capacity message as often as FAKE_CAPACITY says, then writes the verdict to -o.
const FAKE_CODEX = `#!/usr/bin/env bash
n=$(cat "$FAKE_COUNT" 2>/dev/null || echo 0); echo $((n + 1)) > "$FAKE_COUNT"
cat > "$FAKE_PROMPT"
printf '%s\\n' "$@" > "$FAKE_ARGS.$n"
case " $* " in *" --ignore-user-config "*) [ -n "\${FAKE_REJECT_ISOLATION:-}" ] && { echo "error: unexpected argument '--ignore-user-config' found"; exit 2; };; esac
if [ "$n" -lt "\${FAKE_CAPACITY:-0}" ]; then echo "ERROR: Selected model is at capacity. Please try a different model."; exit 1; fi
[ -n "\${FAKE_EDIT:-}" ] && echo 'module.exports = 3' > "$FAKE_EDIT"
while [ "$#" -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done
printf 'VERDICT: ACCEPTED\\n' > "$out"
`

function run(env: Record<string, string> = {}) {
  return spawnSync('bash', [SCRIPT, dir, work, base], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, COLLAB_REVIEW_RETRY_S: '0',
      FAKE_COUNT: path.join(root, 'count'), FAKE_PROMPT: path.join(root, 'prompt.seen'), FAKE_ARGS: path.join(root, 'args'),
      // The reviewer's model comes from this stand-in Codex home, not from the developer's own.
      CODEX_HOME: path.join(root, 'codex-home'), COLLAB_REVIEW_ISOLATED: '1', COLLAB_REVIEW_MODEL: '', COLLAB_REVIEW_EFFORT: '', ...env },
  })
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-review-'))
  work = path.join(root, 'work'); dir = path.join(root, 'review'); bin = path.join(root, 'bin')
  for (const d of [work, dir, bin]) fs.mkdirSync(d)
  fs.writeFileSync(path.join(bin, 'codex'), FAKE_CODEX, { mode: 0o755 })
  fs.mkdirSync(path.join(root, 'codex-home'))
  fs.writeFileSync(path.join(root, 'codex-home', 'config.toml'),
    'model = "gpt-test"\nmodel_reasoning_effort = "high"\n\n[mcp_servers.x]\ncommand = "x"\n')
  const git = (...args: string[]) => execFileSync('git', ['-C', work, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim()
  git('init', '-q')
  fs.writeFileSync(path.join(work, 'a.js'), 'module.exports = 1\n')
  git('add', '.'); git('commit', '-qm', 'base')
  base = git('rev-parse', 'HEAD')
  fs.writeFileSync(path.join(work, 'a.js'), 'module.exports = 2\n')
  fs.writeFileSync(path.join(dir, 'task.md'), '# Aufgabe\nSetze den Wert auf 2.\n')
})

afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

it('writes the verdict for the diff since the base commit', () => {
  const r = run()
  expect(r.status).toBe(0)
  expect(fs.readFileSync(path.join(dir, 'verdict.raw.txt'), 'utf8')).toBe('VERDICT: ACCEPTED\n')
  // The stand-in verdict cites nothing: the appended citation check marks the acceptance as unproven.
  const verdict = fs.readFileSync(path.join(dir, 'verdict.txt'), 'utf8')
  expect(verdict.startsWith('VERDICT: ACCEPTED\n')).toBe(true)
  expect(verdict).toContain('grounding: ungrounded')
  expect(verdict).toContain('gilt als nicht geprüft')
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'grounding.json'), 'utf8')).acceptedUnproven).toBe(true)
  expect(fs.existsSync(path.join(dir, '.done'))).toBe(true)
  const prompt = fs.readFileSync(path.join(root, 'prompt.seen'), 'utf8')
  expect(prompt).toContain('Setze den Wert auf 2.')
  expect(prompt).toContain('+module.exports = 2')
  expect(prompt).toContain('verify-deliverable')
})

it('retries while the model is at capacity', () => {
  const r = run({ FAKE_CAPACITY: '2' })
  expect(r.status).toBe(0)
  expect(fs.readFileSync(path.join(root, 'count'), 'utf8').trim()).toBe('3')
  expect(fs.existsSync(path.join(dir, 'codex.capacity-1.log'))).toBe(true)
  expect(fs.existsSync(path.join(dir, 'verdict.txt'))).toBe(true)
})

it('gives up after three attempts and leaves error.txt', () => {
  const r = run({ FAKE_CAPACITY: '5' })
  expect(r.status).toBe(1)
  expect(fs.readFileSync(path.join(root, 'count'), 'utf8').trim()).toBe('3')
  expect(fs.existsSync(path.join(dir, 'verdict.txt'))).toBe(false)
  expect(fs.readFileSync(path.join(dir, 'error.txt'), 'utf8')).toMatch(/ohne Verdict/)
  expect(fs.existsSync(path.join(dir, '.done'))).toBe(true)
})

it('binds the verdict to the checksum of the reviewed change; verdict-check tells when it went stale', () => {
  expect(run().status).toBe(0)
  const { binding } = JSON.parse(fs.readFileSync(path.join(dir, 'grounding.json'), 'utf8'))
  expect(binding.changeSha256).toMatch(/^[0-9a-f]{64}$/)
  expect(binding.bundleSha256).toMatch(/^[0-9a-f]{64}$/)
  expect(binding.current).toBe(true)
  const verdict = fs.readFileSync(path.join(dir, 'verdict.txt'), 'utf8')
  expect(verdict).toContain(`Geprüfter Stand: Änderung sha256 ${binding.changeSha256.slice(0, 12)}`)
  expect(verdict).not.toContain('ACHTUNG')

  const same = spawnSync('bash', [CHECK, dir], { encoding: 'utf8' })
  expect(same.status).toBe(0)
  expect(same.stdout).toContain('aktuell')

  fs.writeFileSync(path.join(work, 'a.js'), 'module.exports = 4\n')
  const moved = spawnSync('bash', [CHECK, dir], { encoding: 'utf8' })
  expect(moved.status).toBe(1)
  expect(moved.stdout).toContain(`veraltet: geprüft wurde ${binding.changeSha256.slice(0, 12)}`)
  // A new untracked file is a change too.
  fs.writeFileSync(path.join(work, 'a.js'), 'module.exports = 2\n')
  expect(spawnSync('bash', [CHECK, dir], { encoding: 'utf8' }).status).toBe(0)
  fs.writeFileSync(path.join(work, 'neu.txt'), 'neu\n')
  expect(spawnSync('bash', [CHECK, dir], { encoding: 'utf8' }).status).toBe(1)
})

it('says so in the verdict when the work tree changed while the review ran', () => {
  expect(run({ FAKE_EDIT: path.join(work, 'a.js') }).status).toBe(0)
  const { binding } = JSON.parse(fs.readFileSync(path.join(dir, 'grounding.json'), 'utf8'))
  expect(binding.current).toBe(false)
  expect(binding.currentChangeSha256).not.toBe(binding.changeSha256)
  const verdict = fs.readFileSync(path.join(dir, 'verdict.txt'), 'utf8')
  expect(verdict).toContain('ACHTUNG: Der Arbeitsordner hat sich seit dem Bau des Bündels geändert')
  expect(verdict).toContain('gilt für den älteren Stand')
})

it('verdict-check cannot tell without a binding', () => {
  const r = spawnSync('bash', [CHECK, dir], { encoding: 'utf8' })
  expect(r.status).toBe(2)
  expect(r.stderr).toContain('keine Bindung')
})

const args = (n: number) => fs.readFileSync(path.join(root, `args.${n}`), 'utf8').trim().split('\n')

it('starts the reviewer without user config, apps and memories, but with the configured model', () => {
  expect(run().status).toBe(0)
  const a = args(0)
  for (const flag of ['--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only']) expect(a).toContain(flag)
  expect(a.join(' ')).toContain('--disable apps --disable memories -m gpt-test -c model_reasoning_effort="high"')
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'reviewer.json'), 'utf8'))).toMatchObject({ isolated: true, model: 'gpt-test', effort: 'high' })
})

it('COLLAB_REVIEW_MODEL overrides the configured model; a missing config passes none', () => {
  expect(run({ COLLAB_REVIEW_MODEL: 'gpt-other' }).status).toBe(0)
  expect(args(0).join(' ')).toContain('-m gpt-other')
  fs.rmSync(path.join(root, 'codex-home'), { recursive: true })
  fs.rmSync(dir, { recursive: true }); fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'task.md'), '# Aufgabe\n')
  expect(run().status).toBe(0)
  expect(args(1)).toContain('--ignore-user-config')
  expect(args(1)).not.toContain('-m')
})

it('COLLAB_REVIEW_ISOLATED=0 starts the reviewer the plain way', () => {
  expect(run({ COLLAB_REVIEW_ISOLATED: '0' }).status).toBe(0)
  expect(args(0)).not.toContain('--ignore-user-config')
  expect(args(0)).not.toContain('-m')
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'reviewer.json'), 'utf8')).isolated).toBe(false)
})

it('falls back to the plain start when Codex rejects the isolation arguments', () => {
  const r = run({ FAKE_REJECT_ISOLATION: '1' })
  expect(r.status).toBe(0)
  expect(args(0)).toContain('--ignore-user-config')
  expect(args(1)).not.toContain('--ignore-user-config')
  expect(fs.readFileSync(path.join(dir, 'verdict.raw.txt'), 'utf8')).toBe('VERDICT: ACCEPTED\n')
  expect(fs.readFileSync(path.join(dir, 'codex.isolated-failed.log'), 'utf8')).toContain('unexpected argument')
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'reviewer.json'), 'utf8')).isolated).toBe('fallback')
})
