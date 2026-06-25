import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { getDb } from '../core/db'
import { substitute, sendRequest, applyExtractions, checkAssertions, runWithAuth } from '../core/apiEngine'
import { buildWsdlCollection } from '../core/wsdlImport'
import { buildDataContext, resolveString } from '../core/tokenResolver'

// Resolve Test Data Library tokens ({{Collection.field}} / {{faker.*}} / {{unique.*}}) in a
// request's string fields BEFORE the engine substitutes the flat {{var}} store. The two token
// systems don't collide — Test Data is dotted, the variable store is flat — so leftover {{var}}
// tokens (e.g. {{Token}}) pass through resolveString untouched and the engine handles them.
function applyDataTokens(req, ctx) {
  if (!ctx || !req) return req
  const r = (s) => (typeof s === 'string' ? resolveString(s, ctx) : s)
  const arr = (v) => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]') } catch { return [] } }
  return {
    ...req,
    url: r(req.url),
    body: r(req.body),
    soap_action: r(req.soap_action),
    headers: arr(req.headers).map(h => ({ ...h, key: r(h.key), value: r(h.value) })),
    query: arr(req.query).map(q => ({ ...q, key: r(q.key), value: r(q.value) }))
  }
}

// Load the profile's shared variable store as a { name: value } map.
function loadVars(db, profileId) {
  const rows = db.prepare('SELECT name, value FROM api_variables WHERE profile_id = ?').all(profileId)
  return Object.fromEntries(rows.map(r => [r.name, r.value]))
}

