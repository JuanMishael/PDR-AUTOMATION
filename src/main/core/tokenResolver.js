/**
 * Token resolution for the Test Data Library (Phase 1).
 *
 * Tokens are resolved in the MAIN process at generate-time, BEFORE the Playwright
 * script string is emitted. That keeps the generated script plain (no faker/runtime
 * deps baked in) and makes {{unique.*}} / {{faker.*}} values fresh per run — because
 * generation happens once per run.
 *
 * Supported token forms inside step param strings:
 *   {{Collection.field}}  — value from the active data set (falls back to the field's
 *                           default_token, which is itself resolved recursively)
 *   {{faker.path}}        — @faker-js/faker, e.g. {{faker.internet.email}},
 *                           {{faker.person.firstName}}, {{faker.string.uuid}}
 *   {{unique.key}}        — fresh-per-run value, stable within a run for the same key
 *                           (so a referenced REF stays consistent across steps)
 */
// @faker-js/faker is ESM-only, so it can't be require()'d from the CJS main bundle.
// We load it once via dynamic import() (lazily, in buildDataContext — the single async
// entry point that runs before any token resolution) and reference it synchronously after.
let faker = null

const TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g

// Build a resolution context from the DB. `dataSetId` selects the active set (optional).
// We pre-index EVERY collection's field defaults so {{AnyCollection.field}} resolves to
// its default, then override the active set's collection fields with the set's values.
export async function buildDataContext(db, dataSetId) {
  if (!faker) ({ faker } = await import('@faker-js/faker'))

  // tokens: Map<"collection.field" (lower), rawValueString>
  const tokens = new Map()

  const collections = db.prepare('SELECT id, name FROM data_collections').all()
  const byId = {}
  for (const c of collections) {
    byId[c.id] = c.name
    const fields = db.prepare('SELECT name, default_token FROM data_fields WHERE collection_id = ?').all(c.id)
    for (const f of fields) {
      tokens.set(key(c.name, f.name), f.default_token || '')
    }
  }

  // The explicitly chosen set (a per-run pick, or a repeating group's per-iteration set) fully
  // OWNS its collection — including fields it leaves blank/omitted, so negative-testing an empty
  // field works (no positive value leaks in). Every OTHER collection the scenario might touch is
  // seeded with its REPRESENTATIVE set (first positive, else first) so a plain {{Collection.field}}
  // still fills the value the tester typed instead of the field's (usually empty) default_token —
  // even across multiple collections. Plain run = no chosen set → every collection uses its rep set.
  // A field no set defines keeps its default_token (e.g. a {{faker.*}} default survives).
  const chosen = dataSetId ? db.prepare('SELECT * FROM data_sets WHERE id = ?').get(dataSetId) : null
  for (const c of collections) {
    if (chosen && c.id === chosen.collection_id) continue
    applySet(db, tokens, byId, db.prepare(
      `SELECT * FROM data_sets WHERE collection_id = ?
       ORDER BY (group_type = 'positive') DESC, sort_order LIMIT 1`).get(c.id))
  }
  if (chosen) applySet(db, tokens, byId, chosen)

  return { tokens, uniqueCache: new Map() }
}

// Overlay one set's field values onto the token map (keyed by its collection's name).
function applySet(db, tokens, byId, set) {
  if (!set) return
  const cname = byId[set.collection_id]
  if (cname == null) return
  let values = {}
  try { values = JSON.parse(set.field_values || '{}') } catch { values = {} }
  for (const [field, val] of Object.entries(values)) {
    // Empty string is a meaningful value (negative testing), so override even if blank.
    if (val != null) tokens.set(key(cname, field), String(val))
  }
}

function key(collection, field) {
  return `${String(collection).trim().toLowerCase()}.${String(field).trim().toLowerCase()}`
}

// Resolve every token in a single string. `depth` guards against default_token cycles.
export function resolveString(str, ctx, depth = 0) {
  if (typeof str !== 'string' || str.indexOf('{{') === -1 || depth > 8) return str
  return str.replace(TOKEN_RE, (match, expr) => {
    const raw = expr.trim()
    const dot = raw.indexOf('.')
    const ns = (dot === -1 ? raw : raw.slice(0, dot)).toLowerCase()
    const rest = dot === -1 ? '' : raw.slice(dot + 1).trim()

    if (ns === 'faker') return resolveFaker(rest)
    if (ns === 'unique') return resolveUnique(rest, ctx)
    if (ns === 'now') return resolveNow(rest)

    // Collection.field — value may itself contain tokens (e.g. a default of {{faker.x}}).
    const val = ctx.tokens.get(key(ns, rest))
    if (val === undefined) return match // unknown reference: leave visible for the author
    return resolveString(val, ctx, depth + 1)
  })
}

