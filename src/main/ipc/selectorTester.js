import { ipcMain } from 'electron'
import { replaySteps } from '../core/stepReplay'
import { installSelectorGen } from '../core/injectedScripts'
import { launchSessionContext } from '../core/browserSession'
import { buildDataContext } from '../core/tokenResolver'
import { getDb } from '../core/db'

export function registerSelectorTesterHandlers() {
  ipcMain.handle('selector:test', async (_, args) => {
    const {
      url,
      selector,
      browser: browserName = 'chromium',
      steps = [],
      setupSteps = [],
      baseUrl = '',
      runSteps = false,
      timeout = 20000
    } = args || {}

    if (!selector?.trim()) return { ok: false, error: 'No selector entered' }
    if (!url?.trim())      return { ok: false, error: 'No URL — set a Base URL in the profile' }

    let close
    try {
      // Shares the persistent profile, so a login done in the picker/recorder carries
      // over here too — selectors for gated pages resolve without re-auth.
      const session = await launchSessionContext(browserName, { headless: true, timeout })
      const { context, page } = session
      close = session.close
      // Inject the shared selector generator so we can compute robust "Strengthen"
      // candidates for each matched element (used when the typed selector is ambiguous).
      await context.addInitScript(installSelectorGen)

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout })

      // Resolve test-data tokens so replay uses real values, not literal {{tokens}} (matches a run).
      const dataContext = await buildDataContext(getDb(), null)

      // Best-effort setup: replay the scenario's prerequisite (e.g. Login) chain first so a gated
      // page is reachable. NON-FATAL — the persistent profile may already be logged in, in which
      // case these steps fail on absent login fields; that's fine, we're already where we need to be.
      // Fail fast (capped) so a stale login step doesn't stall the whole test.
      if (setupSteps.length) {
        page.setDefaultTimeout(Math.min(timeout, 8000))
        await replaySteps(page, setupSteps, baseUrl, dataContext)   // ignore result — best-effort
        page.setDefaultTimeout(timeout)                             // restore full budget for the real test
      }

      // "Test from the top" — replay the steps above this card so mid-flow elements
      // (the AUTHORIZED USERS modal, post-login content) actually exist before we test.
      // Without this, any selector for an element that appears after navigate+click
      // returns 0 matches against the bare page and misleads the tester. Strict: a failure here
      // means the target genuinely isn't reachable, so surface it.
      let ranSteps = 0
      if (runSteps && steps.length) {
        const replay = await replaySteps(page, steps, baseUrl, dataContext)
        if (!replay.ok) return replay
        ranSteps = replay.ranSteps
      }

      const count = await page.locator(selector).count()

      const elements = []
      const limit = Math.min(count, 5)
      for (let i = 0; i < limit; i++) {
        const el = page.locator(selector).nth(i)
        const [tag, text, visible, cls, id, candidates] = await Promise.all([
          el.evaluate(e => e.tagName.toLowerCase()).catch(() => '?'),
          el.textContent().catch(() => ''),
          el.isVisible().catch(() => false),
          el.evaluate(e => e.className || '').catch(() => ''),
          el.evaluate(e => e.id || '').catch(() => ''),
          // Top robust, unique selectors that pin THIS specific match (for Strengthen).
          el.evaluate(e => (window.__genCandidates ? window.__genCandidates(e) : []))
            .then(list => (list || []).filter(c => c.count === 1).slice(0, 4))
            .catch(() => [])
        ])
        elements.push({
          tag,
          text:    text?.trim().slice(0, 60),
          visible,
          class:   cls?.trim().slice(0, 50),
          id:      id?.trim(),
          candidates
        })
      }

      return { ok: true, count, elements, ranSteps }

    } catch (err) {
      const msg = err.message || ''
      if (msg.includes('is not a valid selector') || msg.includes('Unexpected token') || msg.includes('ParseError')) {
        return { ok: false, error: 'Invalid selector syntax — check your CSS/text selector' }
      }
      if (msg.includes('Executable doesn\'t exist') || msg.includes('browserType.launch') || msg.includes('playwright install')) {
        return { ok: false, error: 'Browser not installed — run: npx playwright install chromium' }
      }
      if (msg.includes('net::ERR') || msg.includes('Failed to navigate') || msg.includes('ERR_NAME_NOT_RESOLVED')) {
        return { ok: false, error: 'Could not reach the URL — check the profile Base URL or network' }
      }
      if (msg.includes('Timeout') || msg.includes('timeout')) {
        return { ok: false, error: 'Page took too long to load (20s timeout)' }
      }
      return { ok: false, error: msg.split('\n')[0].slice(0, 120) }

    } finally {
      await close?.()
    }
  })
}
