import { spawn, execSync } from 'child_process'
import { writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import { app } from 'electron'
import { generateScript } from './scriptGenerator'

// Resolve node_modules from the app root so spawned scripts can require('playwright')
function getNodeModulesPath() {
  const appRoot = app.isPackaged
    ? process.resourcesPath
    : resolve(app.getAppPath())
  return join(appRoot, 'node_modules')
}

// Find the system Node.js binary — process.execPath in Electron is electron.exe, not node
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

export async function runWeb({ runId, profile, scenarios = [], settings = {}, onLog, onComplete }) {
  const tmpDir = join(app.getPath('temp'), 'pdr-runs')
  const outputDir = join(tmpDir, runId)
  mkdirSync(outputDir, { recursive: true })
  const scriptPath = join(outputDir, `run.js`)

  const script = generateScript({ profile, scenarios, settings, outputDir })
  writeFileSync(scriptPath, script, 'utf-8')

  return new Promise((resolve) => {
    const nodeModules = getNodeModulesPath()
    const nodePath = process.env.NODE_PATH
      ? `${nodeModules};${process.env.NODE_PATH}`
      : nodeModules

    const proc = spawn(getNodeExecutable(), [scriptPath], {
      cwd: outputDir,
      env: { ...process.env, NODE_PATH: nodePath }
    })

    activeRuns.set(runId, proc)

    const results = []
    let fatalError = null
    let tracePath = null

    proc.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const msg = JSON.parse(line)
          if (msg.type === 'step') {
            results.push(msg)
            onLog({ type: 'step', ...msg })
          } else if (msg.type === 'scenario') {
            onLog({ type: 'info', text: `▶ Scenario: ${msg.name}` })
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
        } catch {
          onLog({ type: 'raw', text: line })
        }
      }
    })

    proc.on('close', (code) => {
      activeRuns.delete(runId)
      try { unlinkSync(scriptPath) } catch { /* best-effort cleanup of the script only */ }

      const passed = results.filter(r => r.status === 'passed').length
      const failed = results.filter(r => r.status === 'failed').length
      const status = fatalError || failed > 0 ? 'failed' : 'passed'

      onComplete({
        runId,
        status,
        results,
        fatalError,
        tracePath,
        stepsTotal: results.length,
        stepsPassed: passed,
        stepsFailed: failed,
        exitCode: code
      })

      resolve({ status, results, fatalError, tracePath })
    })
  })
}

export function stopRun(runId) {
  const proc = activeRuns.get(runId)
  if (proc) {
    proc.kill('SIGTERM')
    activeRuns.delete(runId)
    return true
  }
  return false
}
