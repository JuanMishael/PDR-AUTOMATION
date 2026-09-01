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
import { mapPickPixel, mapSetZoom } from './mapHelpers'
import { resolveParams } from './tokenResolver'
import { healAlts } from './healChain'

export const REPLAYABLE = new Set([
  'navigate', 'reload', 'goBack', 'goForward', 'waitForUrl',
  'click', 'dblclick', 'rightClick', 'hover', 'focus', 'selectOption', 'setCheckbox',
  'fill', 'type', 'clearInput', 'pressKey', 'uploadFile', 'dragAndDrop',
  'dragByOffset', 'clickAt', 'zoom', 'pinCoordinate', 'mapZoom',
  'waitForSelector', 'waitForTimeout', 'waitForNetworkIdle',
  // Replayable because they change state the later steps depend on: a captured {{var.x}} that
  // never got captured would replay as the literal token, and custom code is often the thing that
  // navigates. Skipping them would make pick/test land somewhere the real run never is.
  'captureValue', 'runScript', 'executeScript'
])

export function parseParams(p) {
  if (!p) return {}
  try { return typeof p === 'string' ? JSON.parse(p) : p } catch { return {} }
}

// Primary-preferring self-healing resolve — mirrors scriptGenerator's _loc so replay lands on
// the same element a run would. Alts are a fallback for a rotted primary, so they only get a say
// when the primary matches nothing; a .or() union would resolve in DOM order and let a loose alt
// hijack the step.
async function locator(page, p) {
  const sel = p.selector || 'body'
  const alts = healAlts(p)
  if (!alts.length) return page.locator(sel)
  const primary = page.locator(sel)
  try {
    const n = await primary.count()
    if (n === 1) return primary
    if (n > 1) return await visibleFirst(primary)
  } catch { /* fall through to alts */ }
  let l = page.locator(sel)
  for (const a of alts) l = l.or(page.locator(a))
  return visibleFirst(l)
}

// Several matches: take the one the tester can SEE — mirrors _visible in scriptGenerator. Legacy
// apps keep one close button per panel in the DOM at all times, so a plain .first() lands on a
// hidden twin and the step waits out its whole timeout while the panel sits there open.
async function visibleFirst(loc) {
  try { const v = loc.filter({ visible: true }); if (await v.count()) return v.first() } catch { /* older engine */ }
  return loc.first()
}

function resolveUrl(raw, baseUrl) {
  if (!raw) return baseUrl
  return (raw.startsWith('http') || raw.startsWith('file')) ? raw : (baseUrl || '') + raw
}

// Mirrors _samePage in scriptGenerator's navigate - keep the two in step.
export function samePage(a, b) {
  try {
    const x = new URL(a), y = new URL(b)
    return x.origin === y.origin && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '')
      && x.search === y.search && x.hash === y.hash
  } catch {
    return (a || '').replace(/\/+$/, '') === (b || '').replace(/\/+$/, '')
  }
}

// Smart file upload — mirrors the _uploadFile helper in scriptGenerator. Handles a hidden
// file input, the read-only display box, a blank selector (lone file input), or a button
// that opens the OS dialog, so a tester doesn't have to know which the page uses.
async function smartUpload(page, p) {
  const trigger = (p.trigger || '').trim()
  if (trigger) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator(trigger).click()])
    return chooser.setFiles(p.filePath)
  }
  if (p.selector) {
    const isFileInput = await page.evaluate((s) => {
      try { const el = document.querySelector(s); return !!el && el.matches('input[type=file]') } catch { return false }
    }, p.selector)
    if (isFileInput) return page.setInputFiles(p.selector, p.filePath)
  }
  const inputs = await page.locator('input[type=file]').elementHandles()
  if (inputs.length === 1) return inputs[0].setInputFiles(p.filePath)
  if (p.selector) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator(p.selector).click()])
    return chooser.setFiles(p.filePath)
  }
  throw new Error('Upload File: could not find a file input. Set the Upload/Browse button in the step.')
}

