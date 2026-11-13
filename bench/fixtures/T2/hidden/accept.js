const assert = require('assert')
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const sample = path.join(os.tmpdir(), `t2-sample-${process.pid}.txt`)
fs.writeFileSync(sample, 'eins zwei\ndrei\n\nvier fünf sechs\n')
const cli = path.join(__dirname, '..', 'bin', 'wc.js')
try {
  const plain = execFileSync('node', [cli, sample], { encoding: 'utf8' }).trim()
  assert.strictEqual(plain, 'words: 6', 'output without --json unchanged')
  const json = JSON.parse(execFileSync('node', [cli, '--json', sample], { encoding: 'utf8' }))
  assert.strictEqual(json.words, 6, 'json.words')
  assert.strictEqual(json.lines, 4, 'json.lines counts lines, empty ones included')
  assert.strictEqual(path.resolve(json.file), path.resolve(sample), 'json.file')
  const lib = require('../lib/count')
  assert.strictEqual(typeof lib.countLines, 'function', 'countLines exported from lib/count.js')
  assert.ok(/--json/.test(fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8')), 'README documents --json')
  console.log('hidden ok')
} finally {
  fs.rmSync(sample, { force: true })
}
