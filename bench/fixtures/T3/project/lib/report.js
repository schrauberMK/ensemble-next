'use strict'

// Parses "name;amount;currency" lines and renders a fixed-width report.

function parseLine(line) {
  const [name, amount, currency] = line.split(';').map(s => s.trim())
  if (!name || amount === undefined || !currency) throw new Error(`bad line: ${line}`)
  const value = Number(amount)
  if (Number.isNaN(value)) throw new Error(`bad amount: ${amount}`)
  return { name, amount: value, currency }
}

function parse(text) {
  return text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(parseLine)
}

function formatRow(row) {
  return `${row.name.padEnd(12)}${row.amount.toFixed(2).padStart(10)} ${row.currency}`
}

function total(rows) {
  const sums = {}
  for (const r of rows) sums[r.currency] = (sums[r.currency] || 0) + r.amount
  return Object.keys(sums).sort()
    .map(c => `${'TOTAL'.padEnd(12)}${sums[c].toFixed(2).padStart(10)} ${c}`)
}

function render(text) {
  const rows = parse(text)
  return [...rows.map(formatRow), ...total(rows)].join('\n')
}

module.exports = { parseLine, parse, formatRow, total, render }
