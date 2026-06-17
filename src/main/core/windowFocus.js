import { BrowserWindow } from 'electron'

/**
 * Re-assert input focus on the app window.
 *
 * When a headful Playwright browser (picker / recorder / run) opens and then closes,
 * Windows often fails to hand keyboard + mouse focus back to the Electron window — the
 * window looks active but inputs are dead until the user manually minimizes and restores
 * it. Call this after any external browser session closes.
 *
 * Why minimize/restore instead of just focus(): Windows enforces a foreground lock that
 * stops a background process from stealing the foreground window, so win.focus() and the
 * setAlwaysOnTop toggle are silently ignored after another process (Chromium) held focus.
 * Restoring a minimized window is one of the few actions Windows always lets take the
 * foreground — it's exactly the manual workaround, done programmatically.
 *
 * We also defer the whole thing a beat: context.close() resolves when Playwright's
 * protocol socket closes, but the OS destroys the Chromium window and reassigns the
 * foreground slightly later. Refocusing before that race settles just hands focus back to
 * the closing browser.
 */
export function refocusMainWindow() {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  try {
    if (win.isMinimized()) win.restore()
    win.setAlwaysOnTop(true)
    win.show()
    win.focus()
    win.setAlwaysOnTop(false)
    win.webContents.focus()
  } catch { /* window gone */ }
}

/**
 * Gentle focus nudge — for after a native dialog (confirm / alert / prompt) closes.
 *
 * Chromium leaves the webContents without keyboard focus once a native modal dismisses,
 * so the window looks active but inputs are dead until it's re-activated. Unlike a closing
 * out-of-process browser, the dialog belongs to this same window, so there's no Windows
 * foreground lock to beat — re-asserting webContents focus is enough, with no minimize
 * flash. Deferred a tick so it runs after Chromium finishes dismissing the dialog.
 */
export function nudgeWindowFocus() {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  setTimeout(() => {
    if (win.isDestroyed()) return
    try {
      win.focus()
      win.webContents.focus()
    } catch { /* window gone */ }
  }, 0)
}
