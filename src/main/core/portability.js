// Profile portability: serialize a whole profile (scenarios + steps + the Test Data Library
// collections it references) into one shareable bundle, and recreate it on another machine.
//
// The tricky part is that a profile is NOT self-contained — its steps reference test data two ways:
//   • {{Collection.field}} tokens in step params  → by collection NAME
//   • repeating-group steps store params.collectionId → by collection ID
// On import we suffix clashing names, so BOTH reference styles in the copied steps must be rewritten
// (id → new id, old name → possibly-suffixed new name) to keep the imported profile self-consistent.

import { randomUUID } from 'crypto'
import { readCollection, uniqueCollectionName, createCollectionFromPayload } from '../ipc/dataLibrary'

const isGroupStart = a => a === 'groupStart' || a === 'loopStart'

function parseParams(p) {
  if (typeof p !== 'string') return p || {}
  try { return JSON.parse(p) } catch { return {} }
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

// Collection names referenced by {{Name.field}} tokens in a string (skips faker/unique helpers).
function tokenCollectionNames(str) {
  if (typeof str !== 'string' || str.indexOf('{{') === -1) return []
  const out = []
  const re = /\{\{\s*([^.}]+?)\s*\.[^}]*\}\}/g
  let m
  while ((m = re.exec(str))) {
    const name = m[1].trim()
    if (name && name !== 'faker' && name !== 'unique') out.push(name)
  }
  return out
}

// ── Export ───────────────────────────────────────────────────────────────────

// Every collection id a profile depends on: group collectionIds + token names (resolved to ids),
// then a transitive pass so a collection referenced only via another collection's default/value is
// pulled in too. Keeps the bundle self-contained without dumping unrelated (credential) collections.
export function collectReferencedCollectionIds(db, profileId) {
  const collections = db.prepare('SELECT id, name FROM data_collections').all()
  const idByName = new Map(collections.map(c => [c.name.toLowerCase(), c.id]))
  const found = new Set()

  const addByName = name => { const id = idByName.get(String(name).toLowerCase()); if (id) found.add(id) }

  const scenarios = db.prepare('SELECT id FROM scenarios WHERE profile_id = ?').all(profileId)
  for (const sc of scenarios) {
    const steps = db.prepare('SELECT action, params FROM steps WHERE scenario_id = ?').all(sc.id)
    for (const st of steps) {
      const p = parseParams(st.params)
      if (isGroupStart(st.action) && p.collectionId) found.add(p.collectionId)
      for (const v of Object.values(p)) for (const n of tokenCollectionNames(v)) addByName(n)
    }
  }

  // Transitive closure: a chosen collection's field defaults / set values may reference others.
  let changed = true
  while (changed) {
    changed = false
    for (const id of [...found]) {
      const data = readCollection(db, id)
      if (!data) continue
      const strings = [
        ...data.fields.map(f => f.default_token || ''),
        ...data.sets.map(s => s.field_values || '')
      ]
      for (const str of strings) for (const n of tokenCollectionNames(str)) {
        const refId = idByName.get(n.toLowerCase())
        if (refId && !found.has(refId)) { found.add(refId); changed = true }
      }
    }
  }
  return found
}

// One collection as a bundle entry (sourceId kept so import can remap group collectionIds).
export function serializeCollection(db, id) {
  const data = readCollection(db, id)
  if (!data) return null
  return {
    sourceId: id,
    name: data.collection.name,
    description: data.collection.description || '',
    fields: data.fields,
    sets: data.sets.map(s => {
      let field_values = {}
      try { field_values = JSON.parse(s.field_values || '{}') } catch { field_values = {} }
      return { name: s.name, group_type: s.group_type, field_values, sort_order: s.sort_order }
    })
  }
}

// Build the full shareable bundle for a profile.
export function serializeProfile(db, profileId) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId)
  if (!profile) return null

  const scRows = db.prepare('SELECT * FROM scenarios WHERE profile_id = ? ORDER BY sort_order').all(profileId)
  const nameById = new Map(scRows.map(s => [s.id, s.name]))
  const scenarios = scRows.map(s => ({
    name: s.name,
    description: s.description || '',
    sort_order: s.sort_order,
    prerequisiteName: s.prerequisite_id ? (nameById.get(s.prerequisite_id) || null) : null,
    steps: db.prepare('SELECT action, params, label, sort_order FROM steps WHERE scenario_id = ? ORDER BY sort_order')
      .all(s.id)
      .map(st => ({ action: st.action, params: parseParams(st.params), label: st.label || '', sort_order: st.sort_order }))
  }))

  const collections = [...collectReferencedCollectionIds(db, profileId)]
    .map(id => serializeCollection(db, id))
    .filter(Boolean)

  return {
    type: 'botchi-profile', version: 1, exportedAt: new Date().toISOString(),
    profile: {
      name: profile.name, type: profile.type, base_url: profile.base_url,
      browser: profile.browser, headless: profile.headless, timeout: profile.timeout
    },
    scenarios,
    collections
  }
}

