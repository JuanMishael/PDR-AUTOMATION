/**
 * Shared step-replay logic used by both the selector tester and the element picker.
 * Runs steps directly against a live Playwright page (in the main process) instead of
 * generating a script — this is how "test/pick from the top, up to here" reaches
 * mid-flow elements (e.g. a modal that only appears after login).
 *
 * Mirrors the action mapping in scriptGenerator.js. Only state-changing actions are
 * replayable; assertions and screenshots are intentionally excluded.
 */

export const REPLAYABLE = new Set([
  'navigate', 'reload', 'goBack', 'goForward', 'waitForUrl',
  'click', 'dblclick', 'rightClick', 'hover', 'focus', 'selectOption',
  'fill', 'type', 'clearInput', 'pressKey', 'uploadFile', 'dragAndDrop',
  'waitForSelector', 'waitForTimeout', 'waitForNetworkIdle'
])

export function parseParams(p) {
  if (!p) return {}
  try { return typeof p === 'string' ? JSON.parse(p) : p } catch { return {} }
}

function locator(page, p) {
  const sel = p.selector || 'body'
  if (p.selector2 && p.selector2.trim()) {
    return page.locator(sel).or(page.locator(p.selector2.trim())).first()
  }
  return page.locator(sel)
}

function resolveUrl(raw, baseUrl) {
  if (!raw) return baseUrl
  return (raw.startsWith('http') || raw.startsWith('file')) ? raw : (baseUrl || '') + raw
}

export async function replayStep(page, action, p, baseUrl) {
  switch (action) {
    case 'navigate':           return page.goto(resolveUrl(p.url, baseUrl))
    case 'reload':             return page.reload()
    case 'goBack':             return page.goBack()
    case 'goForward':          return page.goForward()
    case 'waitForUrl':         return page.waitForURL(p.pattern)

    case 'click':
    case 'dblclick':
    case 'rightClick': {
      if (Number(p.waitBefore) > 0) await page.waitForTimeout(Number(p.waitBefore))
      const loc = locator(page, p)
      if (action === 'dblclick')   return loc.dblclick()
      if (action === 'rightClick') return loc.click({ button: 'right' })
      return loc.click()
    }

    case 'hover':              return locator(page, p).hover()
    case 'focus':              return page.focus(p.selector)
    case 'selectOption':       return page.selectOption(p.selector, p.value)
    case 'fill':               return page.fill(p.selector, p.value ?? '')
    case 'type':               return page.type(p.selector, p.value ?? '', { delay: p.delay ?? 50 })
    case 'clearInput':         return page.fill(p.selector, '')
    case 'pressKey':           return page.press(p.selector || 'body', p.key)
    case 'uploadFile':         return page.setInputFiles(p.selector, p.filePath)
    case 'dragAndDrop':        return page.dragAndDrop(p.source, p.target)
    case 'waitForSelector':    return page.waitForSelector(p.selector, { state: p.state || 'visible' })
    case 'waitForTimeout':     return page.waitForTimeout(Number(p.ms) || 1000)
    case 'waitForNetworkIdle': return page.waitForLoadState('networkidle')
    default:                   return undefined
  }
}

/**
 * Replays the given steps in order, skipping non-state-changing actions.
 * Returns { ok: true, ranSteps } on success, or a structured setup-failure object
 * naming the step that broke — so the UI can say which step failed instead of
 * misreporting "0 matches" / "couldn't capture".
 */
export async function replaySteps(page, steps, baseUrl) {
  let ranSteps = 0
  for (let i = 0; i < steps.length; i++) {
    const action = steps[i].action
    if (!REPLAYABLE.has(action)) continue
    const p = parseParams(steps[i].params)
    try {
      await replayStep(page, action, p, baseUrl)
      ranSteps++
    } catch (e) {
      const detail = (e.message || '').split('\n')[0].slice(0, 100)
      return {
        ok: false,
        setupFailed: true,
        failedIndex: i,
        failedAction: action,
        ranSteps,
        error: `Setup step ${i + 1} (${action}) failed before reaching your element — ${detail}`
      }
    }
  }
  return { ok: true, ranSteps }
}
