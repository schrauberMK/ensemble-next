const assert = require('assert')
const report = require('../lib/report')

const input = '# Kommentar\nMiete; 900; EUR\nStrom;85.5;EUR\nHosting; 12; USD\n'
assert.strictEqual(report.render(input), [
  'Miete           900.00 EUR',
  'Strom            85.50 EUR',
  'Hosting          12.00 USD',
  'TOTAL           985.50 EUR',
  'TOTAL            12.00 USD',
].join('\n'))
assert.throws(() => report.parseLine('kaputt'), /bad line/)
console.log('ok')