// ── Import ───────────────────────────────────────────────────────────────────

function uniqueProfileName(db, name) {
  const taken = new Set(db.prepare('SELECT name FROM profiles').all().map(p => p.name.toLowerCase()))
  if (!taken.has(name.toLowerCase())) return name
  let n = 2
  while (taken.has(`${name} (${n})`.toLowerCase())) n++
  return `${name} (${n})`
}

// Rewrite a step's params for the new machine: remap a group's collectionId (old → new) and rewrite
// {{OldName.field}} tokens to {{NewName.field}} for every collection that got renamed on import.
function rewriteParams(params, idMap, renameRegexes) {
  const out = {}
  for (const [k, v] of Object.entries(params || {})) {
    if (k === 'collectionId' && typeof v === 'string' && idMap.has(v)) { out[k] = idMap.get(v); continue }
    if (typeof v === 'string') {
      let s = v
      for (const { re, to } of renameRegexes) s = s.replace(re, to)
      out[k] = s
    } else out[k] = v
  }
  return out
}

// Recreate a bundle as a brand-new profile (+ scenarios/steps/collections). Non-destructive: clashing
// profile/collection names are suffixed. Returns a summary. Caller wraps this in a transaction.
export function deserializeProfile(db, bundle) {
  if (!bundle || bundle.type !== 'botchi-profile' || !bundle.profile?.name) {
    throw new Error('Not a Botchi profile export')
  }

  // 1. Collections first — build id + name remaps the steps will need.
  const idMap = new Map()          // bundle sourceId → new collection id
  const renameRegexes = []         // { re, to } for tokens whose collection was renamed
  for (const c of (bundle.collections || [])) {
    const newName = uniqueCollectionName(db, c.name)
    const newId = createCollectionFromPayload(db, c, newName)
    if (c.sourceId) idMap.set(c.sourceId, newId)
    if (newName !== c.name) {
      renameRegexes.push({ re: new RegExp('\\{\\{\\s*' + escapeRegex(c.name) + '\\s*\\.', 'g'), to: `{{${newName}.` })
    }
  }

  // 2. Profile.
  const p = bundle.profile
  const profileId = randomUUID()
  const profileName = uniqueProfileName(db, p.name)
  db.prepare(`INSERT INTO profiles (id, name, type, base_url, browser, headless, timeout)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(profileId, profileName, p.type || 'web', p.base_url || '', p.browser || 'chromium',
      p.headless ? 1 : 0, p.timeout || 30000)

  // 3. Scenarios (new ids), then steps with rewritten params. Prereq remapped by name (2nd pass).
  const scenarios = bundle.scenarios || []
  const newIdByName = new Map()
  const created = []
  scenarios.forEach((sc, i) => {
    const id = randomUUID()
    if (!newIdByName.has(sc.name)) newIdByName.set(sc.name, id)   // first of a given name wins (names are normally unique)
    created.push({ id, sc })
    db.prepare(`INSERT INTO scenarios (id, profile_id, name, description, sort_order, prerequisite_id)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, profileId, sc.name, sc.description || '', sc.sort_order ?? i, null)

    const stepInsert = db.prepare(`INSERT INTO steps (id, scenario_id, action, params, label, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)`)
    ;(sc.steps || []).forEach((st, j) => {
      const params = rewriteParams(st.params, idMap, renameRegexes)
      stepInsert.run(randomUUID(), id, st.action, JSON.stringify(params), st.label || '', st.sort_order ?? j)
    })
  })
  // Prereq links (now that every scenario exists).
  for (const { id, sc } of created) {
    if (sc.prerequisiteName && newIdByName.has(sc.prerequisiteName)) {
      db.prepare('UPDATE scenarios SET prerequisite_id = ? WHERE id = ?').run(newIdByName.get(sc.prerequisiteName), id)
    }
  }

  return {
    profileId, name: profileName,
    scenarioCount: scenarios.length,
    collectionCount: (bundle.collections || []).length
  }
}
