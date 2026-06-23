import { ipcMain } from 'electron'
import { replaySteps } from '../core/stepReplay'
import { installSelectorGen, recorderListener } from '../core/injectedScripts'
import { refocusMainWindow } from '../core/windowFocus'
import { launchSessionContext } from '../core/browserSession'

// During the recorder's pre-Start replay we're only repositioning the browser to the
// current flow state — not asserting an exact element like the picker does. So cap how
// long a single replayed action waits on a (possibly stale) element: failing in a few
// seconds lets the tester take over by hand quickly, instead of stalling the full 20s.
// It's a cap, not a floor — profiles with a shorter timeout keep their own value.
const REPLAY_ACTION_TIMEOUT_CAP = 8000

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

    let close
    try {
      // Persistent profile → recording continues under the login the tester already did.
      const session = await launchSessionContext(browserName, { headless: false, timeout })
      const { context, page } = session
      close = session.close

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

      page.on('close', () => resolveDone('closed'))
      context.on('close', () => resolveDone('closed'))

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout })

      // Replay existing steps so recording continues from the current flow state.
      // The recorder stays disarmed (tester hasn't pressed Start), so replayed
      // actions aren't captured. A replay failure (e.g. a stale prior-step selector)
      // is NON-FATAL here: we keep the browser open so the tester can carry on by
      // hand — finding/fixing that very component is often why they're recording.
      if (runSteps && steps.length) {
        // Fail fast on a stale element (the painful wait the tester sees), but still
        // give slow pages the full navigation budget so a real load isn't cut short.
        page.setDefaultTimeout(Math.min(timeout, REPLAY_ACTION_TIMEOUT_CAP))
        page.setDefaultNavigationTimeout(timeout)
        const replay = await replaySteps(page, steps, baseUrl)
        if (!replay.ok) {
          try { event.sender.send('recorder:notice', replay.error || 'Some earlier steps could not be replayed — continuing from where they stopped.') } catch { /* renderer gone */ }
        }
      }

      // Interactive phase: the tester now drives the browser to find/record elements.
      // Disable BOTH the action and navigation timeouts so the session never times out
      // while they hunt for the right component — they can take as long as they need
      // before Start. Set it on the whole CONTEXT (not just this page) so any new tab or
      // popup opened during the hunt is covered too; otherwise Playwright's 30s default
      // quietly comes back on those pages and the timeout "reappears".
      context.setDefaultTimeout(0)
      context.setDefaultNavigationTimeout(0)

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
      await close?.()
      refocusMainWindow()   // restore app input focus after the headful browser closes
    }
  })
}
