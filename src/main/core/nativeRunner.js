// Native Android run engine — the Appium sibling of webRunner/scriptGenerator.
// Unlike the web path (which spawns a generated Playwright script), native drives an Appium
// session in-process over its W3C REST endpoint (same protocol the appium-slice probe proved).
// Returns the SAME shape runWeb() does so executeRun() in ipc/runner.js can treat both alike.
//
// ponytail: assumes an Appium server is already running at 127.0.0.1:4723 (start with `npx appium`).
// Auto-spawning/bundling Appium is deferred — add when non-technical users need one-click runs.
// ponytail: one target device (no udid) — fine while a machine drives a single phone; add
// `appium:udid` from the profile when multi-device matters.
import { resolveParams } from './tokenResolver.js'

const BASE = 'http://127.0.0.1:4723'
const activeRuns = new Map()   // runId -> { cancelled }

async function w3c(method, path, body) {
  let r
  try {
    r = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    })
  } catch (e) {
    // Connection refused etc. — the server isn't up.
    throw new Error(`Appium server unreachable at ${BASE} — start it with \`npx appium\`. (${e.message})`)
  }
  const json = await r.json().catch(() => ({}))
  if (!r.ok) {
    const v = json?.value || {}
    throw new Error(v.message ? v.message.split('\n')[0] : `${method} ${path} -> ${r.status}`)
  }
  return json.value
}

// Native selector strategy -> W3C locator. 'text' is a convenience over an exact-text xpath.
export function locatorFor(strategy, value) {
  switch (strategy) {
    case 'id':            return { using: 'id', value }                       // resource-id
    case 'xpath':         return { using: 'xpath', value }
    case 'uiautomator':   return { using: '-android uiautomator', value }
    case 'text':          return { using: 'xpath', value: `//*[@text=${xpathLiteral(value)}]` }
    case 'accessibility id':
    default:              return { using: 'accessibility id', value }
  }
}

// XPath has no escape char; wrap in the quote it doesn't contain, or concat() if it has both.
export function xpathLiteral(s) {
  if (!s.includes('"')) return `"${s}"`
  if (!s.includes("'")) return `'${s}'`
  return 'concat(' + s.split('"').map(p => `"${p}"`).join(', \'"\', ') + ')'
}

async function findEl(sid, strategy, value, timeoutMs) {
  const loc = locatorFor(strategy, value)
  const deadline = Date.now() + timeoutMs
  let lastErr
  do {
    try {
      const res = await w3c('POST', `/session/${sid}/element`, loc)
      const id = res && Object.values(res)[0]
      if (id) return id
    } catch (e) { lastErr = e }
    await new Promise(r => setTimeout(r, 250))
  } while (Date.now() < deadline)
  throw new Error(lastErr?.message?.includes('unreachable') ? lastErr.message
    : `element not found (${strategy}: ${value})`)
}

// Execute one step against the live session. Throws on failure (caller records failed + stops scenario).
async function runStep(sid, action, p, defaultTimeout) {
  const timeout = Number(p.timeout) > 0 ? Number(p.timeout) : defaultTimeout
  switch (action) {
    case 'tapEl': {
      const el = await findEl(sid, p.strategy, p.locator, timeout)
      return w3c('POST', `/session/${sid}/element/${el}/click`)
    }
    case 'typeText': {
      const el = await findEl(sid, p.strategy, p.locator, timeout)
      if (p.clearFirst) await w3c('POST', `/session/${sid}/element/${el}/clear`)
      return w3c('POST', `/session/${sid}/element/${el}/value`, { text: String(p.value ?? '') })
    }
    case 'assertVisibleEl': {
      const el = await findEl(sid, p.strategy, p.locator, timeout)   // findEl already waits/throws
      const shown = await w3c('GET', `/session/${sid}/element/${el}/displayed`)
      if (!shown) throw new Error(`element found but not visible (${p.strategy}: ${p.locator})`)
      return
    }
    case 'assertTextEl': {
      const el = await findEl(sid, p.strategy, p.locator, timeout)
      const actual = (await w3c('GET', `/session/${sid}/element/${el}/text`)) || ''
      const want = String(p.text ?? '')
      const ok = p.exact ? actual === want : actual.includes(want)
      if (!ok) throw new Error(`text ${p.exact ? '≠' : 'missing'}: expected "${want}", got "${actual}"`)
      return
    }
    case 'pressBack':
      return w3c('POST', `/session/${sid}/appium/device/press_keycode`, { keycode: 4 })
    case 'waitMs':
      return new Promise(r => setTimeout(r, Number(p.ms) || 0))
    case 'screenshotEl':
      await w3c('GET', `/session/${sid}/screenshot`)   // proves capture; saving to disk = later
      return
    case 'comment':
      return
    default:
      throw new Error(`unsupported native action: ${action}`)
  }
}

