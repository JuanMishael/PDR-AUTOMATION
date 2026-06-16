/**
 * Shared step-replay logic used by both the selector tester and the element picker.
 * Runs steps directly against a live Playwright page (in the main process) instead of
 * generating a script — this is how "test/pick from the top, up to here" reaches
 * mid-flow elements (e.g. a modal that only appears after login).
 *
 * Mirrors the action mapping in scriptGenerator.js. Only state-changing actions are
 * replayable; assertions and screenshots are intentionally excluded.
 */

import { findDragHandleRect, synthDrag } from './dragHelpers'

export const REPLAYABLE = new Set([
  'navigate', 'reload', 'goBack', 'goForward', 'waitForUrl',
  'click', 'dblclick', 'rightClick', 'hover', 'focus', 'selectOption',
  'fill', 'type', 'clearInput', 'pressKey', 'uploadFile', 'dragAndDrop',
  'dragByOffset', 'clickAt', 'zoom',
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

    case 'dragByOffset': {
      // Mirror scriptGenerator: press the real drag handle, paced discrete moves, and a
      // synthetic-event fallback if the panel didn't move.
      const el = await locator(page, p).elementHandle()
      if (!el) throw new Error('Drag source not found: ' + (p.selector || ''))
      const dx = Number(p.dx) || 0, dy = Number(p.dy) || 0
      const r = await page.evaluate(findDragHandleRect, el)
      const before = await page.evaluate(findDragHandleRect, el)
      const sx = r.x + r.w / 2, sy = r.y + r.h / 2, N = 25
      await page.mouse.move(sx, sy)
      await page.mouse.down()
      await page.waitForTimeout(80)
      for (let i = 1; i <= N; i++) {
        await page.mouse.move(sx + (dx * i) / N, sy + (dy * i) / N)
        await page.waitForTimeout(16)
      }
      await page.waitForTimeout(80)
      await page.mouse.up()
      const after = await page.evaluate(findDragHandleRect, el)
      if (Math.abs(after.x - before.x) < 3 && Math.abs(after.y - before.y) < 3) {
        await page.evaluate(synthDrag, { el, dx, dy })
      }
      return undefined
    }

    case 'clickAt': {
      const x = Number(p.x) || 0, y = Number(p.y) || 0
      if (p.selector) return locator(page, p).click({ position: { x, y } })
      return page.mouse.click(x, y)
    }

    case 'zoom': {
      const deltaY = Number(p.deltaY) || -100
      const times = Math.max(1, Number(p.times) || 1)
      if (p.selector) {
        // Low-level move (not hover) so an overlapping panel can't block actionability.
        const b = await locator(page, p).boundingBox()
        if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
      }
      for (let i = 0; i < times; i++) { await page.mouse.wheel(0, deltaY); await page.waitForTimeout(150) }
      return undefined
    }

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
