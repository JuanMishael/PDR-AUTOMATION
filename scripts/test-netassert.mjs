// Smoke test for Assert Request Succeeded — the map-layer check. A WMS server answers a broken
// GetMap with HTTP 200 and a ServiceExceptionReport XML body, so a status-code assert reads green
// while nothing draws. This proves the content-type check catches exactly that case, that tile
// requests are captured without the tester ticking "include network trace" anywhere, and that the
// session TOKEN in the tile URL never reaches network.json.
// Run: node scripts/test-netassert.mjs
import assert from 'node:assert'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { bundleCore } from './bundle-core.mjs'

const dir = join(tmpdir(), 'pdr-netassert-test')
mkdirSync(dir, { recursive: true })

const { generateScript } = await bundleCore(['scriptGenerator.js'])

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const EXCEPTION = '<?xml version="1.0"?>\n<ServiceExceptionReport version="1.3.0"><ServiceException code="LayerNotDefined">Layer 99 not defined</ServiceException></ServiceExceptionReport>'

// Stands in for the ArcGIS WMSServer: 4 tiles per page load, each carrying a session TOKEN in the
// query string the way the real one does. ?bad=N makes tile N answer 200 + XML instead of a PNG —
// the silent failure this whole action exists to catch.
const server = createServer((req, res) => {
  if (req.url.startsWith('/map')) {
    res.writeHead(200, { 'content-type': 'text/html' })
    return res.end(`<!doctype html><title>Map</title><script>
      var bad = new URLSearchParams(location.search).get('bad');
      // Unique per load, the way a real GetMap varies by BBOX — otherwise Chromium serves a later
      // scenario's identical tiles from its memory cache and no request is made at all.
      var view = Date.now() + '-' + Math.random();
      for (var i = 0; i < 4; i++) {
        var im = new Image();
        im.src = '/arcgisserver/WMSServer?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&TOKEN=SECRETTOKEN123&BBOX=' + view + '&i=' + i + (String(i) === bad ? '&fail=1' : '');
        document.documentElement.appendChild(im);
      }
    </script>`)
  }
  if (req.url.includes('REQUEST=GetMap')) {
    const noCache = { 'cache-control': 'no-store' }
    if (req.url.includes('fail=1')) {
      res.writeHead(200, { 'content-type': 'text/xml', ...noCache })   // 200 — that's the point
      return res.end(EXCEPTION)
    }
    res.writeHead(200, { 'content-type': 'image/png', ...noCache })
    return res.end(PNG)
  }
  res.writeHead(404).end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

let id = 0
const step = (action, label, params = {}) => ({ id: ++id, action, label, params, sort_order: id })
// NOTE: no _netTrace anywhere — the tiles must be captured purely because an assertRequest asks
// about that URL. A tester should not have to know which step fires the fan-out.
// waitUntil 'load' so the tiles are settled before the assert — the fixture is racing the
// bounded settle otherwise, and the run can end with the last page's tiles still unrequested.
const go = (q = '') => step('navigate', 'open map', { url: origin + '/map' + q, waitUntil: 'load' })
const check = (label, params) => step('assertRequest', label, { expect: 'image', ...params })

const scenarios = [
  { id: 's1', name: 'all tiles are images', steps: [go(), check('S1', { urlContains: 'GetMap' })] },
  { id: 's2', name: 'one tile is a 200 XML exception', steps: [go('?bad=2'), check('S2', { urlContains: 'GetMap' })] },
  // Distinct URLs per scenario on purpose: navigate no-ops on an identical URL (it's how Run All
  // carries a session across scenarios), which would leave a later scenario with no fresh tiles.
  { id: 's3', name: 'nothing matches the pattern', steps: [go('?v=3'), check('S3', { urlContains: 'NoSuchService' })] },
  // Proves the consume-on-check rule: s2's bad tile is already spent, so a fresh good load passes
  // instead of inheriting the earlier scenario's failure.
  { id: 's4', name: 'a later scenario is not poisoned', steps: [go('?v=4'), check('S4', { urlContains: 'GetMap' })] }
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
server.close()

const got = (l) => results[l] || assert.fail(`step ${l} never reported — got ${Object.keys(results)}\n${stderr}`)

assert.equal(got('S1').status, 'passed', `healthy tiles should pass — ${got('S1').error}`)

assert.equal(got('S2').status, 'failed', 'a 200 XML exception must FAIL — this is the whole point')
assert.match(got('S2').error, /text\/xml/, `error should name the content-type: ${got('S2').error}`)
assert.match(got('S2').error, /ServiceException/, `error should quote the server's reason: ${got('S2').error}`)
assert.match(got('S2').error, /1 of 4/, `only the bad tile counts as bad: ${got('S2').error}`)

assert.equal(got('S3').status, 'failed', 'zero matching requests must fail, not pass vacuously')
assert.match(got('S3').error, /No matching request/, got('S3').error)

assert.equal(got('S4').status, 'passed', `spent rows must not re-fail a later check — ${got('S4').error}`)

// The log itself: token redacted, image bodies not slurped, the XML body kept because it's the
// only thing that explains the failure in the report.
const logPath = join(dir, 'network.json')
assert.ok(existsSync(logPath), `network.json should exist:\n${stderr}`)
const log = JSON.parse(readFileSync(logPath, 'utf-8'))
const raw = readFileSync(logPath, 'utf-8')
assert.ok(!raw.includes('SECRETTOKEN123'), 'session token leaked into the run artifact')
assert.ok(raw.includes('[redacted]'), 'token should be redacted in place, not dropped')

const imgs = log.filter((r) => r.ctype === 'image/png')
const xml = log.filter((r) => r.ctype === 'text/xml')
assert.equal(imgs.length, 15, `4 loads x 4 tiles, less the one that answered XML — got ${imgs.length}`)
assert.equal(xml.length, 1, `expected exactly one exception row, got ${xml.length}`)
assert.deepEqual([...new Set(imgs.map((r) => r.body))], [''], 'binary image bodies must not be read into the log')
assert.ok(!raw.includes('_raw') && !raw.includes('_seen'), 'run-time bookkeeping fields must be stripped from the artifact')
// Chromium discards the body of a response the renderer rejected, so the row itself is empty —
// the reason is recovered by assertRequest's re-fetch and lands in the step error (checked above).

console.log('✅ assertRequest: 200-XML caught, empty match caught, token redacted,', log.length, 'rows logged')
