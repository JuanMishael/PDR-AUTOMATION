// Smoke test for Assert Map Changed — the pixel check behind a map layer. A layer can be in the
// layer tree and its tiles can return HTTP 200 and STILL not draw; this is the only assert that
// looks at what the tester looks at. What's proved here:
//   - a layer that covers the watched box is detected, and a map that never repaints fails
//   - the crop does its job: a change at the EDGE (scale bar, attribution, a sidebar sliding in)
//     is invisible to the centre box, and visible to the box the tester points at instead
//   - a fixed-size centre box survives the map being resized — same ground, same scale
//   - a reference image passes when the map matches it and fails when it doesn't
//   - two captures of different sizes give a readable error, not pixelmatch's
// Run: node scripts/test-mapdiff.mjs
import assert from 'node:assert'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'
import { bundleCore } from './bundle-core.mjs'

const dir = join(tmpdir(), 'pdr-mapdiff-test')
mkdirSync(dir, { recursive: true })

const { generateScript } = await bundleCore(['scriptGenerator.js'])

// A stand-in map. The content is CENTRED inside #map, the way OpenLayers holds the view centre
// when the viewport resizes — so narrowing the map leaves the middle pixels alone.
//   #toggle    draws a "layer" over the centre
//   #furniture repaints the bottom-right corner only (scale bar / attribution / north arrow)
//   #shrink    narrows the map, as a sidebar opening beside it would
const PAGE = `<!doctype html><title>Map</title>
<style>
  body { margin: 0 }
  #map { position: relative; width: 600px; height: 400px; overflow: hidden; background: #226644 }
  #content { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
             width: 600px; height: 400px;
             background: repeating-linear-gradient(45deg, #226644 0 10px, #1a5540 10px 20px) }
  #layer { display: none; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
           width: 300px; height: 200px; background: #cc3333 }
  #furniture { position: absolute; right: 6px; bottom: 6px; width: 40px; height: 24px; background: #ffffff }
</style>
<div id="map"><div id="content"></div><div id="layer"></div><div id="furniture"></div></div>
<button id="toggle" onclick="layer.style.display = layer.style.display === 'block' ? 'none' : 'block'">layer</button>
<button id="furn" onclick="furniture.style.background = '#000000'">furniture</button>
<button id="shrink" onclick="map.style.width = '400px'">shrink</button>`

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(PAGE)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

let id = 0
const step = (action, label, params = {}) => ({ id: ++id, action, label, params, sort_order: id })
const go = (v) => step('navigate', 'open map', { url: `${origin}/map?v=${v}`, waitUntil: 'load' })
const click = (sel) => step('click', 'click ' + sel, { selector: sel })
const map = (label, params = {}) => step('assertMapChanged', label, { selector: '#map', ...params })

const scenarios = [
  { id: 's1', name: 'a layer that draws is detected', steps: [go(1), map('M1'), click('#toggle'), map('M2')] },
  { id: 's2', name: 'a map that never repaints fails', steps: [go(2), map('M3'), map('M4')] },
  // The whole argument for cropping: the corner repaint is exactly what map furniture does on
  // every render, and the centre box must not see it.
  { id: 's3', name: 'a change at the edge is not a layer', steps: [go(3), map('M5'), click('#furn'), map('M6')] },
  { id: 's4', name: 'the box is configurable', steps: [go(4), map('M7', { region: 'bottom-right' }), click('#furn'), map('M8', { region: 'bottom-right' })] },
  // A fractional cell would change size when the map narrows; a fixed box is the same ground at
  // the same scale, so it still compares.
  { id: 's5', name: 'a fixed box survives a resize', steps: [go(5), map('M9', { boxW: 120, boxH: 120 }), click('#shrink'), map('M10', { boxW: 120, boxH: 120, expect: 'same' })] },
  { id: 's6', name: 'a reference image matches', steps: [go(6), map('M11'), map('M12', { expect: 'same' })] },
  { id: 's7', name: 'a reference image catches a difference', steps: [go(7), click('#toggle'), map('M13', { expect: 'same' })] },
  { id: 's8', name: 'a size mismatch reads clearly', steps: [go(8), map('M14', { expect: 'same' })] }
]

