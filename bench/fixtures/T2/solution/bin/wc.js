#!/usr/bin/env node
'use strict'

const fs = require('fs')
const { countWords, countLines } = require('../lib/count')

const args = process.argv.slice(2)
const json = args.includes('--json')
const file = args.find(a => a !== '--json')
if (!file) {
  console.error('usage: wc.js [--json] <file>')
  process.exit(2)
}
const text = fs.readFileSync(file, 'utf8')
if (json) {
  console.log(JSON.stringify({ file, words: countWords(text), lines: countLines(text) }))
} else {
  console.log(`words: ${countWords(text)}`)
}
