import { ipcMain, app, shell, dialog } from 'electron'
import { join } from 'path'
import { writeFileSync, readFileSync, mkdirSync } from 'fs'
import { getDb } from '../core/db'
import { serializeProfile, deserializeProfile, serializeProject, deserializeProject } from '../core/portability'

function profilesDir() {
  const dir = join(app.getPath('documents'), 'AutomationTool', 'Profiles')
  mkdirSync(dir, { recursive: true })
  return dir
}
const sanitize = s => String(s).replace(/[^a-zA-Z0-9\-_]/g, '_')

// Share a whole profile (scenarios + steps + referenced test-data collections) as one .json bundle,
// and recreate such a bundle on another machine. See core/portability.js for the format + remapping.
export function registerTransferHandlers() {
  ipcMain.handle('transfer:exportProfile', (_, profileId) => {
    const db = getDb()
    const bundle = serializeProfile(db, profileId)
    if (!bundle) return { error: 'Profile not found' }
    const base = sanitize(`${bundle.profile.name}-${new Date().toISOString().slice(0, 10)}`)
    const path = join(profilesDir(), `${base}.automation-profile.json`)
    writeFileSync(path, JSON.stringify(bundle, null, 2), 'utf-8')
    shell.showItemInFolder(path)
    return { ok: true, path, scenarioCount: bundle.scenarios.length, collectionCount: bundle.collections.length }
  })

  // Import a profile into the given project (the project the user has open). Falls back to a home
  // project inside deserializeProfile when projectId is missing.
  ipcMain.handle('transfer:importProfile', async (_, projectId) => {
    const res = await dialog.showOpenDialog({
      title: 'Import a shared profile',
      filters: [{ name: 'Automation profile', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (res.canceled || !res.filePaths?.[0]) return { cancelled: true }

    let bundle
    try { bundle = JSON.parse(readFileSync(res.filePaths[0], 'utf-8')) } catch { return { error: 'Not valid JSON' } }
    if ((bundle?.type !== 'automation-profile' && bundle?.type !== 'botchi-profile') || !bundle.profile?.name) return { error: 'Not an Automation profile export' }

    const db = getDb()
    try {
      let summary
      db.transaction(() => { summary = deserializeProfile(db, bundle, projectId) })()
      return { ok: true, ...summary }
    } catch (err) {
      return { error: err?.message || 'Import failed' }
    }
  })

  // Share a whole project (all its profiles + deduped test data) as one .json bundle.
  ipcMain.handle('transfer:exportProject', (_, projectId) => {
    const db = getDb()
    const bundle = serializeProject(db, projectId)
    if (!bundle) return { error: 'Project not found' }
    const base = sanitize(`${bundle.project.name}-${new Date().toISOString().slice(0, 10)}`)
    const path = join(profilesDir(), `${base}.automation-project.json`)
    writeFileSync(path, JSON.stringify(bundle, null, 2), 'utf-8')
    shell.showItemInFolder(path)
    return { ok: true, path, profileCount: bundle.profiles.length, collectionCount: bundle.collections.length }
  })

  ipcMain.handle('transfer:importProject', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Import a shared project',
      filters: [{ name: 'Automation project', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (res.canceled || !res.filePaths?.[0]) return { cancelled: true }

    let bundle
    try { bundle = JSON.parse(readFileSync(res.filePaths[0], 'utf-8')) } catch { return { error: 'Not valid JSON' } }
    if (bundle?.type !== 'automation-project' || !bundle.project?.name) return { error: 'Not an Automation project export' }

    const db = getDb()
    try {
      let summary
      db.transaction(() => { summary = deserializeProject(db, bundle) })()
      return { ok: true, ...summary }
    } catch (err) {
      return { error: err?.message || 'Import failed' }
    }
  })
}