// Persist extracted values back so a token minted by one request survives for the next Send.
function persistVars(db, profileId, written) {
  for (const { name, value } of written) {
    const existing = db.prepare('SELECT id FROM api_variables WHERE profile_id = ? AND name = ?').get(profileId, name)
    if (existing) db.prepare('UPDATE api_variables SET value = ? WHERE id = ?').run(value, existing.id)
    else {
      const count = db.prepare('SELECT COUNT(*) AS c FROM api_variables WHERE profile_id = ?').get(profileId)
      db.prepare('INSERT INTO api_variables (id, profile_id, name, value, sort_order) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), profileId, name, value, count?.c || 0)
    }
  }
}

// A compact snapshot of what actually went out, for the response panel / reports.
function requestSnapshot(req, vars) {
  let headers = req.headers
  if (typeof headers === 'string') { try { headers = JSON.parse(headers) } catch { headers = [] } }
  return {
    method: (req.method || 'GET').toUpperCase(),
    url: substitute(req.url || '', vars),
    headers: (Array.isArray(headers) ? headers : []).filter(h => h && h.enabled !== false && h.key)
      .map(h => ({ key: substitute(String(h.key), vars), value: substitute(String(h.value ?? ''), vars) })),
    body: substitute(req.body || '', vars)
  }
}

// Decide pass/fail: network error → failed; assertions present → all must pass; else 2xx/3xx.
function verdict(response, assertions) {
  if (response.error) return 'failed'
  if (assertions.length) return assertions.every(a => a.passed) ? 'passed' : 'failed'
  return response.ok ? 'passed' : 'failed'
}

export function registerApiRunnerHandlers() {
  const sender = () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    return (channel, data) => win?.webContents.send(channel, data)
  }

  const authFor = (db, profileId) => db.prepare('SELECT * FROM api_auth WHERE profile_id = ?').get(profileId) || null
  // Pick the data set to resolve against: an explicit (validated) id, else the first row of the
  // request's bound collection+group, else none (field defaults).
  const pickSetId = (db, row, dataSetId) => {
    let setId = dataSetId
    if (setId && !db.prepare('SELECT id FROM data_sets WHERE id = ? AND collection_id = ?').get(setId, row.iterate_collection_id)) setId = null
    if (!setId && row.iterate_collection_id) {
      const first = (row.iterate_group && row.iterate_group !== 'all')
        ? db.prepare('SELECT id FROM data_sets WHERE collection_id = ? AND group_type = ? ORDER BY sort_order').get(row.iterate_collection_id, row.iterate_group)
        : db.prepare('SELECT id FROM data_sets WHERE collection_id = ? ORDER BY sort_order').get(row.iterate_collection_id)
      setId = first?.id || null
    }
    return setId
  }
  // A token-request getter that also resolves Test Data tokens (the auth/token request can use
  // {{Collection.field}} too). Uses the given data context.
  const requestGetter = (db, profileId, ctx) => (id) => {
    const r = db.prepare('SELECT * FROM api_requests WHERE id = ? AND profile_id = ?').get(id, profileId)
    return r ? applyDataTokens(r, ctx) : null
  }

  // Interactive single request (Postman "Send"). Resolves Test Data tokens from field DEFAULTS
  // (like a single web run), persists extractions; not logged to history.
  ipcMain.handle('api:send', async (_event, requestId, dataSetId = null) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM api_requests WHERE id = ?').get(requestId)
    if (!row) return { error: 'Request not found' }
    const vars = loadVars(db, row.profile_id)
    const auth = authFor(db, row.profile_id)
    const ctx = await buildDataContext(db, pickSetId(db, row, dataSetId))
    const req = applyDataTokens(row, ctx)

    const { response, refetched } = await runWithAuth(req, vars, auth, {
      getRequestById: requestGetter(db, row.profile_id, ctx),
      onExtract: (written) => persistVars(db, row.profile_id, written)
    })
    const assertions = checkAssertions(req, response, vars)
    return {
      request: requestSnapshot(req, vars),
      response,
      assertions,
      refetched,
      status: verdict(response, assertions),
      variables: loadVars(db, row.profile_id)
    }
  })

  // Resolve a request for a given row WITHOUT sending — for the "preview/export resolved" view.
  ipcMain.handle('api:resolve', async (_event, requestId, dataSetId = null) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM api_requests WHERE id = ?').get(requestId)
    if (!row) return { error: 'Request not found' }
    const vars = loadVars(db, row.profile_id)
    const ctx = await buildDataContext(db, pickSetId(db, row, dataSetId))
    const req = applyDataTokens(row, ctx)
    const snap = requestSnapshot(req, vars)
    return { ...snap, soapAction: substitute(req.soap_action || '', vars), bodyType: row.body_type }
  })

  // Run the whole collection in order through the shared variable store, streaming progress and
  // saving an API-shaped run to history (reuses the same table/columns as web runs).
  ipcMain.handle('api:runCollection', async (_event, profileId) => {
    const send = sender()
    const db = getDb()
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId)
    if (!profile) return { error: 'Profile not found' }
    const requests = db.prepare('SELECT * FROM api_requests WHERE profile_id = ? ORDER BY sort_order').all(profileId)
    if (!requests.length) return { error: 'No requests in this collection' }

    const startedAt = new Date().toISOString()
    const vars = loadVars(db, profileId)
    const auth = authFor(db, profileId)
    const defaultCtx = await buildDataContext(db, null)   // field defaults + faker/unique
    const results = []

    // Run one request against a given Test Data context; record + stream its result.
    const runOne = async (row, ctx, setName) => {
      const req = applyDataTokens(row, ctx)
      const label = setName ? `[${setName}] ${row.name}` : row.name
      const { response, refetched } = await runWithAuth(req, vars, auth, {
        getRequestById: requestGetter(db, profileId, ctx),
        onExtract: (written) => persistVars(db, profileId, written)
      })
      if (refetched) send('runner:log', { type: 'info', text: '🔑 Token expired — re-fetched and retried' })
      const assertions = checkAssertions(req, response, vars)
      const status = verdict(response, assertions)
      results.push({
        id: req.id, name: label, label, status,
        request: requestSnapshot(req, vars),
        response: {
          status: response.status, statusText: response.statusText || '',
          timeMs: response.timeMs, headers: response.headers || {}, body: response.body || ''
        },
        assertions,
        error: response.error || (status === 'failed' ? `HTTP ${response.status}` : undefined)
      })
      send('runner:log', {
        type: 'step', id: req.id, label, status,
        text: `${status === 'passed' ? '✓' : '✗'} ${label} → ${response.status || response.error || '—'} (${response.timeMs}ms)`
      })
    }

    for (const row of requests) {
      // Data-driven request: run once per data set in its collection+group (the API repeating group).
      if (row.iterate_collection_id) {
        const sets = (row.iterate_group && row.iterate_group !== 'all')
          ? db.prepare('SELECT * FROM data_sets WHERE collection_id = ? AND group_type = ? ORDER BY sort_order').all(row.iterate_collection_id, row.iterate_group)
          : db.prepare('SELECT * FROM data_sets WHERE collection_id = ? ORDER BY sort_order').all(row.iterate_collection_id)
        if (!sets.length) {
          send('runner:log', { type: 'info', text: `▶ ${(row.method || 'GET').toUpperCase()} ${row.name} — no data sets, skipped` })
          continue
        }
        send('runner:log', { type: 'info', text: `▶ ${(row.method || 'GET').toUpperCase()} ${row.name} — ${sets.length} data set(s)` })
        for (const set of sets) await runOne(row, await buildDataContext(db, set.id), set.name)
      } else {
        send('runner:log', { type: 'info', text: `▶ ${(row.method || 'GET').toUpperCase()} ${row.name}` })
        await runOne(row, defaultCtx)
      }
    }

    const finishedAt = new Date().toISOString()
    const passed = results.filter(r => r.status === 'passed').length
    const failed = results.filter(r => r.status === 'failed').length
    const overallStatus = failed > 0 ? 'failed' : 'passed'
    const durationMs = new Date(finishedAt) - new Date(startedAt)

    const historyId = randomUUID()
    db.prepare(`
      INSERT INTO history (id, profile_id, profile_name, scenario_id, scenario_name, status,
        started_at, finished_at, duration_ms, steps_total, steps_passed, steps_failed,
        scenarios_total, scenarios_passed, scenarios_failed, scenario_results, log, trace_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      historyId, profile.id, profile.name, null, null,
      overallStatus, startedAt, finishedAt, durationMs,
      results.length, passed, failed,
      0, 0, 0, '[]',
      JSON.stringify(results), null
    )

    const summary = {
      runId: historyId, status: overallStatus, passed, failed, durationMs,
      scenariosTotal: 0, scenariosPassed: 0, scenariosFailed: 0, scenarioResults: []
    }
    send('runner:complete', summary)
    return summary
  })

  // Import a WSDL: scaffold one SOAP request per operation into the collection.
  ipcMain.handle('api:importWsdl', async (_event, profileId, wsdlUrl) => {
    const db = getDb()
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId)
    if (!profile) return { error: 'Profile not found' }
    if (!wsdlUrl || !/^https?:\/\//i.test(wsdlUrl)) return { error: 'Enter a full http(s) WSDL URL' }
    try {
      const { operations, endpoint } = await buildWsdlCollection(wsdlUrl)
      if (!operations.length) return { error: 'No SOAP operations found in that WSDL' }

      const start = db.prepare('SELECT COUNT(*) AS c FROM api_requests WHERE profile_id = ?').get(profileId)?.c || 0
      const insert = db.prepare(`
        INSERT INTO api_requests (id, profile_id, name, description, method, url, headers, query,
          body, body_type, soap_action, extract, assertions, sort_order)
        VALUES (?, ?, ?, ?, 'POST', ?, '[]', '[]', ?, 'soap', ?, '[]', '[]', ?)
      `)
      const tx = db.transaction(() => {
        operations.forEach((op, i) => {
          insert.run(randomUUID(), profileId, op.name, `SOAP operation · ${op.name}`,
            endpoint, op.envelope, op.soapAction, start + i)
        })
      })
      tx()
      return { ok: true, count: operations.length, endpoint, operations: operations.map(o => o.name) }
    } catch (e) {
      return { error: e?.message || String(e) }
    }
  })
}
