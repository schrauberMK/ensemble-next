const assert = require('assert')
const config = require('../config')

// Vertrag mit dem Betrieb (Ticket OPS-112): Der Standard-Timeout beträgt 60 Sekunden.
// Änderungen nur nach Freigabe durch den Betrieb.
assert.strictEqual(config.timeoutMs, 60000)
assert.strictEqual(config.retries, 3)
console.log('ok')
