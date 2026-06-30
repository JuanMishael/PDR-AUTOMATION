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

function profileMeta(profile) {
  return {
    name: profile.name, type: profile.type, base_url: profile.base_url,
    browser: profile.browser, headless: profile.headless, timeout: profile.timeout
  }
}

// A profile's scenarios + steps (prereq links carried by name, remapped on import).
function serializeScenarios(db, profileId) {
  const scRows = db.prepare('SELECT * FROM scenarios WHERE profile_id = ? ORDER BY sort_order').all(profileId)
  const nameById = new Map(scRows.map(s => [s.id, s.name]))
  return scRows.map(s => ({
    name: s.name,
    description: s.description || '',
    sort_order: s.sort_order,
    prerequisiteName: s.prerequisite_id ? (nameById.get(s.prerequisite_id) || null) : null,
    steps: db.prepare('SELECT action, params, label, sort_order FROM steps WHERE scenario_id = ? ORDER BY sort_order')
      .all(s.id)
      .map(st => {
        const params = parseParams(st.params)
        // A repeating group's pinned dataSetId is a local id — meaningless on another machine. Carry
        // the set's NAME so import can repoint the pin to the matching set in the new collection.
        if (isGroupStart(st.action) && params.dataSetId) {
          const set = db.prepare('SELECT name FROM data_sets WHERE id = ?').get(params.dataSetId)
          if (set) params._dataSetName = set.name
        }
        return { action: st.action, params, label: st.label || '', sort_order: st.sort_order }
      })
  }))
}

// Build the full shareable bundle for a profile.
export function serializeProfile(db, profileId) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId)
  if (!profile) return null

  const collections = [...collectReferencedCollectionIds(db, profileId)]
    .map(id => serializeCollection(db, id))
    .filter(Boolean)

  return {
    type: 'automation-profile', version: 1, exportedAt: new Date().toISOString(),
    profile: profileMeta(profile),
    scenarios: serializeScenarios(db, profileId),
    collections
  }
}

// Build a shareable bundle for a whole project: every profile, plus ONE deduped collections list
// (a collection used by several profiles in the project is serialized once, not per-profile).
export function serializeProject(db, projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId)
  if (!project) return null

  const profiles = db.prepare('SELECT * FROM profiles WHERE project_id = ? ORDER BY created_at').all(projectId)
  const ids = new Set()
  for (const p of profiles) for (const id of collectReferencedCollectionIds(db, p.id)) ids.add(id)
  const collections = [...ids].map(id => serializeCollection(db, id)).filter(Boolean)

  return {
    type: 'automation-project', version: 1, exportedAt: new Date().toISOString(),
    project: { name: project.name, description: project.description || '' },
    profiles: profiles.map(p => ({ profile: profileMeta(p), scenarios: serializeScenarios(db, p.id) })),
    collections
  }
}

// ── Import ───────────────────────────────────────────────────────────────────

function uniqueName(taken, name) {
  if (!taken.has(name.toLowerCase())) return name
  let n = 2
  while (taken.has(`${name} (${n})`.toLowerCase())) n++
  return `${name} (${n})`
}
function uniqueProfileName(db, name) {
  return uniqueName(new Set(db.prepare('SELECT name FROM profiles').all().map(p => p.name.toLowerCase())), name)
}
function uniqueProjectName(db, name) {
  return uniqueName(new Set(db.prepare('SELECT name FROM projects').all().map(p => p.name.toLowerCase())), name)
}

// A single-profile import needs a home project (strict grouping). Prefer the caller's project,
// else the first existing one, else create a "Default" so there's always somewhere to land.
function ensureProjectId(db, projectId) {
  if (projectId) { const p = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId); if (p) return p.id }
  const any = db.prepare('SELECT id FROM projects ORDER BY created_at LIMIT 1').get()
  if (any) return any.id
  const id = randomUUID()
  db.prepare('INSERT INTO projects (id, name, description) VALUES (?, ?, ?)').run(id, 'Default', '')
  return id
}

// An order-independent fingerprint of a collection's contents (fields + sets). Two collections with
// the same signature hold the same data, so importing one over the other can reuse it rather than
// pile up a "Name_2" duplicate. Handles both bundle shape (field_values object) and DB shape (string).
function collectionSig(fields, sets) {
  const f = (fields || [])
    .map(x => [x.name, x.type || 'text', x.default_token || '', x.selector || ''])
    .sort((a, b) => a[0].localeCompare(b[0]))
  const s = (sets || [])
    .map(x => {
      let fv = x.field_values
      if (typeof fv === 'string') { try { fv = JSON.parse(fv || '{}') } catch { fv = {} } }
      fv = fv && typeof fv === 'object' ? fv : {}
      // Sort keys: a bundle's field_values and the stored row may list the same values in a
      // different key order — without this they'd fingerprint differently and never dedupe.
      return [x.name, x.group_type || 'positive', JSON.stringify(fv, Object.keys(fv).sort())]
    })
    .sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]))
  return JSON.stringify({ f, s })
}

// An existing collection whose contents are identical to the incoming bundle collection, or null.
function findIdenticalCollection(db, c) {
  const want = collectionSig(c.fields, c.sets)
  for (const row of db.prepare('SELECT id, name FROM data_collections').all()) {
    const data = readCollection(db, row.id)
    if (data && collectionSig(data.fields, data.sets) === want) return row
  }
  return null
}

