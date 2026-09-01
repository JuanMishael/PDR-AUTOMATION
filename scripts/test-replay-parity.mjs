// Guards the replay path (recorder pre-Start playback, picker, selector tester) against drifting
// from the generated run. Every divergence here strands the tester mid-chain on a step a real run
// executes fine. Run: node scripts/test-replay-parity.mjs
import assert from 'node:assert'
import { bundleCore } from './bundle-core.mjs'

const { replayStep, REPLAYABLE } = await bundleCore(['stepReplay.js'])

// Minimal fake page/locator — records what replay asked Playwright to do.
const fakePage = (at = 'https://host/app/Map/index') => {
  const calls = []
  const loc = {
    click: async (o) => calls.push(['click', o]),
    dblclick: async (o) => calls.push(['dblclick', o]),
    dispatchEvent: async (e) => calls.push(['dispatchEvent', e]),
    setChecked: async (v) => calls.push(['setChecked', v])
  }
  return {
    calls,
    url: () => at,
    locator: () => loc,
    goto: async (u) => { calls.push(['goto', u]) },
    waitForTimeout: async (ms) => { calls.push(['wait', ms]) },
    waitForLoadState: async () => {},
    evaluate: async (fn, arg) => { calls.push(['evaluate', arg]) }
  }
}
const MAP = 'https://host/app/Map/index'

// --- navigate: already there = no reload (a chained scenario's own "open the app" would
// otherwise reload the app the prerequisite chain just logged into).
let p = fakePage(MAP)
await replayStep(p, 'navigate', { url: MAP }, '')
assert.deepEqual(p.calls, [], 'same URL must not re-navigate')

p = fakePage(MAP + '/')
await replayStep(p, 'navigate', { url: MAP }, '')
assert.deepEqual(p.calls, [], 'trailing slash is the same page')

p = fakePage(MAP)
await replayStep(p, 'navigate', { url: MAP + '?id=7' }, '')
assert.deepEqual(p.calls, [['goto', MAP + '?id=7']], 'a real query change still navigates')

p = fakePage('https://host/app/login')
await replayStep(p, 'navigate', { url: '/app/Map/index' }, 'https://host')
assert.deepEqual(p.calls, [['goto', MAP]], 'different page navigates, base URL applied')

// --- click: dispatch/force are why the step works at all; a plain .click() just times out.
p = fakePage()
await replayStep(p, 'click', { selector: '#x', dispatch: true }, '')
assert.deepEqual(p.calls, [['dispatchEvent', 'click']], 'dispatch click must not do a real click')

p = fakePage()
await replayStep(p, 'dblclick', { selector: '#x', dispatch: true }, '')
assert.deepEqual(p.calls, [['dispatchEvent', 'dblclick']], 'dispatch dblclick')

p = fakePage()
await replayStep(p, 'click', { selector: '#x', force: true, waitBefore: 500 }, '')
assert.deepEqual(p.calls, [['wait', 500], ['click', { force: true }]], 'force + waitBefore honored')

p = fakePage()
await replayStep(p, 'click', { selector: '#x' }, '')
assert.deepEqual(p.calls, [['click', {}]], 'plain click unchanged')

// --- setCheckbox / executeScript: state-changing in a run, so replay must not skip them.
assert.ok(REPLAYABLE.has('setCheckbox') && REPLAYABLE.has('executeScript'), 'both must be replayable')

p = fakePage()
await replayStep(p, 'setCheckbox', { selector: '#x', checked: false }, '')
assert.deepEqual(p.calls, [['setChecked', false]], 'unchecking must uncheck')

p = fakePage()
await replayStep(p, 'executeScript', { script: 'window.foo()' }, '')
assert.deepEqual(p.calls, [['evaluate', 'window.foo()']], 'page-context JS must run')

console.log('ok — replay parity')

// --- settle: must wait for the PRIOR step's XHR (SPA apps never re-reach document networkidle,
// so the old waitForLoadState settle returned instantly and replay raced ahead).
const { replaySteps } = await bundleCore(['stepReplay.js'])
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const listeners = { request: [], requestfinished: [], requestfailed: [] }
const ctx = {
  on: (e, fn) => listeners[e].push(fn),
  off: (e, fn) => { listeners[e] = listeners[e].filter(f => f !== fn) },
  emit: (e) => listeners[e].forEach(f => f())
}
const spaPage = {
  url: () => MAP,
  context: () => ctx,
  waitForTimeout: sleep,
  waitForLoadState: async () => {},
  locator: () => ({
    click: async () => { ctx.emit('request'); setTimeout(() => ctx.emit('requestfinished'), 200) }
  })
}
const t0 = Date.now()
const r = await replaySteps(spaPage, [{ action: 'click', params: { selector: '#x' } }], '')
const took = Date.now() - t0
assert.ok(r.ok, 'replay should succeed')
assert.ok(took >= 650, `settle must wait for the in-flight request + quiet window, took ${took}ms`)
assert.ok(took < 3000, `settle must return on quiet, not burn the cap (took ${took}ms)`)
assert.equal(listeners.request.length + listeners.requestfinished.length + listeners.requestfailed.length, 0,
  'listeners must be detached — the recorder keeps using this context after replay')

console.log('ok — settle')

// --- failure diagnosis: "Timeout 8000ms exceeded" alone can't be acted on. Each cause must name
// itself, because the fix differs: nothing matched / matched but hidden / matched but covered.
const boom = () => { throw new Error('locator.click: Timeout 8000ms exceeded.\nCall log: ...') }
const diagPage = (count, visible) => ({
  url: () => MAP,
  context: () => ctx,
  waitForTimeout: sleep,
  waitForLoadState: async () => {},
  locator: () => ({ click: boom, count: async () => count, first: () => ({ isVisible: async () => visible }) })
})
const clickStep = [{ action: 'click', params: { selector: '#gone' } }]
const why = async (count, visible) => (await replaySteps(diagPage(count, visible), clickStep, '')).error

assert.match(await why(0, false), /Timeout 8000ms exceeded/, 'the real error must survive')
assert.match(await why(0, false), /matched nothing here/, 'no match must say so')
assert.match(await why(2, false), /matched 2, but it is hidden/, 'hidden must say so')
assert.match(await why(1, true), /covering it — try Dispatch/, 'covered must point at Dispatch')

console.log('ok — failure diagnosis')
