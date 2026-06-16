import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDb } from '../core/db'

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
        UPDATE data_fields SET name=?, type=?, default_token=?, sort_order=? WHERE id=?
      `).run(field.name, field.type || 'text', field.default_token || '', field.sort_order ?? 0, field.id)
      return { id: field.id }
    }
    const id = randomUUID()
    db().prepare(`
      INSERT INTO data_fields (id, collection_id, name, type, default_token, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, field.collection_id, field.name, field.type || 'text',
        field.default_token || '', field.sort_order ?? 0)
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
}
