import { ipcMain } from 'electron'
import { replaySteps } from '../core/stepReplay'
import { installSelectorGen, recorderListener } from '../core/injectedScripts'

/**
 * Live recorder. Opens a headful browser, optionally replays existing steps so the
 * tester can continue an in-progress flow, then injects a Start/Stop bar that captures
 * click / fill / selectOption / pressKey. Each captured action is streamed to the
 * renderer over 'recorder:step' as it happens, so step cards appear on the canvas live.
 *
 * The invoke resolves when the tester presses Stop (window.__recordDone) or closes the
 * browser window.
 */
export function registerRecorderHandlers() {
  ipcMain.handle('recorder:start', async (event, args) => {
    const {
      url,
      browser: browserName = 'chromium',
      steps = [],
      baseUrl = '',
      runSteps = false,
      timeout = 20000
    } = args || {}

    if (!url?.trim()) return { ok: false, error: 'No URL — set a Base URL in the profile' }

    let browser
    try {
      const pw = await import('playwright')
      const browserType = pw[browserName] || pw.chromium

      browser = await browserType.launch({ headless: false })
      const context = await browser.newContext({ ignoreHTTPSErrors: true })

      let resolveDone
      const donePromise = new Promise(res => { resolveDone = res })
      let recorded = 0

      // Bridges: every captured action streams to the renderer; Stop ends the session.
      await context.exposeBinding('__recordStep', (_src, payload) => {
        recorded++
        try { event.sender.send('recorder:step', payload) } catch { /* renderer gone */ }
      })
      await context.exposeBinding('__recordDone', () => resolveDone('stopped'))
      await context.addInitScript(installSelectorGen)
      await context.addInitScript(recorderListener)

      const page = await context.newPage()
      page.setDefaultTimeout(timeout)
      page.on('close', () => resolveDone('closed'))
      browser.on('disconnected', () => resolveDone('closed'))

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout })

      // Replay existing steps so recording continues from the current flow state.
      // The recorder stays disarmed (tester hasn't pressed Start), so replayed
      // actions aren't captured.
      if (runSteps && steps.length) {
        const replay = await replaySteps(page, steps, baseUrl)
        if (!replay.ok) return replay
      }

      await donePromise
      return { ok: true, recorded }

    } catch (err) {
      const msg = err.message || ''
      if (msg.includes('Executable doesn\'t exist') || msg.includes('browserType.launch') || msg.includes('playwright install')) {
        return { ok: false, error: 'Browser not installed — run: npx playwright install chromium' }
      }
      if (msg.includes('net::ERR') || msg.includes('Failed to navigate') || msg.includes('ERR_NAME_NOT_RESOLVED')) {
        return { ok: false, error: 'Could not reach the URL — check the profile Base URL or network' }
      }
      if (msg.includes('Timeout') || msg.includes('timeout')) {
        return { ok: false, error: 'Page took too long to load' }
      }
      return { ok: false, error: msg.split('\n')[0].slice(0, 120) }

    } finally {
      try { await browser?.close() } catch { /* ignore */ }
    }
  })
}
