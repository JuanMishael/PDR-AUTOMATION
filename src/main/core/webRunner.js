import { spawn, execSync } from 'child_process'
import { writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import { app } from 'electron'
import { generateScript } from './scriptGenerator'

// Resolve node_modules from the app root so spawned scripts can require('playwright').
// The build ships unpacked (asar: false), so node_modules sits under the app path in
// both dev and packaged builds.
function getNodeModulesPath() {
  return join(resolve(app.getAppPath()), 'node_modules')
}

// Find the system Node.js binary — process.execPath in Electron is electron.exe, not node.
// Only used in dev; packaged builds run the script with Electron's own Node (see runWeb).
function getNodeExecutable() {
  try {
    const result = execSync(
      process.platform === 'win32' ? 'where node' : 'which node',
      { encoding: 'utf8', timeout: 3000 }
    ).trim()
    const first = result.split('\n')[0].trim()
    if (first) return first
  } catch { /* fall through */ }
  return 'node'
}

const activeRuns = new Map()

// Kill the spawned run AND its browser subtree. A plain proc.kill() only terminates the
// node script; on Windows the Chromium it launched is a separate process that would keep
// running headful in the background. taskkill /T reaps the whole tree.
function killProc(proc) {
  if (!proc || proc.killed) return
  if (process.platform === 'win32') {
    try { execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' }) } catch { proc.kill() }
  } else {
    proc.kill('SIGTERM')
  }
}

export async function runWeb({ runId, profile, scenarios = [], settings = {}, dataContext = null, onLog, onComplete }) {
  const tmpDir = join(app.getPath('temp'), 'pdr-runs')
  const outputDir = join(tmpDir, runId)
  mkdirSync(outputDir, { recursive: true })
  const scriptPath = join(outputDir, `run.js`)

  // Files the tested app downloads (CSV exports, etc.) land in the OS Downloads folder.
  const downloadsDir = app.getPath('downloads')
  const script = generateScript({ profile, scenarios, settings, outputDir, dataContext, downloadsDir })
  writeFileSync(scriptPath, script, 'utf-8')

  return new Promise((resolve) => {
    const nodeModules = getNodeModulesPath()
    const nodePath = process.env.NODE_PATH
      ? `${nodeModules};${process.env.NODE_PATH}`
      : nodeModules

    // Packaged: run with Electron's built-in Node (ELECTRON_RUN_AS_NODE) so end users
    // don't need Node.js installed. Dev: use the system node on PATH.
    const env = { ...process.env, NODE_PATH: nodePath }
    let nodeExec
    if (app.isPackaged) {
      nodeExec = process.execPath
      env.ELECTRON_RUN_AS_NODE = '1'
    } else {
      nodeExec = getNodeExecutable()
    }

    const proc = spawn(nodeExec, [scriptPath], { cwd: outputDir, env })

    activeRuns.set(runId, proc)

    const results = []
    const scenarioResults = []   // per-scenario rollup: { id, name, status, stepsTotal, stepsPassed, stepsFailed }
    let current = null           // scenario currently being attributed to
    let fatalError = null
    let tracePath = null
    let networkPath = null

    proc.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const msg = JSON.parse(line)
          if (msg.type === 'step') {
            // Attribute the step to the scenario currently in progress.
            const step = { ...msg, scenarioId: current?.id || null, scenarioName: current?.name || null }
            results.push(step)
            if (current) {
              current.stepsTotal++
              if (msg.status === 'failed') { current.stepsFailed++; current.status = 'failed' }
              else current.stepsPassed++
            }
            onLog({ type: 'step', ...step })
          } else if (msg.type === 'scenario') {
            current = { id: msg.id || null, name: msg.name || 'Scenario', status: 'passed', stepsTotal: 0, stepsPassed: 0, stepsFailed: 0 }
            scenarioResults.push(current)
            onLog({ type: 'info', text: `▶ Scenario: ${msg.name}` })
          } else if (msg.type === 'download') {
            onLog({ type: 'info', text: `⬇ Saved download: ${msg.name} → ${msg.path}` })
          } else if (msg.type === 'done') {
            // final summary already in results
          }
        } catch {
          onLog({ type: 'raw', text: line })
        }
      }
    })

    proc.stderr.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const msg = JSON.parse(line)
          if (msg.type === 'fatal') fatalError = msg.message
          else if (msg.type === 'trace') tracePath = msg.path
          else if (msg.type === 'network') networkPath = msg.path
        } catch {
          onLog({ type: 'raw', text: line })
        }
      }
    })

    proc.on('close', (code) => {
      activeRuns.delete(runId)
      try { unlinkSync(scriptPath) } catch { /* best-effort cleanup of the script only */ }

      // A fatal (e.g. browser/setup crash) aborts mid-scenario — count that scenario failed.
      if (fatalError && current && current.status === 'passed') current.status = 'failed'

      const passed = results.filter(r => r.status === 'passed').length
      const failed = results.filter(r => r.status === 'failed').length
      const scenariosPassed = scenarioResults.filter(s => s.status === 'passed').length
      const scenariosFailed = scenarioResults.filter(s => s.status === 'failed').length
      const status = fatalError || failed > 0 ? 'failed' : 'passed'

      onComplete({
        runId,
        status,
        results,
        scenarioResults,
        fatalError,
        tracePath,
        networkPath,
        stepsTotal: results.length,
        stepsPassed: passed,
        stepsFailed: failed,
        scenariosTotal: scenarioResults.length,
        scenariosPassed,
        scenariosFailed,
        exitCode: code
      })

      resolve({ status, results, scenarioResults, fatalError, tracePath, networkPath })
    })
  })
}

export function stopRun(runId) {
  const proc = activeRuns.get(runId)
  if (proc) {
    killProc(proc)
    activeRuns.delete(runId)
    return true
  }
  return false
}

// Stop every in-flight run — called on app quit so closing the window doesn't leave
// orphaned node/browser processes running in the background.
export function stopAllRuns() {
  for (const proc of activeRuns.values()) killProc(proc)
  activeRuns.clear()
}
