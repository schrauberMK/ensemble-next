'use strict'

function countWords(text) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  return words.length
}

function countLines(text) {
  if (text === '') return 0
  return text.replace(/\n$/, '').split('\n').length
}

module.exports = { countWords, countLines }
