#!/usr/bin/env node
/**
 * verify-on-stop.cjs — binding final check for a Claude agent that writes code itself.
 *
 * Registered as a Stop hook on the claude agents ensemble-next spawns (see
 * lib/agent-spawner.ts). The global GodMode check only fires on SubagentStop, so
 * an agent that edits directly instead of delegating to @builder was never checked
 * automatically. This hook closes that gap.
 *
 * Contract:
 *  - Changed files = unstaged + staged + untracked (not ignored). None -> NO_CHANGES.
 *  - Only checks the project defines itself run: the npm scripts typecheck, lint,
 *    test, build that exist in package.json, and pytest when the project has pytest
 *    tests (test_*.py / *_test.py, conftest.py or a pytest section in pytest.ini,
 *    pyproject.toml, setup.cfg, tox.ini). pytest runs with the project's .venv or
 *    venv interpreter if there is one, else python3. Nothing else is guessed.
 *  - Every run writes a record, also when nothing could be checked, so a skipped
 *    check shows up as SKIPPED or INCOMPLETE instead of disappearing:
 *      $COLLAB_RUNTIME_ROOT/verify/<session_id>.json   (default /tmp/ensemble-next)
 *  - FAIL blocks the stop ({"decision":"block"}), at most MAX_BLOCKS times for the
 *    same change set; after that the agent may stop, the record keeps
 *    unresolved: true and a system message says so.
 *  - Rework has limits across change sets too, so an agent that keeps editing and
 *    keeps failing does not loop without end. Counted from the first failing check
 *    until a check passes (or nothing is changed any more):
 *      MAX_ROUNDS    blocks in total                    (ENSEMBLE_VERIFY_MAX_ROUNDS, 6)
 *      MAX_MINUTES   minutes since the first failure    (ENSEMBLE_VERIFY_MAX_MINUTES, 30)
 *      STALL_ROUNDS  new change sets in a row that fail with the very same output,
 *                    i.e. the edits did not touch the failure (ENSEMBLE_VERIFY_STALL_ROUNDS, 2)
 *    0 switches a limit off. A reached limit ends the blocking like the budget above:
 *    unresolved: true, stopReason names the limit, a system message says so.
 *  - INCOMPLETE (timeout, npm missing) blocks once, so the agent reports it.
 *  - The same change set is never checked twice: an unchanged fingerprint reuses
 *    the stored result.
 *  - Garbage input or an internal error never blocks; it is recorded as ERROR.
 */
/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
'use strict'

const { spawnSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const CHECK_ORDER = ['typecheck', 'lint', 'test', 'build']
const MAX_BLOCKS = Number(process.env.ENSEMBLE_VERIFY_MAX_BLOCKS || 3)
const TIMEOUT_MS = Number(process.env.ENSEMBLE_VERIFY_TIMEOUT_MS || 120000)
const MAX_ROUNDS = limit('ENSEMBLE_VERIFY_MAX_ROUNDS', 6)
const MAX_MINUTES = limit('ENSEMBLE_VERIFY_MAX_MINUTES', 30)
const STALL_ROUNDS = limit('ENSEMBLE_VERIFY_STALL_ROUNDS', 2)
const STOP_TEXT = {
  same_change_set: 'derselbe Änderungsstand wurde mehrfach geprüft',
  max_rounds: `${MAX_ROUNDS} Nacharbeitsrunden erreicht`,
  max_minutes: `${MAX_MINUTES} Minuten Nacharbeit erreicht`,
  no_progress: `${STALL_ROUNDS} Änderungen in Folge ohne Wirkung auf den Fehler`,
}
const TAIL_LINES = 25
const PY_TEST_FILE = /(^|\/)(test_[^/]*|[^/]*_test)\.py$/
const PY_ENV_DIR = /(^|\/)(\.venv|venv|env|site-packages|node_modules)\//

/** A limit from the environment; unset or not a number -> fallback, 0 or less -> off (0). */
function limit(name, fallback) {
  const raw = (process.env[name] || '').trim()
  const n = raw === '' ? fallback : Number(raw)
  return Number.isFinite(n) ? Math.max(0, n) : fallback
}

function run(cmd, args, cwd, timeout = 15000, env = undefined) {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024, env: env && { ...process.env, ...env } })
  return {
    ok: !res.error && res.status === 0,
    missing: res.error?.code === 'ENOENT',
    timedOut: !!res.signal || res.error?.code === 'ETIMEDOUT',
    status: res.status,
    out: `${res.stdout || ''}${res.stderr || ''}`,
  }
}

