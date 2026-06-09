import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { getDb } from '../core/db'
import { runWeb, stopRun } from '../core/webRunner'

export function registerRunnerHandlers() {
  ipcMain.handle('runner:run', async (event, profileId) => {
    const db = getDb()
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId)
    if (!profile) return { error: 'Profile not found' }

    const scenarios = db
      .prepare('SELECT * FROM scenarios WHERE profile_id = ? ORDER BY sort_order')
      .all(profileId)

    if (!scenarios.length) return { error: 'No scenarios configured for this profile' }

    const runId = randomUUID()
    const startedAt = new Date().toISOString()

    const win = BrowserWindow.getFocusedWindow()
    const send = (channel, data) => win?.webContents.send(channel, data)

    const allResults = []

    for (const scenario of scenarios) {
      const steps = db
        .prepare('SELECT * FROM steps WHERE scenario_id = ? ORDER BY sort_order')
        .all(scenario.id)

      send('runner:log', { type: 'info', text: `▶ Running scenario: ${scenario.name}` })

      const { status, results, fatalError } = await runWeb({
        runId,
        profile,
        scenario,
        steps,
        onLog: (data) => send('runner:log', data),
        onComplete: () => {}
      })

      allResults.push(...results)

      if (status === 'failed') {
        send('runner:log', { type: 'error', text: `✗ Scenario failed: ${scenario.name}${fatalError ? ` — ${fatalError}` : ''}` })
        break
      } else {
        send('runner:log', { type: 'success', text: `✓ Scenario passed: ${scenario.name}` })
      }
    }

    const finishedAt = new Date().toISOString()
    const passed = allResults.filter(r => r.status === 'passed').length
    const failed = allResults.filter(r => r.status === 'failed').length
    const overallStatus = failed > 0 ? 'failed' : 'passed'
    const durationMs = new Date(finishedAt) - new Date(startedAt)

    const historyId = randomUUID()
    db.prepare(`
      INSERT INTO history (id, profile_id, profile_name, status, started_at, finished_at,
        duration_ms, steps_total, steps_passed, steps_failed, log)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      historyId, profileId, profile.name, overallStatus,
      startedAt, finishedAt, durationMs,
      allResults.length, passed, failed,
      JSON.stringify(allResults)
    )

    const summary = { runId: historyId, status: overallStatus, passed, failed, durationMs }
    send('runner:complete', summary)
    return summary
  })

  ipcMain.handle('runner:stop', async (_, runId) => {
    return { stopped: stopRun(runId) }
  })
}
