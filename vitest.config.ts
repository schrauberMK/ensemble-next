import fs from 'fs'
import path from 'path'
import { configDefaults, defineConfig } from 'vitest/config'

// Keep test artifacts and user configuration isolated from the host machine.
const temporary = path.resolve('tmp')
const home = path.join(temporary, 'home')
fs.mkdirSync(home, { recursive: true })

export default defineConfig({
  test: {
    // bench/fixtures holds the bench tasks' own test scripts, some red on purpose.
    exclude: [...configDefaults.exclude, 'tmp/**', 'bench/fixtures/**'],
    env: {
      TMPDIR: temporary,
      HOME: home,
      COLLAB_RUNTIME_ROOT: path.join(temporary, 'test-runtime'),
      ENSEMBLE_DATA_DIR: path.join(temporary, 'data'),
      ENSEMBLE_CONFIG: path.join(temporary, 'absent-config.json'),
      ENSEMBLE_ROSTER_CMD: '',
      ENSEMBLE_PLAN_CMD: '',
      ENSEMBLE_EVENTS_CMD: '',
      ENSEMBLE_REPLACE_STALLED: '',
      // No 2 s ready settle wait in every spawn test; tests/ready-settle.test.ts checks the default.
      ENSEMBLE_READY_SETTLE_MS: '0',
      // Never start a real Codex review from a test disband; tests/auto-review.test.ts checks it.
      ENSEMBLE_AUTO_REVIEW: '0',
      ENSEMBLE_MEMORY_URL: 'http://localhost:1/api/memory/save',
      // Never send real notifications from a test run, even when the developer's
      // shell exports these (a test disband otherwise reaches Telegram).
      ENSEMBLE_TELEGRAM_BOT_TOKEN: '',
      ENSEMBLE_TELEGRAM_CHAT_ID: '',
      ALERT_HUB_SECRET: '',
    },
  },
})