function lines(text) {
  return (text || '').split('\n').map(l => l.trim()).filter(Boolean)
}

function tail(text) {
  return (text || '').split('\n').filter(l => l.trim()).slice(-TAIL_LINES).join('\n')
}

function recordDir() {
  const root = (process.env.COLLAB_RUNTIME_ROOT || '').trim() || '/tmp/ensemble-next'
  return path.join(root, 'verify')
}

function recordPath(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '')
  return path.join(recordDir(), `${safe || 'unknown'}.json`)
}

function readRecord(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function writeRecord(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

function tmuxSession() {
  if (!process.env.TMUX) return undefined
  const r = run('tmux', ['display-message', '-p', '#S'], process.cwd(), 3000)
  return r.ok ? r.out.trim() : undefined
}

function changeSet(root) {
  const unstaged = lines(run('git', ['diff', '--name-only'], root).out)
  const staged = lines(run('git', ['diff', '--name-only', '--cached'], root).out)
  const untracked = lines(run('git', ['ls-files', '--others', '--exclude-standard'], root).out)
  const files = [...new Set([...unstaged, ...staged, ...untracked])].sort()

  const hash = crypto.createHash('sha256')
  hash.update(run('git', ['diff', '--binary'], root).out)
  hash.update(run('git', ['diff', '--binary', '--cached'], root).out)
  for (const f of untracked) {
    hash.update(`\0${f}\0`)
    try { hash.update(fs.readFileSync(path.join(root, f))) } catch { hash.update('<unreadable>') }
  }
  return { files, fingerprint: hash.digest('hex') }
}

/** npm scripts from package.json; null without a readable package.json. */
function npmChecks(root) {
  let pkg
  try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) } catch { return null }
  const scripts = pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : {}
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return CHECK_ORDER
    .filter(name => typeof scripts[name] === 'string' && scripts[name].trim())
    .map(name => ({ name: `npm run ${name}`, cmd: npm, args: ['run', name, '--silent'] }))
}

function fileMatches(root, file, re) {
  try { return re.test(fs.readFileSync(path.join(root, file), 'utf8')) } catch { return false }
}

function hasPytestTests(root) {
  if (fs.existsSync(path.join(root, 'pytest.ini')) || fs.existsSync(path.join(root, 'conftest.py'))) return true
  if (fileMatches(root, 'pyproject.toml', /^\[tool\.pytest/m) || fileMatches(root, 'setup.cfg', /^\[tool:pytest\]/m) || fileMatches(root, 'tox.ini', /^\[pytest\]/m)) return true
  const files = lines(run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], root).out)
  return files.some(f => PY_TEST_FILE.test(f) && !PY_ENV_DIR.test(f))
}

function projectPython(root) {
  for (const rel of ['.venv/bin/python', 'venv/bin/python', '.venv/Scripts/python.exe', 'venv/Scripts/python.exe']) {
    const p = path.join(root, rel)
    if (fs.existsSync(p)) return p
  }
  return process.platform === 'win32' ? 'python' : 'python3'
}

/** All checks the project defines; null when it has neither package.json nor pytest tests. */
function projectChecks(root) {
  const npm = npmChecks(root)
  if (!hasPytestTests(root)) return npm
  // No cache dir and no __pycache__: the run must not add untracked files to the change set.
  const pytest = { name: 'pytest', cmd: projectPython(root), args: ['-m', 'pytest', '-q', '-p', 'no:cacheprovider'], env: { PYTHONDONTWRITEBYTECODE: '1' } }
  return [...(npm || []), pytest]
}

