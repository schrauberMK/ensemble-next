'use strict'

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

module.exports = { parseLine, parse }
