const assert = require('assert')
const { paginate } = require('../src/paginate')
const items = ['a', 'b', 'c', 'd', 'e']
assert.deepStrictEqual(paginate(items, 3, 2), ['e'], 'last partial page')
assert.deepStrictEqual(paginate(items, 4, 2), [], 'page beyond the end')
assert.deepStrictEqual(paginate(items, 1, 1), ['a'], 'size 1')
assert.deepStrictEqual(paginate(items, 1, 10), items, 'page larger than list')
console.log('hidden ok')
