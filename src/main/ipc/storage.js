import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDb } from '../core/db'

export function registerStorageHandlers() {
  const db = () => getDb()

  // --- Settings ---
  ipcMain.handle('storage:getSettings', () => {
    const rows = db().prepare('SELECT key, value FROM settings').all()
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  })

  ipcMain.handle('storage:saveSettings', (_, settings) => {
    const upsert = db().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    const tx = db().transaction((obj) => {
      for (const [k, v] of Object.entries(obj)) upsert.run(k, String(v))
    })
    tx(settings)
    return { ok: true }
  })

  // --- Profiles ---
  ipcMain.handle('storage:getProfiles', () => {
    return db().prepare('SELECT * FROM profiles ORDER BY created_at DESC').all()
  })

  ipcMain.handle('storage:saveProfile', (_, profile) => {
    if (profile.id) {
      db().prepare(`
        UPDATE profiles SET name=?, type=?, base_url=?, browser=?, headless=?, timeout=?,
          updated_at=datetime('now') WHERE id=?
      `).run(profile.name, profile.type || 'web', profile.base_url, profile.browser || 'chromium',
          profile.headless ? 1 : 0, profile.timeout || 30000, profile.id)
      return { id: profile.id }
    }
    const id = randomUUID()
    db().prepare(`
      INSERT INTO profiles (id, name, type, base_url, browser, headless, timeout)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, profile.name, profile.type || 'web', profile.base_url,
        profile.browser || 'chromium', profile.headless ? 1 : 0, profile.timeout || 30000)
    return { id }
  })

  ipcMain.handle('storage:deleteProfile', (_, id) => {
    db().prepare('DELETE FROM profiles WHERE id = ?').run(id)
    return { ok: true }
  })

  // --- Scenarios ---
  ipcMain.handle('storage:getScenarios', (_, profileId) => {
    return db().prepare('SELECT * FROM scenarios WHERE profile_id = ? ORDER BY sort_order').all(profileId)
  })

  ipcMain.handle('storage:saveScenario', (_, scenario) => {
    if (scenario.id) {
      db().prepare(`
        UPDATE scenarios SET name=?, description=?, sort_order=?, updated_at=datetime('now')
        WHERE id=?
      `).run(scenario.name, scenario.description || '', scenario.sort_order ?? 0, scenario.id)
      return { id: scenario.id }
    }
    const id = randomUUID()
    db().prepare(`
      INSERT INTO scenarios (id, profile_id, name, description, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, scenario.profile_id, scenario.name, scenario.description || '', scenario.sort_order ?? 0)
    return { id }
  })

  ipcMain.handle('storage:deleteScenario', (_, id) => {
    db().prepare('DELETE FROM scenarios WHERE id = ?').run(id)
    return { ok: true }
  })

  // --- Steps ---
  ipcMain.handle('storage:getSteps', (_, scenarioId) => {
    return db().prepare('SELECT * FROM steps WHERE scenario_id = ? ORDER BY sort_order').all(scenarioId)
  })

  ipcMain.handle('storage:saveStep', (_, step) => {
    if (step.id) {
      db().prepare(`
        UPDATE steps SET action=?, params=?, label=?, sort_order=? WHERE id=?
      `).run(step.action, JSON.stringify(step.params || {}), step.label || '', step.sort_order ?? 0, step.id)
      return { id: step.id }
    }
    const id = randomUUID()
    db().prepare(`
      INSERT INTO steps (id, scenario_id, action, params, label, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, step.scenario_id, step.action, JSON.stringify(step.params || {}),
        step.label || '', step.sort_order ?? 0)
    return { id }
  })

  ipcMain.handle('storage:deleteStep', (_, id) => {
    db().prepare('DELETE FROM steps WHERE id = ?').run(id)
    return { ok: true }
  })

  ipcMain.handle('storage:reorderSteps', (_, scenarioId, orderedIds) => {
    const update = db().prepare('UPDATE steps SET sort_order = ? WHERE id = ? AND scenario_id = ?')
    const tx = db().transaction((ids) => {
      ids.forEach((id, i) => update.run(i, id, scenarioId))
    })
    tx(orderedIds)
    return { ok: true }
  })

  // --- History ---
  ipcMain.handle('storage:getHistory', (_, profileId) => {
    const query = profileId
      ? 'SELECT * FROM history WHERE profile_id = ? ORDER BY started_at DESC'
      : 'SELECT * FROM history ORDER BY started_at DESC LIMIT 100'
    return profileId
      ? db().prepare(query).all(profileId)
      : db().prepare(query).all()
  })

  ipcMain.handle('storage:deleteHistory', (_, id) => {
    db().prepare('DELETE FROM history WHERE id = ?').run(id)
    return { ok: true }
  })

  // --- Custom Steps ---
  ipcMain.handle('storage:getCustomSteps', () => {
    return db().prepare('SELECT * FROM custom_steps ORDER BY name').all()
  })

  ipcMain.handle('storage:saveCustomStep', (_, step) => {
    if (step.id) {
      db().prepare(`
        UPDATE custom_steps SET name=?, description=?, action=?, params_schema=?, script_template=?
        WHERE id=?
      `).run(step.name, step.description || '', step.action,
          JSON.stringify(step.params_schema || []), step.script_template, step.id)
      return { id: step.id }
    }
    const id = randomUUID()
    db().prepare(`
      INSERT INTO custom_steps (id, name, description, action, params_schema, script_template)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, step.name, step.description || '', step.action,
        JSON.stringify(step.params_schema || []), step.script_template)
    return { id }
  })

  ipcMain.handle('storage:deleteCustomStep', (_, id) => {
    db().prepare('DELETE FROM custom_steps WHERE id = ?').run(id)
    return { ok: true }
  })
}
