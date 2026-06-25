// postmanExport.js — turn an API profile into a Postman Collection v2.1 file.
//
// The point of this is that "Send" in the app does more than the stored request says: the engine
// injects Content-Type / SOAPAction at send-time (see apiEngine.sendRequest), the auth call's token
// is woven into every request, and a request bound to a Test Data collection fans out into one call
// per data row. None of that is visible to Postman. So the exporter REPLAYS that same resolution and
// materializes the result as explicit headers and one Postman request per data row — so a collection
// dropped into Postman behaves like it did in the app.
//
// Resolution policy (mirrors the runner):
//   • Test Data tokens ({{Collection.field}}, {{faker.*}}, {{unique.*}}, {{now}}) are baked to literal
//     values per data row — a fresh context per row, so {{unique.*}} differs between rows.
//   • The flat variable store ({{Token}} + profile constants) is LEFT as {{name}} and emitted as
//     Postman collection variables (same {{}} syntax), so the token stays editable/refreshable.
import { BODY_CONTENT_TYPES } from './apiEngine'
import { buildDataContext, resolveString } from './tokenResolver'

const asArray = v => {
  if (Array.isArray(v)) return v
  try { return JSON.parse(v || '[]') } catch { return [] }
}

// Resolve Test Data tokens in a request's string fields; leave the flat {{var}} store intact.
// (Same contract as apiRunner.applyDataTokens — kept local so this core module stays electron-free.)
function applyDataTokens(req, ctx) {
  if (!ctx) return req
  const r = s => (typeof s === 'string' ? resolveString(s, ctx) : s)
  return {
    ...req,
    url: r(req.url),
    body: r(req.body),
    soap_action: r(req.soap_action),
    headers: asArray(req.headers).map(h => ({ ...h, key: r(h.key), value: r(h.value) })),
    query: asArray(req.query).map(q => ({ ...q, key: r(q.key), value: r(q.value) }))
  }
}

// Build the explicit Postman header list: stored headers + the implicit ones the engine would add.
function buildHeaders(req, auth) {
  const out = asArray(req.headers)
    .filter(h => h && h.key)
    .map(h => ({ key: String(h.key), value: String(h.value ?? ''), ...(h.enabled === false ? { disabled: true } : {}) }))
  const live = name => out.some(h => h.key.toLowerCase() === name.toLowerCase() && !h.disabled)

  const bodyType = req.body_type || 'none'
  if (req.body && BODY_CONTENT_TYPES[bodyType] && !live('content-type')) {
    out.push({ key: 'Content-Type', value: BODY_CONTENT_TYPES[bodyType] })
  }
  if (bodyType === 'soap' && req.soap_action && !live('soapaction')) {
    out.push({ key: 'SOAPAction', value: `"${req.soap_action}"` })
  }
  // Auth header — token stays a Postman variable so it can be refreshed in one place.
  const isTokenReq = auth && auth.token_request_id && auth.token_request_id === req.id
  if (auth && auth.type && auth.type !== 'none' && !isTokenReq) {
    const name = auth.header_name || 'Authorization'
    const prefix = auth.header_prefix ?? 'Bearer '
    const varName = auth.token_var || 'token'
    if (!live(name)) out.push({ key: name, value: `${prefix}{{${varName}}}` })
  }
  return out
}