// Walk a dotted faker path and call the resolved function. Unknown paths return ''.
function resolveFaker(path) {
  if (!path) return ''
  try {
    const parts = path.split('.').map(s => s.trim()).filter(Boolean)
    let obj = faker
    for (const part of parts) {
      if (obj == null) return ''
      obj = obj[part]
    }
    const out = typeof obj === 'function' ? obj() : obj
    if (out == null) return ''
    if (out instanceof Date) return out.toISOString()   // APIs want ISO 8601, not Date.toString()
    return String(out)
  } catch {
    return ''
  }
}

// Current date/time in ISO 8601 — what SOAP (xsd:dateTime) and most JSON APIs expect.
//   {{now}} -> full ISO   {{now.datetime}} -> no ms   {{now.date}} -> YYYY-MM-DD   {{now.time}} -> HH:MM:SS
//   {{now.epoch}} -> ms since 1970
function resolveNow(rest) {
  const d = new Date()
  const iso = d.toISOString()
  const k = (rest || '').trim().toLowerCase()
  if (!k) return iso
  if (k === 'date') return iso.slice(0, 10)
  if (k === 'time') return iso.slice(11, 19)
  if (k === 'datetime') return iso.slice(0, 19)
  if (k === 'epoch' || k === 'timestamp') return String(d.getTime())
  return iso
}

// Fresh-per-run, stable within a run for the same key.
function resolveUnique(rawKey, ctx) {
  const k = (rawKey || 'value').toLowerCase()
  if (ctx.uniqueCache.has(k)) return ctx.uniqueCache.get(k)

  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 7)
  let out
  switch (k) {
    case 'email':     out = `test+${ts}${rand}@example.com`; break
    case 'timestamp': out = String(ts); break
    case 'uuid':      out = faker.string.uuid(); break
    case 'number':    out = String(ts).slice(-6); break
    default:          out = `${rawKey}-${ts}-${rand}` // e.g. {{unique.ref}} -> ref-<ts>-<rand>
  }
  ctx.uniqueCache.set(k, out)
  return out
}

/**
 * Tokens in these scenarios that reference a collection/field which doesn't exist. Those resolve
 * to nothing and get typed into the page LITERALLY ("{{Login.usernam}}"), which reads to a tester
 * as "the field didn't fill" with no clue why — the exact failure this warns about. Generator
 * namespaces (faker/unique/now) always resolve, so they're never reported.
 * Returns the distinct offending token strings, e.g. ['{{Login-SauceDemo.usernam}}'].
 */
export function findUnresolvedTokens(scenarios, ctx) {
  if (!ctx || !ctx.tokens) return []
  const out = new Set()
  const RE = /\{\{\s*([^{}]+?)\s*\}\}/g
  for (const sc of scenarios || []) {
    for (const st of sc.steps || []) {
      let p
      try { p = typeof st.params === 'string' ? JSON.parse(st.params) : (st.params || {}) } catch { p = {} }
      for (const v of Object.values(p)) {
        if (typeof v !== 'string') continue
        let m; RE.lastIndex = 0
        while ((m = RE.exec(v))) {
          const raw = m[1].trim()
          const dot = raw.indexOf('.')
          const ns = (dot === -1 ? raw : raw.slice(0, dot)).toLowerCase()
          if (ns === 'faker' || ns === 'unique' || ns === 'now') continue
          const rest = dot === -1 ? '' : raw.slice(dot + 1).trim()
          if (!ctx.tokens.has(key(ns, rest))) out.add(m[0])
        }
      }
    }
  }
  return [...out]
}

// Resolve every string value in a params object (one level deep — params are flat).
export function resolveParams(params, ctx) {
  if (!ctx || !params || typeof params !== 'object') return params
  const out = Array.isArray(params) ? [] : {}
  for (const [k, v] of Object.entries(params)) {
    out[k] = typeof v === 'string' ? resolveString(v, ctx) : v
  }
  return out
}