// Fill {{var.x}} from the run-scoped store — the replay-side twin of __sub() in the generated
// script. Unknown names are left visible (same as an unknown data token) rather than blanked.
const VAR_RE = /\{\{\s*var\.([^{}]+?)\s*\}\}/g
export function subVars(params, vars) {
  if (!vars || !params || typeof params !== 'object') return params
  const out = Array.isArray(params) ? [] : {}
  for (const [k, v] of Object.entries(params)) {
    out[k] = typeof v === 'string'
      ? v.replace(VAR_RE, (m, n) => (vars[n.trim()] !== undefined ? vars[n.trim()] : m))
      : v
  }
  return out
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

export async function replayStep(page, action, p, baseUrl, vars = {}) {
  switch (action) {
    case 'navigate': {
      // Mirror the generated run's navigate so replay behaves the same way:
      //  • honor the step's Wait until (default 'domcontentloaded', NOT Playwright's 'load' —
      //    heavy map/GIS apps may never fire 'load' or go network-idle, so waiting for it hangs
      //    or invites the ERR_ABORTED race below);
      //  • honor the step's Nav timeout when set;
      //  • tolerate the SPA aborting a redundant load (ERR_ABORTED) or redirecting to itself
      //    ("interrupted by another navigation") — both mean we're effectively already there.
      const WAIT_UNTIL = ['commit', 'domcontentloaded', 'load', 'networkidle']
      const waitUntil = WAIT_UNTIL.includes(p.waitUntil) ? p.waitUntil : 'domcontentloaded'
      const navTimeout = Number(p.navTimeout) > 0 ? Number(p.navTimeout) : 0
      const opts = navTimeout ? { waitUntil, timeout: navTimeout } : { waitUntil }
      const settleState = waitUntil === 'networkidle' ? 'domcontentloaded' : waitUntil
      const target = resolveUrl(p.url, baseUrl)
      // Already on this exact URL -> skip, exactly as the generated run does. Chained scenarios
      // each start with their own 'open the app', so without this the last one RELOADS the app the
      // prerequisite chain just logged into - and an app holding its session client-side lands back
      // on the login page. Compares origin+path+search+hash, so a real ?query/#hash move still navigates.
      if (samePage(target, page.url())) return undefined
      try {
        await page.goto(target, opts)
      } catch (e) {
        if (!/ERR_ABORTED|interrupted by another navigation/i.test(e.message || '')) throw e
        await page.waitForLoadState(settleState).catch(() => {})
      }
      return undefined
    }
    case 'reload':             return page.reload()
    case 'goBack':             return page.goBack()
    case 'goForward':          return page.goForward()
    case 'waitForUrl':         return page.waitForURL(p.pattern)

    case 'click':
    case 'dblclick':
    case 'rightClick': {
      if (Number(p.waitBefore) > 0) await page.waitForTimeout(Number(p.waitBefore))
      const loc = (await locator(page, p))
      // dispatch/force mirror scriptGenerator. They matter MORE here than in a run: the tester
      // ticked them because a plain click doesn't work on that element (collapsed menu, JS
      // toggle), so ignoring them makes replay hang the full action timeout and abandon the
      // rest of the chain on a step the run does fine.
      if (p.dispatch && action !== 'rightClick') return loc.dispatchEvent(action === 'dblclick' ? 'dblclick' : 'click')
      const opts = p.force ? { force: true } : {}
      if (action === 'dblclick')   return loc.dblclick(opts)
      if (action === 'rightClick') return loc.click({ button: 'right', ...opts })
      return loc.click(opts)
    }

    case 'setCheckbox': {
      if (Number(p.waitBefore) > 0) await page.waitForTimeout(Number(p.waitBefore))
      return (await locator(page, p)).setChecked(p.checked !== false)
    }

    // Typing/selecting goes through locator() too, so the self-healing chain applies here exactly
    // as it does in the generated run (mirrors scriptGenerator).
    case 'hover':              return (await locator(page, p)).hover()
    case 'focus':              return (await locator(page, p)).focus()
    case 'selectOption':       return (await locator(page, p)).selectOption(p.value)
    case 'fill':               return (await locator(page, p)).fill(p.value ?? '')
    case 'type':               return (await locator(page, p)).type(p.value ?? '', { delay: p.delay ?? 50 })
    case 'clearInput':         return (await locator(page, p)).fill('')
    case 'pressKey':           return (await locator(page, p)).press(p.key)
    case 'uploadFile':         return smartUpload(page, p)
    case 'dragAndDrop':        return page.dragAndDrop(p.source, p.target)

    case 'dragByOffset': {
      // Mirror scriptGenerator: press the real drag handle, paced discrete moves, and a
      // synthetic-event fallback if the panel didn't move.
      const el = await (await locator(page, p)).elementHandle()
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
      if (p.selector) return (await locator(page, p)).click({ position: { x, y } })
      return page.mouse.click(x, y)
    }

    case 'zoom': {
      const deltaY = Number(p.deltaY) || -100
      const times = Math.max(1, Number(p.times) || 1)
      if (p.selector) {
        // Low-level move (not hover) so an overlapping panel can't block actionability.
        const b = await (await locator(page, p)).boundingBox()
        if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
      }
      for (let i = 0; i < times; i++) { await page.mouse.wheel(0, deltaY); await page.waitForTimeout(150) }
      return undefined
    }

    case 'pinCoordinate': {
      const lat = Number(p.lat), lng = Number(p.lng)
      const zoom = (p.zoom === '' || p.zoom === null || p.zoom === undefined) ? null : Number(p.zoom)
      const recenter = p.recenter !== false
      const mapVar = (p.mapVar || 'map').trim() || 'map'
      const r = await page.evaluate(mapPickPixel, { mapVar, lon: lng, lat, zoom, recenter })
      if (r.error) throw new Error('Pin coordinate: ' + r.error)
      if (!r.inView) {
        throw new Error(`Pin coordinate: (${lng}, ${lat}) is off-screen` +
          (recenter ? ' even after recentering — try a lower zoom level' : ' — enable "Recenter" or navigate there first'))
      }
      return page.mouse.click(r.pageX, r.pageY)
    }

    case 'mapZoom': {
      const zoom = (p.zoom === '' || p.zoom === null || p.zoom === undefined) ? null : Number(p.zoom)
      const delta = (p.delta === '' || p.delta === null || p.delta === undefined) ? null : Number(p.delta)
      const lon = (p.lng === '' || p.lng === null || p.lng === undefined) ? null : Number(p.lng)
      const lat = (p.lat === '' || p.lat === null || p.lat === undefined) ? null : Number(p.lat)
      const mapVar = (p.mapVar || 'map').trim() || 'map'
      const r = await page.evaluate(mapSetZoom, { mapVar, zoom, delta, lon, lat })
      if (r.error) throw new Error('Map zoom: ' + r.error)
      return undefined
    }

    // --- Variables --- mirrors the captureValue/runScript emission in scriptGenerator so replay
    // ends up with the same vars, and the same page state, a real run would have.
    case 'captureValue': {
      const name = String(p.name || '').trim() || 'value'
      const from = p.from || 'text'
      const raw =
        from === 'value'     ? await (await locator(page, p)).inputValue()
      : from === 'attribute' ? await (await locator(page, p)).getAttribute(p.attr || 'value')
      : from === 'url'       ? page.url()
      // indirect (0,eval): runs in the PAGE's global scope, same as the generated script — and
      // keeps the bundler from warning about direct eval capturing this module's scope.
      : from === 'js'        ? await page.evaluate((s) => { const r = (0, eval)(s); return typeof r === 'function' ? r() : r }, p.script ?? '')
      :                        await (await locator(page, p)).innerText()
      vars[name] = String(raw ?? '').trim()
      return undefined
    }

    case 'runScript': {
      // Same code the generated script inlines, run here as a function body instead. `expect` is
      // imported lazily so the main process doesn't pull in playwright/test until someone uses it.
      const { expect } = await import('playwright/test')
      const fn = new AsyncFunction('page', 'context', 'expect', 'vars', String(p.code || ''))
      return fn(page, page.context(), expect, vars)
    }

    // Page-context JS, same sandbox as the generated run's executeScript.
    case 'executeScript':
      return page.evaluate((code) => { const r = (0, eval)(code); return typeof r === 'function' ? r() : r }, p.script ?? '')

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
// Bounded best-effort settle between replayed steps — the same calm-playback wait the run does
// (_settle in scriptGenerator), and for the same reason: let the prior step's XHRs land before
// the next action. It must COUNT REQUESTS, not use waitForLoadState('networkidle'): that state
// belongs to the current document, so in an SPA (this app never re-loads the document after
// login) it resolves instantly and replay races ahead of every XHR — while on a page that never
// went idle it burns the whole cap. Capped and swallowed, so a polling/map app just proceeds.
const REPLAY_SETTLE_CAP = 3000   // matches the run's default settle_timeout

// Count in-flight requests for the whole context (covers popups + the document's own loads).
function netCounter(page) {
  const ctx = page.context()
  let inflight = 0
  let lastTs = Date.now()
  const started = () => { inflight++ }
  const ended = () => { inflight = Math.max(0, inflight - 1); lastTs = Date.now() }
  ctx.on('request', started)
  ctx.on('requestfinished', ended)
  ctx.on('requestfailed', ended)
  return {
    quiet: () => inflight === 0 && Date.now() - lastTs >= 500,
    detach: () => {
      ctx.off('request', started)
      ctx.off('requestfinished', ended)
      ctx.off('requestfailed', ended)
    }
  }
}

async function settle(page, net) {
  try {
    await page.waitForTimeout(150)   // floor: let a just-fired XHR register
    const start = Date.now()
    while (Date.now() - start < REPLAY_SETTLE_CAP) {
      if (net.quiet()) return
      await page.waitForTimeout(100)
    }
  } catch { /* page gone / stopped — never fail a step on the settle */ }
}

// Why did it fail? "Timeout 8000ms exceeded" is the same message for three different problems,
// and they need opposite fixes: nothing matched (the flow is not where the step expects), matched
// but hidden (an earlier step already closed it), or matched and visible but covered by something
// (the Dispatch case). Ask the page instead of leaving the tester to guess. Best-effort — a
// diagnosis never replaces the real error.
async function diagnose(page, p) {
  const sel = (p.selector || '').trim()
  if (!sel) return ''
  try {
    const loc = page.locator(sel)
    const n = await loc.count()
    if (n === 0) return ` — "${sel}" matched nothing here, so an earlier step left the page somewhere else.`
    const visible = await loc.first().isVisible().catch(() => false)
    if (!visible) return ` — "${sel}" matched ${n}, but it is hidden right now (already closed, or zero-size).`
    return ` — "${sel}" matched ${n} and it IS visible, so something is covering it — try Dispatch DOM event on the step.`
  } catch { return '' }
}

// Evaluate an If-block condition against the live page — mirrors __cond in scriptGenerator so
// replay takes the same branch a real run would. Never throws (missing element = false condition).
async function evalCond(page, cond) {
  try {
    const loc = await locator(page, cond)   // same primary-preferring resolve as actions
    const t = Number(cond.timeoutMs) > 0 ? Number(cond.timeoutMs) : 0
    const exp = cond.expected ?? ''
    let r
    switch (cond.type || 'visible') {
      case 'visible': r = t ? await loc.waitFor({ state: 'visible', timeout: t }).then(() => true).catch(() => false) : await loc.isVisible(); break
      case 'hidden':  r = t ? await loc.waitFor({ state: 'hidden', timeout: t }).then(() => true).catch(() => false) : !(await loc.isVisible()); break
      case 'exists':  r = (await loc.count()) > 0; break
      case 'text':    { const s = (await loc.innerText().catch(() => '')) || ''; r = cond.mode === 'exact' ? s.trim() === exp : s.includes(exp); break }
      case 'value':   { const v = (await loc.inputValue().catch(() => '')) || ''; r = cond.mode === 'exact' ? v === exp : v.includes(exp); break }
      case 'enabled': r = await loc.isEnabled().catch(() => false); break
      case 'checked': r = await loc.isChecked().catch(() => false); break
      case 'url':     r = (page.url() || '').includes(exp); break
      case 'title':   { const ti = (await page.title().catch(() => '')) || ''; r = ti.includes(exp); break }
      default:        r = false
    }
    return cond.negate ? !r : r
  } catch { return !!cond.negate }
}

// Block-aware replay: runs a flat step list, taking the live branch at each If-block (so "test up
// to here" reaches the element the real run would). counter.n tracks state-changing steps actually run.
async function replayBlock(page, steps, baseUrl, dataContext, counter, vars, net) {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    if (s.action === 'ifStart') {
      let depth = 1, j = i + 1, elseAt = -1
      while (j < steps.length && depth > 0) {
        const a = steps[j].action
        if (a === 'ifStart') depth++
        else if (a === 'ifEnd') { depth--; if (depth === 0) break }
        else if (a === 'elseStart' && depth === 1) elseAt = j
        j++
      }
      const thenList = steps.slice(i + 1, elseAt === -1 ? j : elseAt)
      const elseList = elseAt === -1 ? [] : steps.slice(elseAt + 1, j)
      const raw = parseParams(s.params)
      const cond = subVars(dataContext ? resolveParams(raw.cond || {}, dataContext) : (raw.cond || {}), vars)
      const branch = (await evalCond(page, cond)) ? thenList : elseList
      const res = await replayBlock(page, branch, baseUrl, dataContext, counter, vars, net)
      if (!res.ok) return res
      i = j
      continue
    }
    if (s.action === 'elseStart' || s.action === 'ifEnd') continue
    if (!REPLAYABLE.has(s.action)) continue
    // Resolve {{Collection.field}} / {{faker.*}} / {{unique.*}} tokens the same way a run does,
    // so replay types the real value — not the literal token text — into the page.
    // …then fill {{var.x}} from anything captured earlier in THIS replay pass.
    const p = subVars(dataContext ? resolveParams(parseParams(s.params), dataContext) : parseParams(s.params), vars)
    try {
      await replayStep(page, s.action, p, baseUrl, vars)
      await settle(page, net)   // wait for this step's network to quiet before the next
      counter.n++
    } catch (e) {
      const detail = (e.message || '').split('\n')[0].slice(0, 100)
      return {
        ok: false, setupFailed: true, failedIndex: counter.n, failedAction: s.action, ranSteps: counter.n,
        error: `Setup step ${counter.n + 1} (${s.action}) failed before reaching your element — ${detail}`
          + (await diagnose(page, p))
      }
    }
  }
  return { ok: true }
}

export async function replaySteps(page, steps, baseUrl, dataContext = null) {
  const counter = { n: 0 }
  const vars = {}   // fresh per replay pass — same lifetime as a run's __vars
  const net = netCounter(page)
  try {
    const res = await replayBlock(page, steps, baseUrl, dataContext, counter, vars, net)
    return res.ok ? { ok: true, ranSteps: counter.n } : res
  } finally {
    net.detach()   // the recorder keeps using this context after replay — don't leak listeners
  }
}