function checkStatus(check, r) {
  if (r.missing) return 'MISSING'
  if (r.timedOut) return 'TIMEOUT'
  if (r.ok) return 'PASS'
  if (check.name === 'pytest') {
    if (/No module named pytest/.test(r.out)) return 'MISSING'
    if (r.status === 5) return 'NO_TESTS'
  }
  return 'FAIL'
}

function runChecks(root, checks) {
  // Marks the checks' own process tree, so a hook started inside them (a nested
  // agent, a test that runs this hook) does not start the checks again.
  process.env.ENSEMBLE_VERIFY_RUNNING = '1'
  return checks.map(check => {
    const started = Date.now()
    const r = run(check.cmd, check.args, root, TIMEOUT_MS, check.env)
    const status = checkStatus(check, r)
    return { name: check.name, status, exitCode: r.status, ms: Date.now() - started, tail: status === 'PASS' ? '' : tail(r.out) }
  })
}

function overall(checks) {
  if (checks.some(c => c.status === 'FAIL')) return 'FAIL'
  if (checks.some(c => c.status !== 'PASS')) return 'INCOMPLETE'
  return 'PASS'
}

/**
 * What failed, without the parts that differ from run to run (durations, clock times), so
 * two change sets that fail in exactly the same way compare equal.
 */
