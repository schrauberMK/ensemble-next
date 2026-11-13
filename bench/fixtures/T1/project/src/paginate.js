'use strict'

/**
 * Returns the items of a 1-based page.
 * paginate([a, b, c, d, e], 1, 2) -> [a, b]
 */
function paginate(items, page, size) {
  const start = page * size
  return items.slice(start, start + size)
}

module.exports = { paginate }
