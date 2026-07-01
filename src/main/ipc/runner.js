import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { getDb } from '../core/db'
import { runWeb, stopRun } from '../core/webRunner'
import { buildDataContext } from '../core/tokenResolver'
import { expandGroups } from '../core/groupExpand'
import { refocusMainWindow } from '../core/windowFocus'

// Build a single scenario's full step list for an ISOLATED run: its prerequisite chain
// (e.g. Login) first, then its own steps — all in one browser. sort_order is
// re-sequenced so prerequisite steps stay ahead of the scenario's own. Cycle-guarded.
function collectSteps(db, scenario, seen = new Set()) {
  if (seen.has(scenario.id)) return []
  seen.add(scenario.id)

  let prereqSteps = []
  if (scenario.prerequisite_id) {
    const pre = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenario.prerequisite_id)
    if (pre) prereqSteps = collectSteps(db, pre, seen)
  }

  const own = db.prepare('SELECT * FROM steps WHERE scenario_id = ? ORDER BY sort_order').all(scenario.id)
  const combined = [...prereqSteps, ...own]
  combined.forEach((s, i) => { s.sort_order = i })
  return combined
}

// Runs the given scenario groups in ONE browser session and records history.
// scenarioMeta is optional { scenarioId, scenarioName } for isolated single-scenario runs.
async function executeRun({ profile, scenarios, settings, scenarioMeta = {}, dataSetId = null, send }) {
  const runId = randomUUID()
  const startedAt = new Date().toISOString()

  // Tag every event with the profile so the renderer can demux concurrent (parallel) runs.
  // 'started' carries the live runId (the stopRun key) up front, before any 'complete'.
  const tag = (data) => ({ ...data, profileId: profile.id, profileName: profile.name })
  send('runner:started', tag({ runId }))

  // Resolve test-data tokens fresh for THIS run (so {{unique.*}}/{{faker.*}} differ per run).
  // With no collections/sets this is an empty context and the run path is unchanged.
  const dataContext = await buildDataContext(getDb(), dataSetId)

  const { status, results, scenarioResults = [], fatalError, tracePath, networkPath } = await runWeb({
    runId,
    profile,
    scenarios,
    settings,
    dataContext,
    onLog: (data) => send('runner:log', tag(data)),
    onComplete: () => {}
  })

  if (fatalError) send('runner:log', { type: 'error', text: `✗ ${fatalError}` })
  if (tracePath)  send('runner:log', { type: 'info', text: `📎 Trace saved: ${tracePath}` })
  if (networkPath) send('runner:log', { type: 'info', text: `🌐 Network log captured` })

  const finishedAt = new Date().toISOString()
  const passed = results.filter(r => r.status === 'passed').length
  const failed = results.filter(r => r.status === 'failed').length
  const scenariosPassed = scenarioResults.filter(s => s.status === 'passed').length
  const scenariosFailed = scenarioResults.filter(s => s.status === 'failed').length
  const overallStatus = fatalError || failed > 0 ? 'failed' : 'passed'
  const durationMs = new Date(finishedAt) - new Date(startedAt)

  const historyId = randomUUID()
  getDb().prepare(`
    INSERT INTO history (id, profile_id, profile_name, scenario_id, scenario_name, status,
      started_at, finished_at, duration_ms, steps_total, steps_passed, steps_failed,
      scenarios_total, scenarios_passed, scenarios_failed, scenario_results, log, trace_path, network_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    historyId, profile.id, profile.name,
    scenarioMeta.scenarioId || null, scenarioMeta.scenarioName || null,
    overallStatus, startedAt, finishedAt, durationMs,
    results.length, passed, failed,
    scenarioResults.length, scenariosPassed, scenariosFailed, JSON.stringify(scenarioResults),
    JSON.stringify(results), tracePath || null, networkPath || null
  )

  const summary = {
    runId: historyId, status: overallStatus, passed, failed, durationMs,
    scenariosTotal: scenarioResults.length, scenariosPassed, scenariosFailed, scenarioResults
  }
  send('runner:complete', tag(summary))
  refocusMainWindow()   // the headful run browser steals focus; hand it back to the app
  return summary
}

export function registerRunnerHandlers() {
  const sender = () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    return (channel, data) => win?.webContents.send(channel, data)
  }

  const loadSettings = (db) => {
    const rows = db.prepare('SELECT key, value FROM settings').all()
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  }

  // If run SETUP throws (e.g. building data context / expanding groups), the renderer would
  // otherwise wait forever on a 'complete' that never comes — and look frozen. Emit a visible
  // error + a failed 'complete' so ActiveRun unsticks.
  const failRun = (send, err) => {
    const msg = err?.message || String(err)
    send('runner:log', { type: 'error', text: `✗ Run failed to start: ${msg}` })
    send('runner:complete', { runId: null, status: 'failed', passed: 0, failed: 0, durationMs: 0,
      scenariosTotal: 0, scenariosPassed: 0, scenariosFailed: 0, scenarioResults: [] })
    refocusMainWindow()
    return { error: msg }
  }

  // Continuous run: every scenario in the profile, in order, in ONE browser session.
  ipcMain.handle('runner:run', async (_event, profileId, dataSetId = null) => {
    const send = sender()
    try {
      const db = getDb()
      const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId)
      if (!profile) return { error: 'Profile not found' }

      const allRows = db.prepare('SELECT * FROM scenarios WHERE profile_id = ? ORDER BY sort_order').all(profileId)
      if (!allRows.length) return { error: 'No scenarios configured for this profile' }
      // Skipped scenarios are excluded from Run All (an explicit single-scenario run still runs).
      const scenarioRows = allRows.filter(s => !s.skipped)
      if (!scenarioRows.length) return { error: 'All scenarios are skipped — nothing to run' }

      const scenarios = []
      for (const s of scenarioRows) {
        const rawSteps = db.prepare('SELECT * FROM steps WHERE scenario_id = ? ORDER BY sort_order').all(s.id)
        scenarios.push({ id: s.id, name: s.name, steps: await expandGroups(db, rawSteps) })
      }

      return await executeRun({ profile, scenarios, settings: loadSettings(db), dataSetId, send })
    } catch (err) { return failRun(send, err) }
  })

  // Isolated run: a single scenario (plus its prerequisite chain) in a fresh browser.
  ipcMain.handle('runner:runScenario', async (_event, { profileId, scenarioId, dataSetId = null }) => {
    const send = sender()
    try {
      const db = getDb()
      const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId)
      if (!profile) return { error: 'Profile not found' }
      const scenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId)
      if (!scenario) return { error: 'Scenario not found' }

      const scenarios = [{ id: scenario.id, name: scenario.name, steps: await expandGroups(db, collectSteps(db, scenario)) }]

      return await executeRun({
        profile, scenarios, settings: loadSettings(db), dataSetId,
        scenarioMeta: { scenarioId: scenario.id, scenarioName: scenario.name },
        send
      })
    } catch (err) { return failRun(send, err) }
  })

  ipcMain.handle('runner:stop', async (_, runId) => {
    return { stopped: stopRun(runId) }
  })
}
