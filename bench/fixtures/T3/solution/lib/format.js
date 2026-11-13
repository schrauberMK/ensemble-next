'use strict'

function formatRow(row) {
  return `${row.name.padEnd(12)}${row.amount.toFixed(2).padStart(10)} ${row.currency}`
}

function total(rows) {
  const sums = {}
  for (const r of rows) sums[r.currency] = (sums[r.currency] || 0) + r.amount
  return Object.keys(sums).sort()
    .map(c => `${'TOTAL'.padEnd(12)}${sums[c].toFixed(2).padStart(10)} ${c}`)
}

module.exports = { formatRow, total }
