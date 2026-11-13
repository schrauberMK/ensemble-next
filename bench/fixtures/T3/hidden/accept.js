const assert = require('assert')
const fs = require('fs')
const path = require('path')
const lib = path.join(__dirname, '..', 'lib')
const parse = require(path.join(lib, 'parse'))
const format = require(path.join(lib, 'format'))
const report = require(path.join(lib, 'report'))

assert.strictEqual(typeof parse.parseLine, 'function', 'lib/parse.js exports parseLine')
assert.strictEqual(typeof parse.parse, 'function', 'lib/parse.js exports parse')
assert.strictEqual(typeof format.formatRow, 'function', 'lib/format.js exports formatRow')
assert.strictEqual(typeof format.total, 'function', 'lib/format.js exports total')
for (const k of ['parseLine', 'parse', 'formatRow', 'total', 'render']) {
  assert.strictEqual(typeof report[k], 'function', `report.${k} still exported`)
}
assert.ok(!/function parseLine|function formatRow/.test(fs.readFileSync(path.join(lib, 'report.js'), 'utf8')),
  'report.js no longer defines parseLine/formatRow itself')
const input = 'A;1;EUR\nB;2.5;CHF\nC;-1;EUR\n'
assert.strictEqual(report.render(input), [
  'A                 1.00 EUR',
  'B                 2.50 CHF',
  'C                -1.00 EUR',
  'TOTAL             2.50 CHF',
  'TOTAL             0.00 EUR',
].join('\n'))
assert.throws(() => report.parseLine('x;y;EUR'), /bad amount/)
console.log('hidden ok')
