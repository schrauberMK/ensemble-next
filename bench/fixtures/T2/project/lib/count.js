'use strict'

function countWords(text) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  return words.length
}

module.exports = { countWords }
