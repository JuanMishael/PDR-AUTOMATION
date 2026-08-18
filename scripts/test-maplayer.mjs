// Smoke test for Assert Map Layer — the layer-tree check. Toggling a layer off and back on
// normally fires no request (cached tiles, identical GetMap URL), so the network log is silent on
// exactly that interaction; this assert reads the live map instead. The fixture is a hand-rolled
// duck-typed map, not real OpenLayers — `ol` isn't a dependency, and the helper only ever touches
// getLayers/getVisible/getProperties/getSource, so the fake exercises the same surface.
// Run: node scripts/test-maplayer.mjs
import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundleCore } from './bundle-core.mjs'

const dir = join(tmpdir(), 'pdr-maplayer-test')
mkdirSync(dir, { recursive: true })

const { generateScript } = await bundleCore(['scriptGenerator.js'])

// Mirrors the real app's shape: a basemap, a WMS layer nested in a group (identified by LAYERNAME
// / LAYERID / its LAYERS param), a visible layer inside a HIDDEN group, and a toggled-off layer.
// The global is deliberately not called "map" — the helper has to duck-type its way to it.
const fixture = join(dir, 'fixture.html')
writeFileSync(fixture, `<!doctype html><title>Layer state</title>
<script>
function coll(arr) { return { forEach: function (f) { arr.forEach(f) } } }
function layer(props, visible, layersParam) {
  return {
    getProperties: function () { return props },
    getVisible: function () { return visible },
    getSource: function () { return layersParam == null ? null : { getParams: function () { return { LAYERS: layersParam } } } }
  }
}
function group(children, visible) {
  return {
    getLayers: function () { return coll(children) },
    getVisible: function () { return visible },
    getProperties: function () { return { title: 'a group' } }
  }
}
window.notAMap = { getLayers: 1, getView: 1 };
window.gisMap = {
  getView: function () { return {} },
  getLayers: function () {
    return coll([
      layer({ title: 'Basemap' }, true, null),
      group([ layer({ LAYERNAME: 'FOC PRIMARY AERIAL', LAYERID: 1453 }, true, '1453') ], true),
      group([ layer({ title: 'Under Hidden Group' }, true, null) ], false),
      layer({ title: 'Route Geom Staging', LAYERID: 1400 }, false, '1400')
    ])
  }
};
</script>`)
const pageUrl = pathToFileURL(fixture).href

let id = 0
const step = (action, label, params = {}) => ({ id: ++id, action, label, params, sort_order: id })
// Distinct query per scenario: navigate no-ops on an identical URL (that's how Run All carries a
// session across scenarios), which would skip the reload and leave the page untouched.
const go = (v) => step('navigate', 'open', { url: `${pageUrl}?v=${v}` })
const check = (label, params) => step('assertMapLayer', label, params)

// One assert per scenario — a failing assert ends its scenario, so sharing one would mask the rest.
const scenarios = [
  { id: 's1', name: 'visible layer inside a visible group', steps: [go(1), check('L1', { layer: 'FOC PRIMARY AERIAL', visible: true })] },
  { id: 's2', name: 'matched by its WMS LAYERS param', steps: [go(2), check('L2', { layer: '1453', visible: true })] },
  { id: 's3', name: 'toggled off, asserted on', steps: [go(3), check('L3', { layer: 'Route Geom Staging', visible: true })] },
  { id: 's4', name: 'toggled off, asserted off', steps: [go(4), check('L4', { layer: '1400', visible: false })] },
  { id: 's5', name: 'unknown layer lists what is there', steps: [go(5), check('L5', { layer: 'NOSUCHLAYER', visible: true })] },
  // The branch that a per-layer visible check would get wrong: the child says visible:true, but
  // its group is off, so nothing is drawn.
  { id: 's6', name: 'visible child of a hidden group', steps: [go(6), check('L6', { layer: 'Under Hidden Group', visible: true })] }
]

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
proc.stdout.on('data', (c) => {
  for (const line of c.toString().split('\n').filter(Boolean)) {
    try { const m = JSON.parse(line); if (m.type === 'step') results[m.label] = m } catch { /* chatter */ }
  }
})
proc.stderr.on('data', (c) => { stderr += c.toString() })
await new Promise((done) => proc.on('close', done))

const got = (l) => results[l] || assert.fail(`step ${l} never reported — got ${Object.keys(results)}\n${stderr}`)

assert.equal(got('L1').status, 'passed', `named layer in a visible group should pass — ${got('L1').error}`)
assert.equal(got('L2').status, 'passed', `a WMS LAYERS entry should identify the layer — ${got('L2').error}`)

assert.equal(got('L3').status, 'failed', 'a toggled-off layer must not pass an "is showing" check')
assert.match(got('L3').error, /hidden/, got('L3').error)

assert.equal(got('L4').status, 'passed', `asserting it is OFF should pass — ${got('L4').error}`)

assert.equal(got('L5').status, 'failed', 'an unknown layer must fail')
assert.match(got('L5').error, /not on the map/, got('L5').error)
assert.match(got('L5').error, /Layers on the map:.*Basemap/, `the error should list what IS there: ${got('L5').error}`)

assert.equal(got('L6').status, 'failed', 'a hidden GROUP must hide its children, which each still report visible:true')
assert.match(got('L6').error, /hidden/, got('L6').error)

console.log('✅ assertMapLayer: group nesting, LAYERS-param identity, on/off both ways, unknown-layer listing')
