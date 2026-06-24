import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { getDb } from '../core/db'
import { substitute, sendRequest, applyExtractions, checkAssertions, runWithAuth } from '../core/apiEngine'
import { buildWsdlCollection } from '../core/wsdlImport'

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
  const requestGetter = (db, profileId) => (id) =>
    db.prepare('SELECT * FROM api_requests WHERE id = ? AND profile_id = ?').get(id, profileId)

  // Interactive single request (Postman "Send"). Persists extractions; not logged to history.
  ipcMain.handle('api:send', async (_event, requestId) => {
    const db = getDb()
    const req = db.prepare('SELECT * FROM api_requests WHERE id = ?').get(requestId)
    if (!req) return { error: 'Request not found' }
    const vars = loadVars(db, req.profile_id)
    const auth = authFor(db, req.profile_id)

    const { response, refetched } = await runWithAuth(req, vars, auth, {
      getRequestById: requestGetter(db, req.profile_id),
      onExtract: (written) => persistVars(db, req.profile_id, written)
    })
    const assertions = checkAssertions(req, response, vars)
    return {
      request: requestSnapshot(req, vars),
      response,
      assertions,
      refetched,
      status: verdict(response, assertions),
      variables: loadVars(db, req.profile_id)
    }
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
    const getRequestById = requestGetter(db, profileId)
    const results = []

    for (const req of requests) {
      send('runner:log', { type: 'info', text: `▶ ${(req.method || 'GET').toUpperCase()} ${req.name}` })
      const { response, refetched } = await runWithAuth(req, vars, auth, {
        getRequestById,
        onExtract: (written) => persistVars(db, profileId, written)
      })
      if (refetched) send('runner:log', { type: 'info', text: '🔑 Token expired — re-fetched and retried' })
      const assertions = checkAssertions(req, response, vars)
      const status = verdict(response, assertions)
      const result = {
        id: req.id, name: req.name, label: req.name, status,
        request: requestSnapshot(req, vars),
        response: {
          status: response.status, statusText: response.statusText || '',
          timeMs: response.timeMs, headers: response.headers || {}, body: response.body || ''
        },
        assertions,
        error: response.error || (status === 'failed' ? `HTTP ${response.status}` : undefined)
      }
      results.push(result)
      send('runner:log', {
        type: status === 'passed' ? 'step' : 'step',
        id: req.id, label: req.name, status,
        text: `${status === 'passed' ? '✓' : '✗'} ${req.name} → ${response.status || response.error || '—'} (${response.timeMs}ms)`
      })
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
