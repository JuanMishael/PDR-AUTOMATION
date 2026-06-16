import { BrowserWindow } from 'electron'

/**
 * Re-assert input focus on the app window.
 *
 * When a headful Playwright browser (picker / recorder / run) opens and then closes,
 * Windows often fails to hand keyboard + mouse focus back to the Electron window — the
 * window looks active but inputs are dead until the user manually minimizes and restores
 * it. Call this after any external browser session closes.
 *
 * A bare win.focus() is usually ignored after focus theft; the alwaysOnTop toggle forces
 * Windows to genuinely re-activate the window, and webContents.focus() hands input back
 * to the renderer.
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
