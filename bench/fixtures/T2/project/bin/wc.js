#!/usr/bin/env node
'use strict'

const fs = require('fs')
const { countWords } = require('../lib/count')

const file = process.argv[2]
if (!file) {
  console.error('usage: wc.js <file>')
  process.exit(2)
}
const text = fs.readFileSync(file, 'utf8')
console.log(`words: ${countWords(text)}`)