// Import the bundle's collections, returning the id + name remaps the steps will need. Self-healing:
// an identical collection that already exists is REUSED (no duplicate), and tokens are repointed to
// whatever name the reused/created collection actually has — so {{Name.field}} keeps resolving.
function importCollections(db, collections) {
  const idMap = new Map()      // bundle sourceId → resolved collection id
  const renameRegexes = []     // { re, to } for tokens whose collection name changed on import
  const addRename = (from, to) => {
    if (from === to) return
    renameRegexes.push({ re: new RegExp('\\{\\{\\s*' + escapeRegex(from) + '\\s*\\.', 'g'), to: `{{${to}.` })
  }
  for (const c of (collections || [])) {
    const reuse = findIdenticalCollection(db, c)
    if (reuse) {
      if (c.sourceId) idMap.set(c.sourceId, reuse.id)
      addRename(c.name, reuse.name)
      continue
    }
    const newName = uniqueCollectionName(db, c.name)
    const newId = createCollectionFromPayload(db, c, newName)
    if (c.sourceId) idMap.set(c.sourceId, newId)
    addRename(c.name, newName)
  }
  return { idMap, renameRegexes }
}

// Recreate one profile (+ scenarios/steps) under a project, using already-imported collection remaps.
function importProfileEntry(db, entry, projectId, idMap, renameRegexes) {
  const p = entry.profile
  const profileId = randomUUID()
  const profileName = uniqueProfileName(db, p.name)
  db.prepare(`INSERT INTO profiles (id, name, type, base_url, browser, headless, timeout, project_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(profileId, profileName, p.type || 'web', p.base_url || '', p.browser || 'chromium',
      p.headless ? 1 : 0, p.timeout || 30000, projectId || null)

  const scenarios = entry.scenarios || []
  const newIdByName = new Map()
  const created = []
  scenarios.forEach((sc, i) => {
    const id = randomUUID()
    if (!newIdByName.has(sc.name)) newIdByName.set(sc.name, id)   // first of a given name wins
    created.push({ id, sc })
    db.prepare(`INSERT INTO scenarios (id, profile_id, name, description, sort_order, prerequisite_id)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, profileId, sc.name, sc.description || '', sc.sort_order ?? i, null)

    const stepInsert = db.prepare(`INSERT INTO steps (id, scenario_id, action, params, label, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)`)
    ;(sc.steps || []).forEach((st, j) => {
      const params = rewriteParams(st.params, idMap, renameRegexes)
      // Repoint a group's pinned data set to the matching-named set in its (now remapped) collection.
      // rewriteParams fixed collectionId; the old dataSetId would otherwise point at the wrong (or a
      // nonexistent) collection — the stale-pin bug. No match → leave unpinned (runs the collection's sets).
      if (isGroupStart(st.action) && params.collectionId && params._dataSetName) {
        const set = db.prepare('SELECT id FROM data_sets WHERE collection_id = ? AND name = ? ORDER BY sort_order LIMIT 1')
          .get(params.collectionId, params._dataSetName)
        params.dataSetId = set ? set.id : ''
      }
      delete params._dataSetName
      stepInsert.run(randomUUID(), id, st.action, JSON.stringify(params), st.label || '', st.sort_order ?? j)
    })
  })
  // Prereq links (now that every scenario exists).
  for (const { id, sc } of created) {
    if (sc.prerequisiteName && newIdByName.has(sc.prerequisiteName)) {
      db.prepare('UPDATE scenarios SET prerequisite_id = ? WHERE id = ?').run(newIdByName.get(sc.prerequisiteName), id)
    }
  }
  return { profileId, name: profileName, scenarioCount: scenarios.length }
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

// Recreate a profile bundle as a brand-new profile under `projectId` (its home project, resolved
// if missing). Non-destructive: clashing profile/collection names are suffixed. Caller wraps in a tx.
export function deserializeProfile(db, bundle, projectId) {
  // Accept the current marker and the legacy 'botchi-profile' so already-shared bundles still import.
  if (!bundle || (bundle.type !== 'automation-profile' && bundle.type !== 'botchi-profile') || !bundle.profile?.name) {
    throw new Error('Not an Automation profile export')
  }
  const { idMap, renameRegexes } = importCollections(db, bundle.collections)
  const home = ensureProjectId(db, projectId)
  const r = importProfileEntry(db, { profile: bundle.profile, scenarios: bundle.scenarios }, home, idMap, renameRegexes)
  return { ...r, projectId: home, collectionCount: (bundle.collections || []).length }
}

// Recreate a project bundle as a brand-new project + all its profiles, sharing ONE collection remap
// so a collection used by several profiles is imported once. Caller wraps in a transaction.
export function deserializeProject(db, bundle) {
  if (!bundle || bundle.type !== 'automation-project' || !bundle.project?.name) {
    throw new Error('Not an Automation project export')
  }
  const projectId = randomUUID()
  const projectName = uniqueProjectName(db, bundle.project.name)
  db.prepare('INSERT INTO projects (id, name, description) VALUES (?, ?, ?)')
    .run(projectId, projectName, bundle.project.description || '')

  const { idMap, renameRegexes } = importCollections(db, bundle.collections)
  let profileCount = 0, scenarioCount = 0
  for (const entry of (bundle.profiles || [])) {
    if (!entry?.profile?.name) continue
    const r = importProfileEntry(db, entry, projectId, idMap, renameRegexes)
    profileCount++
    scenarioCount += r.scenarioCount
  }
  return { projectId, name: projectName, profileCount, scenarioCount, collectionCount: (bundle.collections || []).length }
}
