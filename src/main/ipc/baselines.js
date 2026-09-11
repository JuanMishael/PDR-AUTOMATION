import { ipcMain, dialog, app } from 'electron'
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, statSync } from 'fs'
import { join, basename, extname } from 'path'

// Reference images for Assert Map Changed. A dropped file is COPIED into the app's data dir
// rather than referenced where it sits: a baseline that lives in Downloads is one cleanup away
// from breaking a test that looked fine yesterday.
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp']
const baselineDir = () => {
  const dir = join(app.getPath('userData'), 'pdr-automation-data', 'baselines')
  mkdirSync(dir, { recursive: true })
  return dir
}

// Store an image the app produced itself (the recorder's capture), rather than one the tester
// dropped in. Same folder, so Clear/rebrowse behave identically either way.
export function saveBaselineBuffer(buf, stem = 'recorded') {
  const dest = join(baselineDir(), `${String(stem).replace(/[^\w.-]+/g, '-').slice(0, 40) || 'recorded'}-${Date.now()}.png`)
  writeFileSync(dest, buf)
  return dest
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
const dataUrl = (p) => `data:${MIME[extname(p).toLowerCase()] || 'image/png'};base64,${readFileSync(p).toString('base64')}`

// Copy in under a name that can't collide with an existing baseline, and hand back both the stored
// path (what the step keeps) and a data URL (what the card shows) — the renderer can't read a
// file:// image off disk, so the thumbnail has to come through here.
function adopt(srcPath) {
  const ext = extname(srcPath).toLowerCase()
  if (!IMAGE_EXT.includes(ext)) return { error: `Not an image: ${basename(srcPath)}` }
  if (!existsSync(srcPath)) return { error: `File not found: ${srcPath}` }
  const stem = basename(srcPath, ext).replace(/[^\w.-]+/g, '-').slice(0, 40) || 'baseline'
  const dest = join(baselineDir(), `${stem}-${Date.now()}${ext}`)
  copyFileSync(srcPath, dest)
  return { path: dest, dataUrl: dataUrl(dest) }
}

export function registerBaselineHandlers() {
  // Dropped onto the step card.
  ipcMain.handle('baseline:save', async (_e, srcPath) => {
    try { return adopt(String(srcPath || '')) } catch (e) { return { error: e.message } }
  })

  // Clicked the drop zone instead of dragging — a run's step-N-map.png is the usual pick, so the
  // dialog opens on the run artifacts.
  ipcMain.handle('baseline:pick', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose a reference image',
      defaultPath: join(app.getPath('temp'), 'pdr-runs'),
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile']
    })
    if (res.canceled || !res.filePaths?.[0]) return { cancelled: true }
    try { return adopt(res.filePaths[0]) } catch (e) { return { error: e.message } }
  })

  // Redraw an already-saved baseline when the step card mounts. A missing file is reported, not
  // thrown: the step still holds the path, and the tester needs to see that it's gone.
  ipcMain.handle('baseline:read', async (_e, p) => {
    try {
      const path = String(p || '')
      if (!path || !existsSync(path) || !statSync(path).isFile()) return { missing: true }
      return { path, dataUrl: dataUrl(path) }
    } catch (e) { return { error: e.message } }
  })
}
