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

  if (dataSetId) {
    const set = db.prepare('SELECT * FROM data_sets WHERE id = ?').get(dataSetId)
    if (set) {
      const cname = byId[set.collection_id]
      let values = {}
      try { values = JSON.parse(set.field_values || '{}') } catch { values = {} }
      for (const [field, val] of Object.entries(values)) {
        // Empty string is a meaningful value (negative testing), so override even if blank.
        if (cname != null && val != null) tokens.set(key(cname, field), String(val))
      }
    }
  }

  return { tokens, uniqueCache: new Map() }
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
    return out == null ? '' : String(out)
  } catch {
    return ''
  }
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

// Resolve every string value in a params object (one level deep — params are flat).
export function resolveParams(params, ctx) {
  if (!ctx || !params || typeof params !== 'object') return params
  const out = Array.isArray(params) ? [] : {}
  for (const [k, v] of Object.entries(params)) {
    out[k] = typeof v === 'string' ? resolveString(v, ctx) : v
  }
  return out
}
