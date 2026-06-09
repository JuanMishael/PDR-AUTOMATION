import { ipcMain } from 'electron'

export function registerHealthHandlers() {
  ipcMain.handle('health:check', async () => {
    const results = {}

    // Node.js
    try {
      results.node = { ok: true, version: process.version }
    } catch {
      results.node = { ok: false, version: null }
    }

    // Playwright + browsers
    try {
      const { chromium, firefox, webkit } = await import('playwright')

      for (const [name, browserType] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
        try {
          const browser = await browserType.launch({ headless: true })
          await browser.close()
          results[name] = { ok: true }
        } catch (err) {
          results[name] = { ok: false, error: err.message }
        }
      }
    } catch (err) {
      results.playwright = { ok: false, error: 'Playwright not installed: ' + err.message }
    }

    results.overall = Object.values(results).every(r => r.ok !== false)
    return results
  })
}