// Reference images are addressed by the artifact an earlier step writes — step-N-map.png, numbered
// by position across the whole run. That's the documented way a tester makes one: copy the capture
// from a good run.
const flat = scenarios.flatMap((s) => s.steps)
const shotOf = (label) => `${dir}/step-${flat.findIndex((s) => s.label === label) + 1}-map.png`
flat.find((s) => s.label === 'M12').params.refImage = shotOf('M11')
flat.find((s) => s.label === 'M13').params.refImage = shotOf('M11')   // a clean map vs one with the layer on

// A deliberately wrong-sized reference: the error has to name the sizes, not throw from inside
// pixelmatch.
const odd = join(dir, 'odd-size.png')
writeFileSync(odd, PNG.sync.write(new PNG({ width: 7, height: 5 })))
flat.find((s) => s.label === 'M14').params.refImage = odd

const script = generateScript({
  profile: { browser: 'chromium', headless: true, timeout: 10000, base_url: '' },
  scenarios,
  settings: { settle_before_action: '0', record_video: '0' },
  outputDir: dir
})
const scriptPath = join(dir, 'run.js')
writeFileSync(scriptPath, script, 'utf-8')

const nodeModules = resolve(import.meta.dirname, '..', 'node_modules')
const proc = spawn(process.execPath, [scriptPath], {
  cwd: dir,
  env: { ...process.env, NODE_PATH: process.env.NODE_PATH ? `${nodeModules};${process.env.NODE_PATH}` : nodeModules }
})

const results = {}
let stderr = ''
// Buffered: a JSON line can straddle two stdout chunks, and parsing per chunk silently drops it.
let buf = ''
proc.stdout.on('data', (c) => {
  buf += c.toString()
  const lines = buf.split('\n')
  buf = lines.pop()
  for (const line of lines.filter(Boolean)) {
    try { const m = JSON.parse(line); if (m.type === 'step') results[m.label] = m } catch { /* chatter */ }
  }
})
proc.stderr.on('data', (c) => { stderr += c.toString() })
await new Promise((done) => proc.on('close', done))
server.close()

const got = (l) => results[l] || assert.fail(`step ${l} never reported — got ${Object.keys(results)}\n${stderr}`)

assert.equal(got('M1').status, 'passed', `the first capture is a baseline, not a failure — ${got('M1').error}`)
assert.equal(got('M2').status, 'passed', `a layer covering the box must be detected — ${got('M2').error}`)

assert.equal(got('M4').status, 'failed', 'a map that never repainted must not pass')
assert.match(got('M4').error, /did not repaint/, got('M4').error)

assert.equal(got('M6').status, 'failed', 'a repaint at the EDGE must not count as the layer drawing')
assert.match(got('M6').error, /did not repaint/, got('M6').error)
assert.equal(got('M8').status, 'passed', `the same edge change must be seen when the box is pointed at it — ${got('M8').error}`)

assert.equal(got('M10').status, 'passed', `a fixed centre box must survive the map resizing — ${got('M10').error}`)

assert.equal(got('M12').status, 'passed', `an unchanged map must match its reference image — ${got('M12').error}`)
assert.equal(got('M13').status, 'failed', 'a map with an extra layer must not match a clean reference')
assert.match(got('M13').error, /should not have/, got('M13').error)

assert.equal(got('M14').status, 'failed', 'a wrong-sized reference must fail')
assert.match(got('M14').error, /different sizes/, `the error must name the mismatch, not come from pixelmatch: ${got('M14').error}`)

// The evidence: every capture is written for the report, and a comparison leaves a red diff beside it.
assert.ok(existsSync(shotOf('M11')), 'each capture must be saved as a run artifact')
assert.ok(existsSync(shotOf('M2').replace('.png', '-diff.png')), 'a comparison must leave a diff image')

console.log('✅ assertMapChanged: layer detected, edge ignored, resize survived, reference image both ways')
