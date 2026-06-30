// Installs Chromium into ./pw-browsers so electron-builder can ship it inside the
// installer (see build.extraResources). At runtime the app points
// PLAYWRIGHT_BROWSERS_PATH here, so end users never run `playwright install`.
// Chromium only — firefox/webkit are opt-in and intentionally not bundled.
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'pw-browsers')

console.log(`Bundling Chromium into ${dest} ...`)
execSync('npx playwright install chromium', {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: dest }
})
console.log('Done. Chromium will be packaged into the installer.')
