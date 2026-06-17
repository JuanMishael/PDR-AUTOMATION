import { ipcMain, app, shell, dialog } from 'electron'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { writeFileSync, readFileSync, mkdirSync } from 'fs'
import { getDb } from '../core/db'

function testDataDir() {
  const dir = join(app.getPath('documents'), 'AutomationTool', 'TestData')
  mkdirSync(dir, { recursive: true })
  return dir
}
const sanitize = s => String(s).replace(/[^a-zA-Z0-9\-_]/g, '_')
const csvCell = c => `"${String(c ?? '').replace(/"/g, '""')}"`

// Read a full collection (fields + sets) shaped for export / sharing.
function readCollection(db, id) {
  const collection = db.prepare('SELECT * FROM data_collections WHERE id = ?').get(id)
  if (!collection) return null
  const fields = db.prepare('SELECT name, type, default_token, selector, sort_order FROM data_fields WHERE collection_id = ? ORDER BY sort_order').all(id)
  const sets = db.prepare('SELECT name, group_type, field_values, sort_order FROM data_sets WHERE collection_id = ? ORDER BY group_type, sort_order').all(id)
  return { collection, fields, sets }
}

// Test Data Library (Phase 1): CRUD for collections, their fields, and grouped data sets.
export function registerDataLibraryHandlers() {
  const db = () => getDb()

  // --- Collections (with nested fields + sets in one fetch for the editor) ---
  ipcMain.handle('data:getCollections', () => {
    const collections = db().prepare('SELECT * FROM data_collections ORDER BY name').all()
    return collections.map(c => ({
      ...c,
      fields: db().prepare('SELECT * FROM data_fields WHERE collection_id = ? ORDER BY sort_order').all(c.id),
      sets: db().prepare('SELECT * FROM data_sets WHERE collection_id = ? ORDER BY group_type, sort_order').all(c.id)
    }))
  })

  ipcMain.handle('data:saveCollection', (_, collection) => {
    if (collection.id) {
      db().prepare(`
        UPDATE data_collections SET name=?, description=?, updated_at=datetime('now') WHERE id=?
      `).run(collection.name, collection.description || '', collection.id)
      return { id: collection.id }
    }
    const id = randomUUID()
    db().prepare(`
      INSERT INTO data_collections (id, name, description) VALUES (?, ?, ?)
    `).run(id, collection.name, collection.description || '')
    return { id }
  })

  ipcMain.handle('data:deleteCollection', (_, id) => {
    db().prepare('DELETE FROM data_collections WHERE id = ?').run(id)
    return { ok: true }
  })

  // --- Fields ---
  ipcMain.handle('data:saveField', (_, field) => {
    if (field.id) {
      db().prepare(`
        UPDATE data_fields SET name=?, type=?, default_token=?, selector=?, sort_order=? WHERE id=?
      `).run(field.name, field.type || 'text', field.default_token || '', field.selector || '', field.sort_order ?? 0, field.id)
      return { id: field.id }
    }
    const id = randomUUID()
    db().prepare(`
      INSERT INTO data_fields (id, collection_id, name, type, default_token, selector, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, field.collection_id, field.name, field.type || 'text',
        field.default_token || '', field.selector || '', field.sort_order ?? 0)
    return { id }
  })

  ipcMain.handle('data:deleteField', (_, id) => {
    db().prepare('DELETE FROM data_fields WHERE id = ?').run(id)
    return { ok: true }
  })

  // --- Data sets ---
  ipcMain.handle('data:saveSet', (_, set) => {
    const fieldValues = JSON.stringify(set.values || {})
    if (set.id) {
      db().prepare(`
        UPDATE data_sets SET name=?, group_type=?, field_values=?, sort_order=? WHERE id=?
      `).run(set.name, set.group_type || 'positive', fieldValues, set.sort_order ?? 0, set.id)
      return { id: set.id }
    }
    const id = randomUUID()
    db().prepare(`
      INSERT INTO data_sets (id, collection_id, name, group_type, field_values, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, set.collection_id, set.name, set.group_type || 'positive', fieldValues, set.sort_order ?? 0)
    return { id }
  })

  ipcMain.handle('data:deleteSet', (_, id) => {
    db().prepare('DELETE FROM data_sets WHERE id = ?').run(id)
    return { ok: true }
  })

  // --- Export / Import (share a collection with other QA) ---
  // format: 'json' = full fidelity (fields incl. selector + all sets); 'csv' = data rows only
  // (round-trips with the "Import rows" paste box).
  ipcMain.handle('data:exportCollection', (_, id, format = 'json') => {
    const data = readCollection(db(), id)
    if (!data) return { error: 'Collection not found' }
    const base = sanitize(`${data.collection.name}-${new Date().toISOString().slice(0, 10)}`)

    if (format === 'csv') {
      const headers = [...data.fields.map(f => f.name), 'intent']
      const lines = [headers.map(csvCell).join(',')]
      for (const s of data.sets) {
        let vals = {}; try { vals = JSON.parse(s.field_values || '{}') } catch { vals = {} }
        lines.push([...data.fields.map(f => vals[f.name] ?? ''), s.group_type].map(csvCell).join(','))
      }
      const path = join(testDataDir(), `${base}.csv`)
      writeFileSync(path, lines.join('\n'), 'utf-8')
      shell.showItemInFolder(path)
      return { ok: true, path }
    }

    const payload = {
      type: 'botchi-test-data', version: 1,
      collection: { name: data.collection.name, description: data.collection.description || '' },
      fields: data.fields,
      sets: data.sets.map(s => {
        let field_values = {}; try { field_values = JSON.parse(s.field_values || '{}') } catch { field_values = {} }
        return { name: s.name, group_type: s.group_type, field_values, sort_order: s.sort_order }
      })
    }
    const path = join(testDataDir(), `${base}.json`)
    writeFileSync(path, JSON.stringify(payload, null, 2), 'utf-8')
    shell.showItemInFolder(path)
    return { ok: true, path }
  })

  // Import a collection exported as JSON → recreates it as a NEW collection.
  ipcMain.handle('data:importCollection', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Import test data collection',
      filters: [{ name: 'Test data', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (res.canceled || !res.filePaths?.[0]) return { cancelled: true }

    let payload
    try { payload = JSON.parse(readFileSync(res.filePaths[0], 'utf-8')) } catch { return { error: 'Not valid JSON' } }
    if (payload?.type !== 'botchi-test-data' || !payload.collection?.name) return { error: 'Not a Botchi test-data export' }

    const database = db()
    // Avoid clobbering an existing collection — suffix the name if it's taken.
    let name = payload.collection.name
    const taken = new Set(database.prepare('SELECT name FROM data_collections').all().map(c => c.name.toLowerCase()))
    if (taken.has(name.toLowerCase())) { let n = 2; while (taken.has(`${name} (${n})`.toLowerCase())) n++; name = `${name} (${n})` }

    const cid = randomUUID()
    database.prepare('INSERT INTO data_collections (id, name, description) VALUES (?, ?, ?)')
      .run(cid, name, payload.collection.description || '')
    let order = 0
    for (const f of (payload.fields || [])) {
      database.prepare(`INSERT INTO data_fields (id, collection_id, name, type, default_token, selector, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), cid, f.name, f.type || 'text', f.default_token || '', f.selector || '', f.sort_order ?? order++)
    }
    let sOrder = 0
    for (const s of (payload.sets || [])) {
      database.prepare(`INSERT INTO data_sets (id, collection_id, name, group_type, field_values, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), cid, s.name || `set ${sOrder + 1}`, s.group_type || 'positive',
          JSON.stringify(s.field_values || {}), s.sort_order ?? sOrder++)
    }
    return { ok: true, id: cid, name }
  })
}
