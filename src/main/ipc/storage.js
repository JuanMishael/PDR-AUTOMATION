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
        UPDATE scenarios SET name=?, description=?, sort_order=?, prerequisite_id=?, skipped=?, updated_at=datetime('now')
        WHERE id=?
      `).run(scenario.name, scenario.description || '', scenario.sort_order ?? 0,
          scenario.prerequisite_id || null, scenario.skipped ? 1 : 0, scenario.id)
      return { id: scenario.id }
    }
    const id = randomUUID()
    db().prepare(`
      INSERT INTO scenarios (id, profile_id, name, description, sort_order, prerequisite_id, skipped)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, scenario.profile_id, scenario.name, scenario.description || '',
        scenario.sort_order ?? 0, scenario.prerequisite_id || null, scenario.skipped ? 1 : 0)
    return { id }
  })

  ipcMain.handle('storage:deleteScenario', (_, id) => {
    const d = db()
    // Clear any prerequisite links pointing at the scenario being deleted.
    d.prepare('UPDATE scenarios SET prerequisite_id = NULL WHERE prerequisite_id = ?').run(id)
    d.prepare('DELETE FROM scenarios WHERE id = ?').run(id)
    return { ok: true }
  })

  // Deep-copy one scenario (+ its steps) into a target profile. Returns the new id.
  // prereq is remapped only if the prerequisite is also part of the copied set.
  function cloneScenario(d, src, targetProfileId, sortOrder, idMap) {
    const newId = idMap[src.id]
    const prereq = src.prerequisite_id && idMap[src.prerequisite_id] ? idMap[src.prerequisite_id] : null
    d.prepare(`
      INSERT INTO scenarios (id, profile_id, name, description, sort_order, prerequisite_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(newId, targetProfileId, src.name, src.description || '', sortOrder, prereq)
    const steps = d.prepare('SELECT * FROM steps WHERE scenario_id = ? ORDER BY sort_order').all(src.id)
    for (const st of steps) {
      d.prepare(`
        INSERT INTO steps (id, scenario_id, action, params, label, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), newId, st.action, st.params, st.label || '', st.sort_order)
    }
  }

  // Duplicate a whole profile + all its scenarios/steps (prereq links remapped).
  ipcMain.handle('storage:duplicateProfile', (_, profileId, newName) => {
    const d = db()
    const prof = d.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId)
    if (!prof) return { error: 'Profile not found' }

    const newProfileId = randomUUID()
    const scenarios = d.prepare('SELECT * FROM scenarios WHERE profile_id = ? ORDER BY sort_order').all(profileId)
    const idMap = {}
    scenarios.forEach(s => { idMap[s.id] = randomUUID() })

    const tx = d.transaction(() => {
      d.prepare(`
        INSERT INTO profiles (id, name, type, base_url, browser, headless, timeout)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(newProfileId, (newName && newName.trim()) || `${prof.name} (copy)`,
          prof.type, prof.base_url, prof.browser, prof.headless, prof.timeout)
      scenarios.forEach((s, i) => cloneScenario(d, s, newProfileId, i, idMap))
    })
    tx()
    return { id: newProfileId }
  })

  // Copy selected scenarios into an existing target profile (appended after its current ones).
  ipcMain.handle('storage:copyScenarios', (_, scenarioIds, targetProfileId) => {
    const d = db()
    const target = d.prepare('SELECT * FROM profiles WHERE id = ?').get(targetProfileId)
    if (!target) return { error: 'Target profile not found' }

    const src = (scenarioIds || [])
      .map(id => d.prepare('SELECT * FROM scenarios WHERE id = ?').get(id))
      .filter(Boolean)
    if (!src.length) return { error: 'No scenarios to copy' }

    const idMap = {}
    src.forEach(s => { idMap[s.id] = randomUUID() })
    const existing = d.prepare('SELECT COUNT(*) AS c FROM scenarios WHERE profile_id = ?').get(targetProfileId)
    let order = existing?.c || 0

    const tx = d.transaction(() => {
      src.forEach(s => cloneScenario(d, s, targetProfileId, order++, idMap))
    })
    tx()
    return { ok: true, count: src.length }
  })

  // Duplicate one scenario (+ its steps) within the SAME profile, appended after the last.
  ipcMain.handle('storage:duplicateScenario', (_, scenarioId) => {
    const d = db()
    const src = d.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId)
    if (!src) return { error: 'Scenario not found' }
    const count = d.prepare('SELECT COUNT(*) AS c FROM scenarios WHERE profile_id = ?').get(src.profile_id)
    const newId = randomUUID()
    // cloneScenario remaps prereq only via idMap; a lone copy keeps no prereq link.
    cloneScenario(d, { ...src, name: `${src.name} (copy)` }, src.profile_id, count?.c || 0, { [src.id]: newId })
    return { id: newId }
  })

  // Reorder a profile's scenarios (Run All executes in this order).
  ipcMain.handle('storage:reorderScenarios', (_, profileId, orderedIds) => {
    const update = db().prepare('UPDATE scenarios SET sort_order = ? WHERE id = ? AND profile_id = ?')
    const tx = db().transaction((ids) => {
      ids.forEach((id, i) => update.run(i, id, profileId))
    })
    tx(orderedIds)
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

  // Copy selected steps into another scenario (same or different profile), appended after
  // its current steps. Source order is preserved (we sort by the originals' sort_order, not
  // the order ids happened to arrive in). New ids so the copies are independent.
  ipcMain.handle('storage:copySteps', (_, stepIds, targetScenarioId) => {
    const d = db()
    const target = d.prepare('SELECT * FROM scenarios WHERE id = ?').get(targetScenarioId)
    if (!target) return { error: 'Target scenario not found' }

    const steps = (stepIds || [])
      .map(id => d.prepare('SELECT * FROM steps WHERE id = ?').get(id))
      .filter(Boolean)
      .sort((a, b) => a.sort_order - b.sort_order)
    if (!steps.length) return { error: 'No steps to copy' }

    const existing = d.prepare('SELECT COUNT(*) AS c FROM steps WHERE scenario_id = ?').get(targetScenarioId)
    let order = existing?.c || 0
    const insert = d.prepare(`
      INSERT INTO steps (id, scenario_id, action, params, label, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const tx = d.transaction(() => {
      for (const st of steps) insert.run(randomUUID(), targetScenarioId, st.action, st.params, st.label || '', order++)
    })
    tx()
    return { ok: true, count: steps.length }
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

  // Clear all history, or just one profile's runs when profileId is given.
  ipcMain.handle('storage:clearHistory', (_, profileId) => {
    if (profileId) db().prepare('DELETE FROM history WHERE profile_id = ?').run(profileId)
    else db().prepare('DELETE FROM history').run()
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
