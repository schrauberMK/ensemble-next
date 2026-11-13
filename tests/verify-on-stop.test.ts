import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync, execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(__dirname, '..', 'hooks', 'verify-on-stop.cjs')

// Without the guard variable: this suite may itself run inside the hook's checks.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { ENSEMBLE_VERIFY_RUNNING: _guard, ...BASE_ENV } = process.env

let repo: string
let runtime: string

function git(...args: string[]) {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
}

function writePkg(scripts: Record<string, string>) {
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 't', private: true, scripts }, null, 2))
}

function runHook(extra: Record<string, unknown> = {}, env: Record<string, string> = {}) {
  const res = spawnSync('node', [HOOK], {
    input: JSON.stringify({ session_id: 'sess-1', cwd: repo, hook_event_name: 'Stop', ...extra }),
    encoding: 'utf8',
    // Vitest keeps os.tmpdir() inside this repo; the ceiling stops git from finding it.
    env: { ...BASE_ENV, COLLAB_RUNTIME_ROOT: runtime, TMUX: '', GIT_CEILING_DIRECTORIES: path.dirname(runtime), ...env },
  })
  const out = res.stdout.trim()
  return { code: res.status, out: out ? JSON.parse(out) : null }
}

function record() {
  return JSON.parse(fs.readFileSync(path.join(runtime, 'verify', 'sess-1.json'), 'utf8'))
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-repo-'))
  runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-rt-'))
  git('init', '-q')
  git('config', 'user.email', 't@example.invalid')
  git('config', 'user.name', 't')
  // The test passes only when note.txt says "hallo".
  writePkg({ test: `node -e "process.exit(require('fs').readFileSync('note.txt','utf8').trim()==='hallo'?0:1)"` })
  fs.writeFileSync(path.join(repo, 'note.txt'), 'hallo\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
})

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
  fs.rmSync(runtime, { recursive: true, force: true })
})

