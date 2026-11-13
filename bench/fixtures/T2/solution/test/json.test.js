const assert = require('assert')
const { countLines } = require('../lib/count')
assert.strictEqual(countLines('a\nb\n'), 2)
console.log('ok')
