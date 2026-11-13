const assert = require('assert')
const { countWords } = require('../lib/count')

assert.strictEqual(countWords('eins zwei  drei\nvier'), 4)
assert.strictEqual(countWords('   '), 0)
console.log('ok')