describe('verify-on-stop hook', () => {
  it('records NO_CHANGES and stays silent on a clean tree', () => {
    const r = runHook()
    expect(r.code).toBe(0)
    expect(r.out).toBeNull()
    expect(record().status).toBe('NO_CHANGES')
  })

  it('negative test: a failing project check blocks the stop', () => {
    fs.writeFileSync(path.join(repo, 'note.txt'), 'x\n')
    const r = runHook()
    expect(r.code).toBe(0)
    expect(r.out.decision).toBe('block')
    expect(r.out.reason).toContain('npm run test: FAIL')
    expect(r.out.reason).toContain('nicht als READY_FOR_REVIEW')
    const rec = record()
    expect(rec.status).toBe('FAIL')
    expect(rec.unresolved).toBe(true)
    expect(rec.changedFiles).toEqual(['note.txt'])
  })

  it('catches failures in new untracked files, not only in tracked diffs', () => {
    writePkg({ test: `node -e "process.exit(require('fs').existsSync('neu.txt')?1:0)"` })
    git('add', '-A')
    git('commit', '-q', '-m', 'pkg')
    fs.writeFileSync(path.join(repo, 'neu.txt'), 'neu\n')
    const r = runHook()
    expect(r.out?.decision).toBe('block')
    expect(record().changedFiles).toEqual(['neu.txt'])
  })

  it('passes silently once the change is fixed', () => {
    fs.writeFileSync(path.join(repo, 'note.txt'), 'x\n')
    expect(runHook().out.decision).toBe('block')
    fs.writeFileSync(path.join(repo, 'note.txt'), 'hallo\n')
    fs.writeFileSync(path.join(repo, 'extra.txt'), 'ok\n')
    const r = runHook({ stop_hook_active: true })
    expect(r.out).toBeNull()
    const rec = record()
    expect(rec.status).toBe('PASS')
    expect(rec.checks.map((c: { status: string }) => c.status)).toEqual(['PASS'])
  })

  it('stamps stoppedAt on every stop, also when it reuses the result of an unchanged change set', async () => {
    fs.writeFileSync(path.join(repo, 'extra.txt'), 'ok\n')
    expect(runHook().out).toBeNull()
    const first = record()
    expect(first.status).toBe('PASS')
    expect(first.stoppedAt).toBe(first.checkedAt)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(runHook().out).toBeNull()
    const second = record()
    expect(second.checkedAt).toBe(first.checkedAt)
    expect(Date.parse(second.stoppedAt)).toBeGreaterThan(Date.parse(first.stoppedAt))
  })

  it('stops blocking after the block budget for the same change set, but keeps it unresolved', () => {
    fs.writeFileSync(path.join(repo, 'note.txt'), 'x\n')
    const env = { ENSEMBLE_VERIFY_MAX_BLOCKS: '2' }
    expect(runHook({}, env).out.decision).toBe('block')
    expect(runHook({ stop_hook_active: true }, env).out.decision).toBe('block')
    const third = runHook({ stop_hook_active: true }, env)
    expect(third.out.decision).toBeUndefined()
    expect(third.out.systemMessage).toContain('ungelöst')
    const rec = record()
    expect(rec.status).toBe('FAIL')
    expect(rec.blocks).toBe(2)
    expect(rec.unresolved).toBe(true)
  })

  describe('rework limits across change sets', () => {
    // The test prints the file content, so a different wrong content is a different failure.
    const PRINTING = `node -e "const t=require('fs').readFileSync('note.txt','utf8').trim();console.log('got '+t);process.exit(t==='hallo'?0:1)"`
    const edit = (text: string) => fs.writeFileSync(path.join(repo, 'note.txt'), text + '\n')
    function printing() {
      writePkg({ test: PRINTING })
      git('add', '-A')
      git('commit', '-q', '-m', 'printing test')
    }

    it('max rounds: a new failing change set no longer blocks once the total is used up', () => {
      printing()
      const env = { ENSEMBLE_VERIFY_MAX_ROUNDS: '3', ENSEMBLE_VERIFY_STALL_ROUNDS: '0' }
      edit('a')
      const first = runHook({}, env)
      expect(first.out.reason).toContain('Nacharbeitsrunde 1/3.')
      edit('b')
      expect(runHook({}, env).out.decision).toBe('block')
      edit('c')
      const third = runHook({}, env)
      expect(third.out.decision).toBe('block')
      expect(third.out.reason).toContain('Nacharbeitsrunde 3/3. Das ist die letzte')
      edit('d')
      const fourth = runHook({}, env)
      expect(fourth.out.decision).toBeUndefined()
      expect(fourth.out.systemMessage).toContain('3 Nacharbeitsrunden erreicht')
      expect(record()).toMatchObject({ status: 'FAIL', unresolved: true, stopReason: 'max_rounds', rounds: 3, blocks: 0 })
      // A later stop on the same stand stays silent about blocking and keeps the reason.
      expect(runHook({}, env).out.decision).toBeUndefined()
      expect(record().stopReason).toBe('max_rounds')
    })

    it('rounds also count the repeated blocks of one change set', () => {
      printing()
      const env = { ENSEMBLE_VERIFY_MAX_ROUNDS: '2', ENSEMBLE_VERIFY_STALL_ROUNDS: '0' }
      edit('a')
      expect(runHook({}, env).out.decision).toBe('block')
      expect(runHook({}, env).out.decision).toBe('block')
      const third = runHook({}, env)
      expect(third.out.decision).toBeUndefined()
      expect(record()).toMatchObject({ stopReason: 'max_rounds', rounds: 2, blocks: 2 })
    })

    it('no progress: edits that leave the failure output unchanged end the rework', () => {
      // The default fixture test prints nothing, so every wrong content fails identically.
      const env = { ENSEMBLE_VERIFY_STALL_ROUNDS: '2' }
      edit('a')
      expect(runHook({}, env).out.decision).toBe('block')
      edit('b')
      expect(runHook({}, env).out.decision).toBe('block')
      expect(record().stall).toBe(1)
      edit('c')
      const third = runHook({}, env)
      expect(third.out.decision).toBeUndefined()
      expect(third.out.systemMessage).toContain('ohne Wirkung auf den Fehler')
      expect(record()).toMatchObject({ stopReason: 'no_progress', rounds: 2, unresolved: true })
    })

    it('a changed failure counts as progress and keeps the rework going', () => {
      printing()
      const env = { ENSEMBLE_VERIFY_STALL_ROUNDS: '2' }
      for (const text of ['a', 'b', 'c', 'd']) {
        edit(text)
        expect(runHook({}, env).out.decision).toBe('block')
        expect(record().stall).toBe(0)
      }
    })

    it('max minutes: counted from the first failing check', () => {
      printing()
      const env = { ENSEMBLE_VERIFY_MAX_MINUTES: '10' }
      edit('a')
      expect(runHook({}, env).out.decision).toBe('block')
      const file = path.join(runtime, 'verify', 'sess-1.json')
      const rec = record()
      fs.writeFileSync(file, JSON.stringify({ ...rec, firstFailAt: new Date(Date.now() - 11 * 60_000).toISOString() }))
      edit('b')
      const late = runHook({}, env)
      expect(late.out.decision).toBeUndefined()
      expect(late.out.systemMessage).toContain('10 Minuten Nacharbeit erreicht')
      expect(record().stopReason).toBe('max_minutes')
    })

    it('a passing check resets the limits for later work in the same session', () => {
      printing()
      const env = { ENSEMBLE_VERIFY_MAX_ROUNDS: '1', ENSEMBLE_VERIFY_STALL_ROUNDS: '0' }
      edit('a')
      expect(runHook({}, env).out.decision).toBe('block')
      edit('hallo')
      expect(runHook({}, env).out).toBeNull()
      expect(record()).toMatchObject({ status: 'NO_CHANGES' })
      edit('b')
      expect(runHook({}, env).out.decision).toBe('block')
      expect(record().rounds).toBe(1)
    })

    it('0 switches a limit off', () => {
      const env = { ENSEMBLE_VERIFY_MAX_ROUNDS: '0', ENSEMBLE_VERIFY_STALL_ROUNDS: '0', ENSEMBLE_VERIFY_MAX_MINUTES: '0' }
      for (const text of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
        edit(text)
        const r = runHook({}, env)
        expect(r.out.decision).toBe('block')
        expect(r.out.reason).not.toContain('Nacharbeitsrunde')
      }
    })
  })

  it('records SKIPPED explicitly when the project defines no checks', () => {
    writePkg({ start: 'node index.js' })
    const r = runHook()
    expect(r.out).toBeNull()
    const rec = record()
    expect(rec.status).toBe('SKIPPED')
    expect(rec.reason).toContain('typecheck, lint, test, build')
  })

  it('records SKIPPED outside a git repository', () => {
    const r = runHook({ cwd: runtime })
    expect(r.out).toBeNull()
    expect(record().status).toBe('SKIPPED')
  })

  it('a timeout is INCOMPLETE and blocks exactly once', () => {
    writePkg({ test: 'node -e "setTimeout(()=>{}, 5000)"' })
    const env = { ENSEMBLE_VERIFY_TIMEOUT_MS: '300' }
    const first = runHook({}, env)
    expect(first.out.decision).toBe('block')
    expect(first.out.reason).toContain('TIMEOUT')
    expect(record().status).toBe('INCOMPLETE')
    expect(runHook({ stop_hook_active: true }, env).out).toBeNull()
  })

  describe('python projects', () => {
    // A stand-in for the project's .venv interpreter: "-m pytest" passes when ok.txt exists,
    // prints what pytest prints without the module when nopytest.txt exists, and records its args.
    function fakeVenv() {
      fs.rmSync(path.join(repo, 'package.json'))
      fs.writeFileSync(path.join(repo, '.gitignore'), '.venv/\nargs.txt\n')
      const bin = path.join(repo, '.venv', 'bin')
      fs.mkdirSync(bin, { recursive: true })
      fs.writeFileSync(path.join(bin, 'python'), [
        '#!/bin/sh',
        'echo "$@ PYTHONDONTWRITEBYTECODE=$PYTHONDONTWRITEBYTECODE" > args.txt',
        '[ -f nopytest.txt ] && { echo "/usr/bin/python3: No module named pytest" >&2; exit 1; }',
        '[ -f ok.txt ] && exit 0',
        'echo "1 failed" ; exit 1',
      ].join('\n'), { mode: 0o755 })
      fs.writeFileSync(path.join(repo, 'test_app.py'), 'def test_x():\n    assert True\n')
      git('add', '-A')
      git('commit', '-q', '-m', 'py')
    }

    it('runs pytest with the project venv when the project has test files but no package.json', () => {
      fakeVenv()
      fs.writeFileSync(path.join(repo, 'ok.txt'), '')
      const r = runHook()
      expect(r.out).toBeNull()
      const rec = record()
      expect(rec.status).toBe('PASS')
      expect(rec.checks.map((c: { name: string }) => c.name)).toEqual(['pytest'])
      expect(rec.changedFiles).toEqual(['ok.txt'])
      expect(fs.readFileSync(path.join(repo, 'args.txt'), 'utf8').trim()).toBe('-m pytest -q -p no:cacheprovider PYTHONDONTWRITEBYTECODE=1')
    })

    it('a failing pytest run blocks like a failing npm test', () => {
      fakeVenv()
      fs.writeFileSync(path.join(repo, 'app.py'), 'x = 1\n')
      const r = runHook()
      expect(r.out.decision).toBe('block')
      expect(r.out.reason).toContain('pytest: FAIL')
      expect(record().status).toBe('FAIL')
    })

    it('pytest not installed is INCOMPLETE (MISSING), not a test failure', () => {
      fakeVenv()
      fs.writeFileSync(path.join(repo, 'nopytest.txt'), '')
      const r = runHook()
      expect(r.out.decision).toBe('block')
      const rec = record()
      expect(rec.status).toBe('INCOMPLETE')
      expect(rec.checks[0]).toMatchObject({ name: 'pytest', status: 'MISSING' })
    })

    it('runs npm checks and pytest side by side in a mixed project', () => {
      fs.writeFileSync(path.join(repo, 'pyproject.toml'), '[tool.pytest.ini_options]\naddopts = "-q"\n')
      fs.writeFileSync(path.join(repo, 'note.txt'), 'hallo welt\n')
      runHook()
      expect(record().checks.map((c: { name: string }) => c.name)).toEqual(['npm run test', 'pytest'])
    })

    it('python files without tests or pytest config stay SKIPPED', () => {
      fs.rmSync(path.join(repo, 'package.json'))
      fs.writeFileSync(path.join(repo, 'app.py'), 'x = 1\n')
      runHook()
      const rec = record()
      expect(rec.status).toBe('SKIPPED')
      expect(rec.reason).toContain('weder package.json noch pytest-Tests')
    })
  })

  it('garbage stdin never blocks', () => {
    // cwd outside any repo: with no payload cwd the hook falls back to its own cwd.
    const res = spawnSync('node', [HOOK], { cwd: runtime, input: 'not json', encoding: 'utf8', env: { ...BASE_ENV, COLLAB_RUNTIME_ROOT: runtime, GIT_CEILING_DIRECTORIES: path.dirname(runtime) } })
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toBe('')
  })
})

describe('claude spawn command', () => {
  it('registers the Stop hook via --settings for claude agents only', async () => {
    const { resolveStartCommand } = await import('../lib/agent-spawner')
    const claude = resolveStartCommand('claude', '/tmp')
    expect(claude).toContain('--settings')
    expect(claude).toContain('verify-on-stop.cjs')
    expect(claude).toContain('"Stop"')
    expect(resolveStartCommand('codex', '/tmp')).not.toContain('verify-on-stop')
  })

  it('can be switched off with ENSEMBLE_VERIFY_ON_STOP=0', async () => {
    const { resolveStartCommand } = await import('../lib/agent-spawner')
    process.env.ENSEMBLE_VERIFY_ON_STOP = '0'
    try {
      expect(resolveStartCommand('claude', '/tmp')).not.toContain('--settings')
    } finally {
      delete process.env.ENSEMBLE_VERIFY_ON_STOP
    }
  })
})