export async function runNative({ runId, profile, scenarios = [], dataContext = null, onLog }) {
  const results = []
  const scenarioResults = []
  let fatalError = null
  const state = { cancelled: false }
  activeRuns.set(runId, state)

  const appPackage = (profile.base_url || '').trim()
  const defaultTimeout = Number(profile.timeout) > 0 ? Number(profile.timeout) : 10000

  let sid = null
  try {
    if (!appPackage) throw new Error('No app package set — put the Android package name (e.g. com.android.settings) in the profile.')

    const alwaysMatch = {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:appPackage': appPackage,
      'appium:noReset': true,
      'appium:newCommandTimeout': 120,
      'appium:ignoreHiddenApiPolicyError': true
    }
    if ((profile.app_activity || '').trim()) alwaysMatch['appium:appActivity'] = profile.app_activity.trim()

    onLog({ type: 'info', text: `📱 Launching ${appPackage} on device…` })
    const session = await w3c('POST', '/session', { capabilities: { alwaysMatch, firstMatch: [{}] } })
    sid = session.sessionId
    if (!sid) throw new Error('Appium did not return a session id')

    for (const sc of scenarios) {
      if (state.cancelled) break
      const current = { id: sc.id || null, name: sc.name || 'Scenario', status: 'passed', stepsTotal: 0, stepsPassed: 0, stepsFailed: 0 }
      scenarioResults.push(current)
      onLog({ type: 'info', text: `▶ Scenario: ${current.name}` })

      const steps = [...(sc.steps || [])].sort((a, b) => a.sort_order - b.sort_order)
      for (const step of steps) {
        if (state.cancelled) break
        const params = resolveParams(step.params || {}, dataContext)
        if (params._skip) continue
        const label = step.label || `${step.action} ${params.locator || params.text || ''}`.trim()
        try {
          await runStep(sid, step.action, params, defaultTimeout)
          const rec = { type: 'step', id: step.id, label, status: 'passed', scenarioId: current.id, scenarioName: current.name }
          results.push(rec); current.stepsTotal++; current.stepsPassed++
          onLog(rec)
        } catch (err) {
          const rec = { type: 'step', id: step.id, label, status: 'failed', error: err.message, scenarioId: current.id, scenarioName: current.name }
          results.push(rec); current.stepsTotal++; current.stepsFailed++; current.status = 'failed'
          onLog(rec)
          break   // a failed step ends THIS scenario (mirrors the web per-scenario boundary); next scenario still runs
        }
      }
    }
  } catch (err) {
    fatalError = err.message
  } finally {
    if (sid) { try { await w3c('DELETE', `/session/${sid}`) } catch { /* session may be gone */ } }
    activeRuns.delete(runId)
  }

  const failed = results.filter(r => r.status === 'failed').length
  const status = fatalError || failed > 0 ? 'failed' : 'passed'
  // tracePath/networkPath: web-only concepts; null keeps executeRun's shape identical.
  return { status, results, scenarioResults, fatalError, tracePath: null, networkPath: null }
}

export function stopNativeRun(runId) {
  const state = activeRuns.get(runId)
  if (state) { state.cancelled = true; return true }
  return false
}
