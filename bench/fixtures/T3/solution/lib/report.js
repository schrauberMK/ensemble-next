'use strict'

// Parses "name;amount;currency" lines and renders a fixed-width report.
const { parseLine, parse } = require('./parse')
const { formatRow, total } = require('./format')

function render(text) {
  const rows = parse(text)
  return [...rows.map(formatRow), ...total(rows)].join('\n')
}

module.exports = { parseLine, parse, formatRow, total, render }
