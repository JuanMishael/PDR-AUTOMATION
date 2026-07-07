import { ipcMain } from 'electron'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { parseUiDump } from '../core/uiDump'

// Native element picker (authoring aid). The user navigates their phone to a screen, hits
// "Pick from screen", and we snapshot the live UI tree via `adb uiautomator dump`, parse it,
// and hand back a flat list of pickable elements each with its best strategy+locator — so a
// step's locator becomes point-and-click instead of hand-reading XML.
//
// ponytail: reads the CURRENT foreground screen over adb — no Appium session needed (authoring
// happens between runs). Screenshot-overlay picking is a later nicety; a list is enough to pick.

function adbPath() {
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb'
  if (home) {
    const p = join(home, 'platform-tools', exe)
    if (existsSync(p)) return p
  }
  return exe   // fall back to PATH
}

export function registerNativePickerHandlers() {
  ipcMain.handle('native:pickElements', async () => {
    const adb = adbPath()
    try {
      execFileSync(adb, ['shell', 'uiautomator', 'dump', '/sdcard/ui.xml'], { timeout: 15000 })
      const xml = execFileSync(adb, ['exec-out', 'cat', '/sdcard/ui.xml'],
        { timeout: 15000, maxBuffer: 8 * 1024 * 1024 }).toString('utf8')
      return { elements: parseUiDump(xml) }
    } catch (err) {
      // adb missing, no device, or a screen that won't dump (mid-animation / WebView / secure).
      const msg = err.code === 'ENOENT'
        ? 'adb not found — set ANDROID_HOME or add platform-tools to PATH.'
        : (err.stderr?.toString() || err.message || 'Could not read the screen.').split('\n')[0]
      return { error: msg }
    }
  })
}
