// apiEngine.js — the stateful HTTP engine behind API profiles.
//
// Runs IN the main process (not the spawn-system-node path web runs use): pure HTTP has none
// of the Electron-binary crash issues that forced the spawn, the variable/token store is
// stateful, and in-process makes the interactive "Send" button instant. Requests go out over
// Node's built-in http/https with rejectUnauthorized:false — the API mirror of the web runner's
// ignoreHTTPSErrors:true (internal/QA self-signed certs).
import http from 'http'
import https from 'https'
import { URL } from 'url'
import { XMLParser } from 'fast-xml-parser'

const xml = new XMLParser({ removeNSPrefix: true, ignoreAttributes: false, attributeNamePrefix: '@_' })

const insecureHttps = new https.Agent({ rejectUnauthorized: false })

// The Content-Type the engine derives from a request's body_type when none is set explicitly.
// Exported so the Postman exporter materializes exactly the same header the live Send transmits.
export const BODY_CONTENT_TYPES = {
  json: 'application/json',
  xml: 'application/xml',
  soap: 'text/xml; charset=utf-8',
  form: 'application/x-www-form-urlencoded'
}

// Replace {{name}} tokens against a { name: value } map. Unknown tokens are left intact so the
// user can see what didn't resolve.
export function substitute(str, vars) {
  if (typeof str !== 'string' || !str.includes('{{')) return str
  return str.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name] ?? '') : m)
}

// Turn the stored header/query arrays ([{key,value,enabled}]) into substituted pairs.
function pairs(arr, vars) {
  let list = arr
  if (typeof list === 'string') { try { list = JSON.parse(list) } catch { list = [] } }
  return (Array.isArray(list) ? list : [])
    .filter(p => p && p.enabled !== false && p.key)
    .map(p => [substitute(String(p.key), vars), substitute(String(p.value ?? ''), vars)])
}

// Resolve a dot/bracket path (e.g. "data.token", "items[0].id") against a parsed object.
function resolvePath(obj, path) {
  if (!path) return undefined
  const parts = String(path).replace(/\[(\d+)\]/g, '.$1').replace(/^\$\.?/, '').split('.').filter(Boolean)
  let cur = obj
  for (const part of parts) {
    if (cur == null) return undefined
    cur = cur[part]
  }
  return cur
}

// Fire one request. `req` is a stored api_requests row (or equivalent). Returns a plain result
// object; never throws — network errors are returned as { ok:false, error }.
export function sendRequest(req, vars = {}, { timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    let urlStr = substitute(req.url || '', vars)
    let target
    try {
      target = new URL(urlStr)
    } catch {
      return resolve({ ok: false, status: 0, error: `Invalid URL: ${urlStr}`, timeMs: 0 })
    }
    for (const [k, v] of pairs(req.query, vars)) target.searchParams.append(k, v)

    const headers = {}
    for (const [k, v] of pairs(req.headers, vars)) headers[k] = v

    let body = substitute(req.body || '', vars)
    const bodyType = req.body_type || 'none'
    if (body && !headerSet(headers, 'content-type') && BODY_CONTENT_TYPES[bodyType]) {
      headers['Content-Type'] = BODY_CONTENT_TYPES[bodyType]
    }
    if (bodyType === 'soap' && req.soap_action && !headerSet(headers, 'soapaction')) {
      headers['SOAPAction'] = `"${substitute(req.soap_action, vars)}"`
    }
    const method = (req.method || 'GET').toUpperCase()
    if (body && method !== 'GET' && method !== 'HEAD' && !headerSet(headers, 'content-length')) {
      headers['Content-Length'] = Buffer.byteLength(body)
    }

    const mod = target.protocol === 'https:' ? https : http
    const started = Date.now()
    const reqOpts = {
      method, headers,
      ...(target.protocol === 'https:' ? { agent: insecureHttps } : {})
    }
    const cr = mod.request(target, reqOpts, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 400,
          status: res.statusCode,
          statusText: res.statusMessage || '',
          headers: res.headers,
          body: raw,
          timeMs: Date.now() - started
        })
      })
    })
    cr.on('error', (err) => resolve({ ok: false, status: 0, error: err.message, timeMs: Date.now() - started }))
    cr.setTimeout(timeout, () => { cr.destroy(new Error(`Request timed out after ${timeout}ms`)) })
    if (body && method !== 'GET' && method !== 'HEAD') cr.write(body)
    cr.end()
  })
}

