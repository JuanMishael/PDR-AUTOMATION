import { ipcMain } from 'electron'
import { replaySteps } from '../core/stepReplay'
import { installSelectorGen, pickerListener } from '../core/injectedScripts'
import { refocusMainWindow } from '../core/windowFocus'
import { launchSessionContext, clearSession } from '../core/browserSession'

export function registerElementPickerHandlers() {
  // Log out / switch users — wipes the shared persistent browser profile.
  ipcMain.handle('session:clear', () => clearSession())

  ipcMain.handle('picker:pick', async (_, args) => {
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
      // Persistent profile → the tester's login from a previous pick/record is still
      // there, so no re-login just to reach a gated element.
      const session = await launchSessionContext(browserName, { headless: false, timeout })
      const { context, page } = session
      close = session.close

      let resolvePick
      const pickPromise = new Promise(res => { resolvePick = res })

      // Bridge + listener installed before navigation so they survive replay navigations.
      await context.exposeBinding('__pickerPick', (_src, payload) => resolvePick(payload))
      await context.addInitScript(installSelectorGen)
      await context.addInitScript(pickerListener)

      // If the tester closes the window without picking, resolve as cancelled.
      page.on('close', () => resolvePick(null))
      context.on('close', () => resolvePick(null))

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout })

      // Replay the steps above so the tester can pick mid-flow elements (inside a modal).
      // The listener stays disarmed during replay so generated clicks aren't captured.
      let ranSteps = 0
      if (runSteps && steps.length) {
        const replay = await replaySteps(page, steps, baseUrl)
        if (!replay.ok) return replay
        ranSteps = replay.ranSteps
      }

      // Arm the picker on the final page and wait for the tester's click.
      await page.evaluate(() => window.__pickerArm && window.__pickerArm()).catch(() => {})

      const picked = await pickPromise
      if (!picked) return { ok: false, cancelled: true }
      return {
        ok: true, selector: picked.selector, tag: picked.tag, text: picked.text,
        candidates: picked.candidates || [], ranSteps
      }

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
