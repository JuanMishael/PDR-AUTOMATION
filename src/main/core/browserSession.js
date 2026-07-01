import { join } from 'path'
import { rm } from 'fs/promises'
import { app } from 'electron'

// One on-disk Chromium profile shared by the interactive tools (picker / recorder /
// selector test). Cookies + localStorage live here, so a login done in any of them
// survives to the next launch — the tester signs in once, not every pick.
const profileDir = () => join(app.getPath('userData'), 'pdr-browser-profile')

// Every live interactive session's close fn, so app-quit can tear them down. Without this a
// recorder/picker window left open at quit orphans a Chromium that keeps holding the profile
// lock — forcing the next launch to fall back to incognito (lost login).
const liveSessions = new Set()

export async function closeAllSessions() {
  await Promise.allSettled([...liveSessions].map(close => close()))
  liveSessions.clear()
}

/**
 * Launch a browser that REMEMBERS the tester's login.
 *
 * Backed by a persistent profile (launchPersistentContext) instead of a throwaway
 * incognito context, so the session carries across pick/record/test sessions and
 * the tester no longer has to re-login (or replay the whole login flow) every time.
 *
 * Returns { context, page, persistent, close }:
 *   - context : the BrowserContext (use exposeBinding / addInitScript on it as before)
 *   - page    : a ready blank page (a persistent context opens with one already)
 *   - persistent : false if we fell back to incognito (e.g. profile was locked)
 *   - close   : tears everything down; call it in finally
 *
 * If the profile can't be opened (another tool window is still closing and holds the
 * lock, or it's unwritable) we degrade gracefully to a throwaway context so the tool
 * still works — just without the remembered session for that one run.
 */
export async function launchSessionContext(browserName = 'chromium', { headless = false, timeout = 20000 } = {}) {
  const pw = await import('playwright')
  const browserType = pw[browserName] || pw.chromium

  let context
  let persistent = true
  try {
    context = await browserType.launchPersistentContext(profileDir(), {
      headless,
      ignoreHTTPSErrors: true
    })
  } catch {
    // Profile locked by a still-closing window, or unwritable — degrade to incognito.
    persistent = false
    const browser = await browserType.launch({ headless })
    context = await browser.newContext({ ignoreHTTPSErrors: true })
  }

  // A persistent context starts with one blank page; reuse it instead of opening another.
  const page = context.pages()[0] || (await context.newPage())
  page.setDefaultTimeout(timeout)

  const close = async () => {
    liveSessions.delete(close)
    try {
      const browser = context.browser()
      await context.close()
      await browser?.close()
    } catch {
      /* ignore */
    }
  }
  liveSessions.add(close)

  return { context, page, persistent, close }
}

/**
 * Wipe the saved login — deletes the persistent profile so the next pick/record/test
 * starts signed out (for logging out or switching users). No-op if nothing's saved.
 * Returns { ok } / { ok:false, error }. Fails clearly if a tool window still holds
 * the profile lock, so the tester knows to close it first.
 */
export async function clearSession() {
  try {
    await rm(profileDir(), { recursive: true, force: true })
    return { ok: true }
  } catch (err) {
    const msg = err?.message || 'Could not clear the session'
    if (/EBUSY|EPERM|locked|resource busy/i.test(msg)) {
      return { ok: false, error: 'Close any open picker/recorder window first, then try again.' }
    }
    return { ok: false, error: msg.split('\n')[0].slice(0, 120) }
  }
}