function headerSet(headers, name) {
  return Object.keys(headers).some(k => k.toLowerCase() === name)
}
function headerGet(headers, name) {
  const k = Object.keys(headers || {}).find(h => h.toLowerCase() === name.toLowerCase())
  return k ? headers[k] : undefined
}

// Pull configured values out of a response into the shared vars map. Returns the names written
// so the caller can persist them back to api_variables. Mutates `vars`.
export function applyExtractions(req, response, vars) {
  let list = req.extract
  if (typeof list === 'string') { try { list = JSON.parse(list) } catch { list = [] } }
  if (!Array.isArray(list) || !list.length) return []

  let jsonObj, xmlObj
  const written = []
  for (const ex of list) {
    if (!ex || !ex.var) continue
    let val
    if (ex.from === 'status') val = response.status
    else if (ex.from === 'header') val = headerGet(response.headers, ex.path)
    else if (ex.from === 'xml') {
      if (xmlObj === undefined) { try { xmlObj = xml.parse(response.body || '') } catch { xmlObj = null } }
      val = resolvePath(xmlObj, ex.path)
    } else {
      // default: json
      if (jsonObj === undefined) { try { jsonObj = JSON.parse(response.body || 'null') } catch { jsonObj = null } }
      val = resolvePath(jsonObj, ex.path)
    }
    if (val !== undefined) {
      vars[ex.var] = typeof val === 'object' ? JSON.stringify(val) : String(val)
      written.push({ name: ex.var, value: vars[ex.var] })
    }
  }
  return written
}

// Evaluate simple assertions against a response. Returns [{type, expected, actual, passed}].
export function checkAssertions(req, response, vars = {}) {
  let list = req.assertions
  if (typeof list === 'string') { try { list = JSON.parse(list) } catch { list = [] } }
  if (!Array.isArray(list)) return []
  return list.filter(a => a && a.type).map(a => {
    const expected = substitute(String(a.expected ?? ''), vars)
    let actual, passed
    if (a.type === 'status') { actual = String(response.status); passed = actual === expected }
    else if (a.type === 'bodyContains') { actual = response.body || ''; passed = actual.includes(expected) }
    else if (a.type === 'ok') { actual = String(response.ok); passed = response.ok === true }
    else { actual = ''; passed = false }
    return { type: a.type, expected, actual: a.type === 'bodyContains' ? '(body)' : actual, passed }
  })
}

// Inject the profile auth header, send, and — on 401 (or empty token) — silently re-run the
// configured token request, re-extract, and retry once. `getRequestById` loads a sibling request
// row (the token request). `onExtract(written)` persists newly-extracted vars.
export async function runWithAuth(req, vars, auth, { getRequestById, onExtract, timeout } = {}) {
  const isTokenReq = auth && auth.token_request_id && auth.token_request_id === req.id
  const useAuth = auth && auth.type && auth.type !== 'none' && !isTokenReq

  const refetchToken = async () => {
    if (!auth || !auth.token_request_id) return false
    const tokenReq = getRequestById && getRequestById(auth.token_request_id)
    if (!tokenReq) return false
    const tres = await sendRequest(tokenReq, vars, { timeout })
    const written = applyExtractions(tokenReq, tres, vars)
    if (onExtract && written.length) onExtract(written)
    return written.length > 0 || tres.ok
  }

  // Proactively mint a token if we'll need one and don't have it yet.
  if (useAuth && auth.token_var && !vars[auth.token_var]) {
    await refetchToken()
  }

  const send = async () => {
    const effective = useAuth ? withAuthHeader(req, auth, vars) : req
    return sendRequest(effective, vars, { timeout })
  }

  let response = await send()
  let refetched = false
  if (useAuth && response.status === 401 && auth.refetch_on === '401') {
    refetched = await refetchToken()
    if (refetched) response = await send()
  }
  // Always apply this request's own extractions (e.g. the token request itself).
  const written = applyExtractions(req, response, vars)
  if (onExtract && written.length) onExtract(written)
  return { response, refetched }
}

// Clone a request with the auth header merged into its headers array.
function withAuthHeader(req, auth, vars) {
  const headerName = auth.header_name || 'Authorization'
  const prefix = auth.header_prefix ?? 'Bearer '
  const tokenVal = vars[auth.token_var || 'token'] ?? ''
  let headers = req.headers
  if (typeof headers === 'string') { try { headers = JSON.parse(headers) } catch { headers = [] } }
  headers = (Array.isArray(headers) ? headers : []).filter(h => (h.key || '').toLowerCase() !== headerName.toLowerCase())
  headers.push({ key: headerName, value: `${prefix}${tokenVal}`, enabled: true })
  return { ...req, headers }
}
