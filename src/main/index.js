import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import appIcon from '../../resources/favicon/icon-512.png?asset'
import { initDb, flushDb } from './core/db'
import { nudgeWindowFocus } from './core/windowFocus'
import { registerRunnerHandlers } from './ipc/runner'
import { registerStorageHandlers } from './ipc/storage'
import { registerReporterHandlers } from './ipc/reporter'
import { registerHealthHandlers } from './ipc/health'
import { registerSelectorTesterHandlers } from './ipc/selectorTester'
import { registerElementPickerHandlers } from './ipc/elementPicker'
import { registerRecorderHandlers } from './ipc/recorder'
import { registerDataLibraryHandlers } from './ipc/dataLibrary'
import { registerTransferHandlers } from './ipc/transfer'

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.pdr.pdr-automation')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await initDb()
  registerRunnerHandlers()
  registerStorageHandlers()
  registerReporterHandlers()
  registerHealthHandlers()
  registerSelectorTesterHandlers()
  registerElementPickerHandlers()
  registerRecorderHandlers()
  registerDataLibraryHandlers()
  registerTransferHandlers()

  // Renderer asks for this after a native confirm/alert dismisses — Chromium leaves the
  // webContents without keyboard focus otherwise, killing all inputs until re-activation.
  ipcMain.on('window:refocus', () => nudgeWindowFocus())

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Flush any debounced DB write before the process exits so no save is lost.
app.on('before-quit', () => flushDb())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
