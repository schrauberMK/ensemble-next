const assert = require('assert')
const { paginate } = require('../src/paginate')

assert.deepStrictEqual(paginate(['a', 'b', 'c', 'd', 'e'], 1, 2), ['a', 'b'])
assert.deepStrictEqual(paginate(['a', 'b', 'c', 'd', 'e'], 2, 2), ['c', 'd'])
console.log('ok')