function buildUrl(req) {
  const rawUrl = req.url || ''
  const query = asArray(req.query)
    .filter(q => q && q.key)
    .map(q => ({ key: String(q.key), value: String(q.value ?? ''), ...(q.enabled === false ? { disabled: true } : {}) }))
  const url = { raw: rawUrl }
  try {
    const u = new URL(rawUrl)
    url.protocol = u.protocol.replace(':', '')
    url.host = u.hostname.split('.')
    if (u.port) url.port = u.port
    url.path = u.pathname.split('/').filter(Boolean)
  } catch { /* flat {{var}} in the URL — Postman parses raw at send-time */ }
  if (query.length) {
    url.query = query
    const active = query.filter(q => !q.disabled).map(q => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`)
    if (active.length) url.raw = rawUrl + (rawUrl.includes('?') ? '&' : '?') + active.join('&')
  }
  return url
}

function buildBody(req) {
  const bodyType = req.body_type || 'none'
  if (!req.body || bodyType === 'none') return undefined
  if (bodyType === 'form') {
    return {
      mode: 'urlencoded',
      urlencoded: req.body.split('&').filter(Boolean).map(pair => {
        const i = pair.indexOf('=')
        const key = i === -1 ? pair : pair.slice(0, i)
        const value = i === -1 ? '' : pair.slice(i + 1)
        return { key: decodeURIComponent(key), value: decodeURIComponent(value) }
      })
    }
  }
  const language = bodyType === 'json' ? 'json' : 'xml'
  return { mode: 'raw', raw: req.body, options: { raw: { language } } }
}

// One Postman item from a (data-token-resolved) request row.
function buildItem(req, auth, name) {
  const item = {
    name: name || req.name,
    request: {
      method: (req.method || 'GET').toUpperCase(),
      header: buildHeaders(req, auth),
      url: buildUrl(req)
    }
  }
  const body = buildBody(req)
  if (body) item.request.body = body
  if (req.description) item.request.description = req.description
  return item
}

// Pick the data sets a request fans out over (mirrors apiRunner.runCollection's repeat logic).
function setsFor(db, row) {
  if (!row.iterate_collection_id) return null
  return (row.iterate_group && row.iterate_group !== 'all')
    ? db.prepare('SELECT * FROM data_sets WHERE collection_id = ? AND group_type = ? ORDER BY sort_order').all(row.iterate_collection_id, row.iterate_group)
    : db.prepare('SELECT * FROM data_sets WHERE collection_id = ? ORDER BY sort_order').all(row.iterate_collection_id)
}

// Build the full Postman v2.1 collection object for a profile. Returns { collection } or { error }.
export async function buildPostmanCollection(db, profileId) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId)
  if (!profile) return { error: 'Profile not found' }
  const rows = db.prepare('SELECT * FROM api_requests WHERE profile_id = ? ORDER BY sort_order').all(profileId)
  if (!rows.length) return { error: 'No requests in this collection' }
  const auth = db.prepare('SELECT * FROM api_auth WHERE profile_id = ?').get(profileId) || null

  let requestCount = 0
  const items = []
  for (const row of rows) {
    const sets = setsFor(db, row)
    if (sets && sets.length) {
      // Data-driven: a folder per request, one item per data row (token baked per row).
      const folder = { name: row.name, item: [] }
      for (const set of sets) {
        const ctx = await buildDataContext(db, set.id)
        const resolved = applyDataTokens(row, ctx)
        folder.item.push(buildItem(resolved, auth, set.name || `Row ${folder.item.length + 1}`))
        requestCount++
      }
      items.push(folder)
    } else if (sets && !sets.length) {
      // Bound to a collection that has no rows — emit the field-default form so it's still usable.
      const ctx = await buildDataContext(db, null)
      items.push(buildItem(applyDataTokens(row, ctx), auth, row.name))
      requestCount++
    } else {
      const ctx = await buildDataContext(db, null)
      items.push(buildItem(applyDataTokens(row, ctx), auth, row.name))
      requestCount++
    }
  }

  // Collection variables = the flat store, with the auth token var guaranteed present.
  const vars = db.prepare('SELECT name, value FROM api_variables WHERE profile_id = ?').all(profileId)
  const variable = vars.map(v => ({ key: v.name, value: v.value ?? '' }))
  if (auth && auth.token_var && !variable.some(v => v.key === auth.token_var)) {
    variable.push({ key: auth.token_var, value: '' })
  }

  const collection = {
    info: {
      name: `${profile.name} (Automation export)`,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      description: 'Exported from Automation API Profiles (beta). Headers (Content-Type/SOAPAction) and per-row test data are materialized; the auth token is a collection variable.'
    },
    item: items,
    ...(variable.length ? { variable } : {})
  }
  return { collection, requestCount }
}
