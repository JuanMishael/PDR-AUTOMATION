// Drives the real recorder listener against a live map and checks the assert-mode gesture.
//
// Why this exists: assert mode used to emit `assertVisible` on whatever was clicked. On a map that
// means a step asserting the CANVAS is visible — which it always is, drawn or blank — so the check
// could never fail. Clicking a map in assert mode now offers the nine boxes Assert Map Changed can
// watch, and the box the tester points at becomes the step's region.
// Run: node scripts/test-rec-mapgrid.mjs
import assert from 'node:assert'
import { createServer } from 'node:http'
import { chromium } from 'playwright'
import { installSelectorGen, recorderListener } from '../src/main/core/injectedScripts.js'

// Duck-typed the way findMap looks for a map: a global whose viewport contains the clicked element.
const PAGE = `
  <style>#mapbox { width: 480px; height: 300px; position: relative } canvas { width: 100%; height: 100% }</style>
  <div id="mapbox"><canvas id="mapcanvas"></canvas></div>
  <button id="save">Save</button>
  <script>
    const box = document.getElementById('mapbox');
    window.map = {
      getViewport: () => box,
      getTargetElement: () => box,
      getEventCoordinate: () => [0, 0],
      getView: () => ({ getZoom: () => 12, getProjection: () => ({ getCode: () => 'EPSG:3857' }) })
    };
  </script>`

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
// Assert mode carries the KIND the tester chose from the Assert menu — 'region' for the nine
// boxes, 'visible' for the old element check.
const arm = (kind) => page.evaluate((k) => {
  sessionStorage.setItem('__recArmed', '1')
  sessionStorage.setItem('__recAssert', k ? '1' : '0')
  sessionStorage.setItem('__recAssertKind', k || 'visible')
}, kind)

// --- Assert-clicking the map offers the boxes instead of writing a step ---------------------
await arm('region')
await page.click('#mapbox')
assert.equal(steps.length, 0, 'clicking the map in assert mode must not emit a step yet')
assert.equal(await page.locator('#__recGrid > div').count(), 9, 'nine boxes must be offered')
assert.deepEqual(
  await page.locator('#__recGrid > div').allInnerTexts(),
  ['top-left', 'top', 'top-right', 'left', 'centre', 'right', 'bottom-left', 'bottom', 'bottom-right'],
  'the boxes must be named the way the step names its regions'
)

// The grid sits over the map — picking a box must not also record a click on the page beneath it.
await page.click('#__recGrid > div:nth-child(5)')
assert.equal(steps.length, 1, `picking a box must emit exactly one step, got ${steps.length}`)
const m = steps[0]
assert.equal(m.action, 'assertMapChanged', `wrong action: ${m.action}`)
assert.equal(m.region, 'centre', `wrong region: ${m.region}`)
assert.equal(m.selector, '#mapbox', `the step must target the map container, got ${m.selector}`)
assert.match(m.label, /centre/, `the label should name the box: ${m.label}`)
assert.equal(await page.locator('#__recGrid').count(), 0, 'the grid must close once a box is picked')
assert.equal(await page.evaluate(() => sessionStorage.getItem('__recAssert')), '0',
  'assert mode is one-shot — it must clear after the pick')

// --- A different box, because the whole point is that it is configurable --------------------
await arm('region')
await page.click('#mapbox')
await page.click('#__recGrid > div:nth-child(9)')
assert.equal(steps[1].region, 'bottom-right', `wrong region: ${steps[1].region}`)

// --- Every way out of the picker --------------------------------------------------------------
// A tester who opens the boxes and then decides to zoom the map first must be able to get out.
// Each of these used to be a way to leave the nine boxes painted over the page.
const stillOpen = () => page.locator('#__recGrid').count()
const pending = () => page.evaluate(() => sessionStorage.getItem('__recAssert'))

await arm('region')
await page.click('#mapbox')
assert.equal(await stillOpen(), 1, 'grid should be open')
await page.keyboard.press('Escape')
assert.equal(await stillOpen(), 0, 'Escape must close the grid')
assert.equal(await pending(), '0', 'Escape must also clear the pending assert')
assert.equal(steps.length, 2, 'Escape must not write a step')

// The visible way out — Escape is invisible, and a tester shouldn't have to guess a shortcut.
await arm('region')
await page.click('#mapbox')
await page.click('#__recGridCancel')
assert.equal(await stillOpen(), 0, 'the Cancel button must close the grid')
assert.equal(await pending(), '0', 'Cancel must clear the pending assert')

// Clicking off the map means "not this" — cancel, and don't record the click either.
await arm('region')
await page.click('#mapbox')
await page.click('#save')
assert.equal(await stillOpen(), 0, 'a click off the map must close the grid')
assert.equal(steps.length, 2, 'the click that escaped the picker must not be recorded')

// The toolbar's own Assert button, which is where the tester looks first to back out.
await arm('region')
await page.click('#mapbox')
await page.click('#__recAssertBtn')
assert.equal(await stillOpen(), 0, 'the Assert button must take the grid down with assert mode')
assert.equal(await pending(), '0', 'and clear the pending assert')

// Stopping or pausing mid-pick must not leave the boxes behind either.
await arm('region')
await page.click('#mapbox')
await page.evaluate(() => document.querySelectorAll('#__recBar button')[0].click())   // Pause
assert.equal(await stillOpen(), 0, 'pausing must close the grid')

// --- Everything that is not a map still asserts visibility ------------------------------------
await arm('visible')
await page.click('#save')
assert.equal(steps.length, 3, 'a normal element must still record an assert')
assert.equal(steps[2].action, 'assertVisible', `non-map assert regressed: ${steps[2].action}`)

// --- Recording (not asserting) a map click is untouched ----------------------------------------
await arm(null)
await page.click('#mapbox')
assert.ok(steps.length > 3, 'a plain map click must still record')
assert.notEqual(steps[3].action, 'assertMapChanged', 'the grid must only appear in assert mode')

// --- The Assert button offers BOTH checks, and the tester's pick decides --------------------
// Not the click target: guessing from what got clicked can't offer a visibility check on a map's
// own popup or control, since those live inside the map viewport.
await arm(null)
await page.click('#__recAssertBtn')
assert.equal(await page.locator('#__recAssertMenu > button').count(), 2, 'Assert must offer both checks')
await page.click('#__recAssertMenu > button:nth-child(1)')          // "Element is visible"
assert.equal(await page.evaluate(() => sessionStorage.getItem('__recAssertKind')), 'visible',
  'picking a menu item must set the kind')
assert.equal(await page.evaluate(() => sessionStorage.getItem('__recAssert')), '1',
  'picking a menu item must arm the assert')

const beforeVisible = steps.length
await page.click('#mapbox')
assert.equal(await page.locator('#__recGrid').count(), 0,
  'the boxes must NOT appear when the tester asked for a visibility check')
assert.equal(steps[beforeVisible].action, 'assertVisible',
  `the chosen check must win over the click target: ${steps[beforeVisible].action}`)

// --- A region check works on anything with a rect, not just maps ----------------------------
await arm('region')
await page.click('#save')
assert.equal(await page.locator('#__recGrid').count(), 1, 'a panel or modal can be watched too')
const beforeRegion = steps.length
await page.click('#__recGrid > div:nth-child(1)')
assert.equal(steps[beforeRegion].selector, '#save', 'a non-map element is watched as itself')
assert.equal(steps[beforeRegion].region, 'top-left', 'the picked box must carry through')

await browser.close()
server.close()
console.log('✅ recorder assert menu: both checks offered, the pick decides, nine boxes, five ways to cancel, non-map elements unchanged')
