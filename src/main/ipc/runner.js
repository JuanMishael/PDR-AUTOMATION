import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { getDb } from '../core/db'
import { runWeb, stopRun } from '../core/webRunner'
import { buildDataContext } from '../core/tokenResolver'
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

  // Resolve test-data tokens fresh for THIS run (so {{unique.*}}/{{faker.*}} differ per run).
  // With no collections/sets this is an empty context and the run path is unchanged.
  const dataContext = await buildDataContext(getDb(), dataSetId)

  const { status, results, scenarioResults = [], fatalError, tracePath } = await runWeb({
    runId,
    profile,
    scenarios,
    settings,
    dataContext,
    onLog: (data) => send('runner:log', data),
    onComplete: () => {}
  })

  if (fatalError) send('runner:log', { type: 'error', text: `✗ ${fatalError}` })
  if (tracePath)  send('runner:log', { type: 'info', text: `📎 Trace saved: ${tracePath}` })

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
      scenarios_total, scenarios_passed, scenarios_failed, scenario_results, log, trace_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    historyId, profile.id, profile.name,
    scenarioMeta.scenarioId || null, scenarioMeta.scenarioName || null,
    overallStatus, startedAt, finishedAt, durationMs,
    results.length, passed, failed,
    scenarioResults.length, scenariosPassed, scenariosFailed, JSON.stringify(scenarioResults),
    JSON.stringify(results), tracePath || null
  )

  const summary = {
    runId: historyId, status: overallStatus, passed, failed, durationMs,
    scenariosTotal: scenarioResults.length, scenariosPassed, scenariosFailed, scenarioResults
  }
  send('runner:complete', summary)
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

  // Continuous run: every scenario in the profile, in order, in ONE browser session.
  ipcMain.handle('runner:run', async (_event, profileId, dataSetId = null) => {
    const db = getDb()
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId)
    if (!profile) return { error: 'Profile not found' }

    const scenarioRows = db.prepare('SELECT * FROM scenarios WHERE profile_id = ? ORDER BY sort_order').all(profileId)
    if (!scenarioRows.length) return { error: 'No scenarios configured for this profile' }

    const scenarios = scenarioRows.map(s => ({
      id: s.id,
      name: s.name,
      steps: db.prepare('SELECT * FROM steps WHERE scenario_id = ? ORDER BY sort_order').all(s.id)
    }))

    return executeRun({ profile, scenarios, settings: loadSettings(db), dataSetId, send: sender() })
  })

  // Isolated run: a single scenario (plus its prerequisite chain) in a fresh browser.
  ipcMain.handle('runner:runScenario', async (_event, { profileId, scenarioId, dataSetId = null }) => {
    const db = getDb()
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId)
    if (!profile) return { error: 'Profile not found' }
    const scenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId)
    if (!scenario) return { error: 'Scenario not found' }

    const scenarios = [{ id: scenario.id, name: scenario.name, steps: collectSteps(db, scenario) }]

    return executeRun({
      profile, scenarios, settings: loadSettings(db), dataSetId,
      scenarioMeta: { scenarioId: scenario.id, scenarioName: scenario.name },
      send: sender()
    })
  })

  ipcMain.handle('runner:stop', async (_, runId) => {
    return { stopped: stopRun(runId) }
  })
}