function failSignature(checks) {
  const text = checks.filter(c => c.status !== 'PASS')
    .map(c => `${c.name}:${c.status}:${(c.tail || '').replace(/\d+(\.\d+)?\s*(ms|s|sec|seconds?)\b/g, '').replace(/\d{1,2}:\d{2}(:\d{2})?/g, '')}`)
    .join('\n')
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/** The rework limit that is reached, or null. */
function reachedLimit(state, now) {
  if (MAX_ROUNDS > 0 && state.rounds >= MAX_ROUNDS) return 'max_rounds'
  const first = Date.parse(state.firstFailAt || '')
  if (MAX_MINUTES > 0 && Number.isFinite(first) && now - first >= MAX_MINUTES * 60000) return 'max_minutes'
  if (STALL_ROUNDS > 0 && state.stall >= STALL_ROUNDS) return 'no_progress'
  return null
}

function stopMessage(record) {
  return `Abschlusscheck weiter ${record.status} nach ${record.rounds} Runde(n), Nacharbeit beendet (${STOP_TEXT[record.stopReason] || record.stopReason}), ungelöst: ${record.file}`
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function failReason(record) {
  const failed = record.checks.filter(c => c.status !== 'PASS')
  const details = failed.map(c => `- ${c.name}: ${c.status}${c.tail ? `\n${c.tail}` : ''}`).join('\n')
  return [
    `Abschlusscheck ${record.status} (Versuch ${record.blocks}/${MAX_BLOCKS}) für ${record.changedFiles.length} geänderte Datei(en).`,
    ...(MAX_ROUNDS > 0 ? [`Nacharbeitsrunde ${record.rounds}/${MAX_ROUNDS}.${record.rounds >= MAX_ROUNDS ? ' Das ist die letzte: danach wird nicht mehr blockiert.' : ''}`] : []),
    details,
    'Behebe die Ursache im Code. Prüfungen, Testskripte, package.json oder die pytest-Konfiguration nicht abschwächen.',
    'Gelingt das nicht: melde den Stand als BLOCKED mit dieser Ausgabe, nicht als READY_FOR_REVIEW.',
    `Prüfprotokoll: ${record.file}`,
  ].join('\n')
}

function main(payload) {
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd()
  const file = recordPath(payload.session_id)
  const base = {
    file,
    sessionId: payload.session_id || null,
    tmuxSession: tmuxSession(),
    event: payload.hook_event_name || 'Stop',
    cwd,
    checkedAt: new Date().toISOString(),
  }
  // Time of this stop, also when the stored result is reused below; ensemble waits for it
  // before it closes a team (awaitingFinalCheck). checkedAt stays the time the checks ran.
  base.stoppedAt = base.checkedAt

  const top = run('git', ['rev-parse', '--show-toplevel'], cwd)
  if (!top.ok) {
    writeRecord(file, { ...base, status: 'SKIPPED', reason: 'kein Git-Repository: Änderungen nicht feststellbar', changedFiles: [], checks: [] })
    return
  }
  const root = top.out.trim()
  const { files, fingerprint } = changeSet(root)
  if (files.length === 0) {
    writeRecord(file, { ...base, root, status: 'NO_CHANGES', changedFiles: [], checks: [], fingerprint })
    return
  }

  const prev = readRecord(file)
  if (prev && prev.fingerprint === fingerprint && prev.status !== 'ERROR') {
    // Same change set as last time: the result stands, block budget included.
    // Records written before the rework limits existed carry no rounds: count their blocks.
    const rounds = prev.rounds ?? prev.blocks ?? 0
    if (prev.status === 'FAIL' && !prev.stopReason) {
      const stopReason = prev.blocks >= MAX_BLOCKS ? 'same_change_set'
        : reachedLimit({ rounds, firstFailAt: prev.firstFailAt, stall: prev.stall || 0 }, Date.parse(base.checkedAt))
      if (!stopReason) {
        const next = { ...prev, checkedAt: base.checkedAt, stoppedAt: base.stoppedAt, blocks: prev.blocks + 1, rounds: rounds + 1 }
        writeRecord(file, next)
        emit({ decision: 'block', reason: failReason(next) })
        return
      }
      const stopped = { ...prev, stoppedAt: base.stoppedAt, rounds, stopReason }
      writeRecord(file, stopped)
      emit({ systemMessage: stopMessage(stopped) })
      return
    }
    writeRecord(file, { ...prev, stoppedAt: base.stoppedAt })
    if (prev.status === 'FAIL') emit({ systemMessage: stopMessage({ ...prev, rounds }) })
    return
  }

  const defined = projectChecks(root)
  if (!defined || defined.length === 0) {
    writeRecord(file, {
      ...base, root, fingerprint, changedFiles: files, checks: [],
      status: 'SKIPPED', reason: defined ? 'package.json definiert keine der Prüfungen typecheck, lint, test, build' : 'weder package.json noch pytest-Tests: keine projektdefinierten Prüfungen',
    })
    return
  }

  const checks = runChecks(root, defined)
  const status = overall(checks)
  const record = { ...base, root, fingerprint, changedFiles: files, checks, status, blocks: 0, unresolved: false }

  if (status === 'PASS') {
    writeRecord(file, record)
    return
  }
  // A new change set that still does not pass. The rework state carries over from the last
  // record while the session has not passed in between (a PASS or NO_CHANGES record has none).
  const carry = prev && prev.unresolved ? prev : null
  const signature = failSignature(checks)
  const state = {
    rounds: carry ? carry.rounds ?? carry.blocks ?? 0 : 0,
    firstFailAt: (carry && carry.firstFailAt) || base.checkedAt,
    stall: carry && carry.failSignature === signature ? (carry.stall || 0) + 1 : 0,
    failSignature: signature,
  }
  record.unresolved = true
  const stopReason = reachedLimit(state, Date.parse(base.checkedAt))
  if (stopReason) {
    Object.assign(record, state, { stopReason })
    writeRecord(file, record)
    emit({ systemMessage: stopMessage(record) })
    return
  }
  // INCOMPLETE gets one block so the agent reports it; FAIL gets MAX_BLOCKS.
  record.blocks = 1
  Object.assign(record, state, { rounds: state.rounds + 1 })
  writeRecord(file, record)
  emit({ decision: 'block', reason: failReason(record) })
}

if (process.env.ENSEMBLE_VERIFY_RUNNING === '1') process.exit(0)

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', d => { raw += d })
process.stdin.on('end', () => {
  let payload = {}
  try { payload = JSON.parse(raw || '{}') || {} } catch { payload = {} }
  try {
    main(payload)
  } catch (err) {
    try {
      writeRecord(recordPath(payload.session_id), { status: 'ERROR', error: String(err && err.message || err), checkedAt: new Date().toISOString() })
    } catch { /* nothing left to report to */ }
  }
  process.exit(0)
})
