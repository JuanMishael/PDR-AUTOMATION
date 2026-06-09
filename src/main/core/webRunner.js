import { spawn } from 'child_process'
import { writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { generateScript } from './scriptGenerator'

const activeRuns = new Map()

export async function runWeb({ runId, profile, scenario, steps, onLog, onComplete }) {
  const tmpDir = join(app.getPath('temp'), 'botchi-runs')
  mkdirSync(tmpDir, { recursive: true })
  const scriptPath = join(tmpDir, `run-${runId}.js`)

  const script = generateScript({ profile, scenario, steps })
  writeFileSync(scriptPath, script, 'utf-8')

  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [scriptPath], {
      cwd: tmpDir,
      env: { ...process.env }
    })

    activeRuns.set(runId, proc)

    const results = []
    let fatalError = null

    proc.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const msg = JSON.parse(line)
          if (msg.type === 'step') {
            results.push(msg)
            onLog({ type: 'step', ...msg })
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
        } catch {
          onLog({ type: 'raw', text: line })
        }
      }
    })

    proc.on('close', (code) => {
      activeRuns.delete(runId)
      try { unlinkSync(scriptPath) } catch { /* ignore */ }

      const passed = results.filter(r => r.status === 'passed').length
      const failed = results.filter(r => r.status === 'failed').length
      const status = fatalError || failed > 0 ? 'failed' : 'passed'

      onComplete({
        runId,
        status,
        results,
        fatalError,
        stepsTotal: results.length,
        stepsPassed: passed,
        stepsFailed: failed,
        exitCode: code
      })

      resolve({ status, results, fatalError })
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
