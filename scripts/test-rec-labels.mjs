// Drives the real recorder listener in a real page and checks what it emits. Covers the two
// things that made recorded steps unreadable or absent:
//   - a <select>'s textContent is every option run together, so the step card used to read
//     "SelectArm StagingCabinet StagingDP Stagi…" — a list the tester never picked;
//   - typing into an autocomplete never fired `change` (picking a suggestion keeps focus in
//     the box), so the search text was never recorded at all.
// Run: node scripts/test-rec-labels.mjs
import assert from 'node:assert'
import { createServer } from 'node:http'
import { chromium } from 'playwright'
import { installSelectorGen, recorderListener } from '../src/main/core/injectedScripts.js'

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
