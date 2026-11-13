'use strict'
// Project lint: every file under lib/ starts with 'use strict', has no `var`
// and no line longer than 100 characters.
const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, 'lib')
let failed = false
for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
  const text = fs.readFileSync(path.join(dir, name), 'utf8')
  const lines = text.split('\n')
  if (lines[0].trim() !== "'use strict'") { console.error(`${name}:1 missing 'use strict'`); failed = true }
  lines.forEach((line, i) => {
    if (/\bvar\s/.test(line)) { console.error(`${name}:${i + 1} var is not allowed`); failed = true }
    if (line.length > 100) { console.error(`${name}:${i + 1} line longer than 100`); failed = true }
  })
}
process.exit(failed ? 1 : 0)
