// Drives the real recorder listener in a real page and checks what it emits. Covers the two
// things that made recorded steps unreadable or absent:
//   - a <select>'s textContent is every option run together, so the step card used to read
//     "SelectArm StagingCabinet StagingDP Stagi…" — a list the tester never picked;
//   - typing into an autocomplete never fired `change` (picking a suggestion keeps focus in
//     the box), so the search text was never recorded at all.
// Run: node scripts/test-rec-labels.mjs
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { chromium } from 'playwright'
import { installSelectorGen, recorderListener } from '../src/main/core/injectedScripts.js'
import { ACTION_DEFS } from '../src/renderer/src/components/actionDefs.js'

// buildRecordedParams turns a recorder payload into a step's params. Lifted out of the .jsx by
// source so the test can't drift from it — the function itself has no JSX in it.
const jsx = readFileSync(new URL('../src/renderer/src/screens/ScenarioBuilder.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const fnSrc = jsx.slice(jsx.indexOf('function buildRecordedParams(p) {'))
const buildRecordedParams = new Function('return ' + fnSrc.slice(0, fnSrc.indexOf('\n}\n') + 2))()

const PAGE = `
  <label for="idLayer">Layer</label>
  <select id="idLayer">
    <option value="">Select Feat Id</option>
    <option value="DIGITIZER">DIGITIZER</option>
    <option value="ROUTE_ID">Route Identifier</option>
    <option value="ADDRESS">ADDRESS</option>
  </select>
  <input id="q" aria-label="Advanced Search" autocomplete="off">
  <ul id="sug"></ul>
  <button id="go">Search</button>
  <script>
    // An autocomplete that opens on input and keeps focus when a suggestion is clicked —
    // the exact shape that never fires a change event.
    const q = document.getElementById('q'), sug = document.getElementById('sug');
    q.addEventListener('input', () => {
      sug.innerHTML = q.value ? '<li id="hit">' + q.value.toUpperCase() + ' CITY</li>' : '';
    });
    sug.addEventListener('mousedown', e => e.preventDefault());
  </script>`

// Served over http, not setContent: the recorder arms itself through sessionStorage, which an
// opaque origin denies.
const server = createServer((_q, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE) }).listen(0)
const url = 'http://127.0.0.1:' + server.address().port + '/'

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
const steps = []
await ctx.exposeBinding('__recordStep', (_s, p) => { steps.push(p) })
await ctx.exposeBinding('__recordDone', () => {})
await ctx.addInitScript(installSelectorGen)
await ctx.addInitScript(recorderListener)

const page = await ctx.newPage()
await page.goto(url)
await page.evaluate(() => sessionStorage.setItem('__recArmed', '1'))   // press Start

await page.selectOption('#idLayer', 'ROUTE_ID')
await page.click('#idLayer')

await page.click('#q')
await page.type('#q', 'makati', { delay: 20 })
await page.waitForSelector('#hit')
await page.waitForTimeout(800)          // past the typing debounce
await page.click('#hit')

await browser.close()
server.close()

const find = a => steps.find(s => s.action === a)
const junk = /StagingCabinet|DIGITIZERROUTE|Select Feat IdDIGITIZER/

const sel = find('selectOption')
assert.ok(sel, 'no selectOption step recorded')
assert.strictEqual(sel.value, 'ROUTE_ID')
assert.strictEqual(sel.label, 'Layer: Route Identifier', `bad select label: ${sel.label}`)

const click = steps.find(s => s.action === 'click' && s.selector.includes('idLayer'))
assert.ok(click, 'no click on the select recorded')
assert.ok(!junk.test(click.label), `click label is the option list: ${click.label}`)
assert.strictEqual(click.label, 'Layer', `bad click label: ${click.label}`)

const typed = find('type')
assert.ok(typed, 'typing was not recorded — the autocomplete never fires change')
assert.strictEqual(typed.value, 'makati')
assert.strictEqual(typed.label, 'Advanced Search', `bad input label: ${typed.label}`)

// The typing must land BEFORE the click on the suggestion, or replay searches an empty box.
const hit = steps.findIndex(s => s.action === 'click' && s.selector.includes('hit'))
assert.ok(hit > steps.indexOf(typed), 'the suggestion click was recorded before the typing')

for (const s of steps) assert.ok(!junk.test(s.label || ''), `option list leaked into a label: ${s.label}`)
console.log(`recorder labels ok — ${steps.length} steps, select/input named by their field, typing captured in order`)

// Every key the recorder sends must survive into the step's params. A per-action whitelist used
// to drop the ones nobody added a branch for, which put `type` steps on the canvas with a blank
// selector and nothing to type — the recording looked fine, the step was empty.
const synthetic = [
  { action: 'pressKey', selector: '#q', key: 'Enter', label: 'Enter' },
  { action: 'clickAt', selector: 'canvas', x: 10, y: 20, label: 'Click map' },
  { action: 'dragByOffset', selector: '#panel', dx: -300, dy: 0, x: 5, y: 5, label: 'Drag' },
  { action: 'zoom', selector: '#pane', deltaY: -100, times: 1, label: 'Zoom in' },
  { action: 'pinCoordinate', lat: 14.5, lng: 121, zoom: 18, recenter: true, mapVar: 'map', label: 'Pin' },
  { action: 'mapZoom', zoom: 17, mapVar: 'map', label: 'Map zoom' },
  { action: 'assertVisible', selector: '.toast', label: 'Assert visible' },
  { action: 'waitForSelector', selector: '#sug', state: 'visible', smart: true, label: 'Wait for' },
  { action: 'navigate', url: '/dashboard', label: 'Open the app' }
]

for (const payload of [...steps, ...synthetic]) {
  const params = buildRecordedParams(payload)
  for (const [k, v] of Object.entries(payload)) {
    if (k === 'action' || k === 'label' || k === 'smart') continue
    assert.deepStrictEqual(params[k], v, `${payload.action}: param "${k}" was dropped or altered`)
  }
  const declared = (ACTION_DEFS[payload.action] || {}).params
  assert.ok(declared, `${payload.action} has no ACTION_DEF — it would render as a bare card`)
}
assert.strictEqual(buildRecordedParams(synthetic.at(-2))._smart, true, 'smart wait must be flagged')
assert.strictEqual(buildRecordedParams(synthetic.at(-1))._keyword, 'Given', 'navigate is a Given')

const typedParams = buildRecordedParams(typed)
assert.strictEqual(typedParams.selector, typed.selector)
assert.strictEqual(typedParams.value, 'makati', 'the typed text must reach the step')
console.log(`recorded params ok — ${steps.length + synthetic.length} payloads, no key dropped`)
