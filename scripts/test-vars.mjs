// Smoke test for run-scoped variables: Capture Value writes {{var.x}}, later steps read it, and
// Custom Code shares the same store. Runs the real generated script headless against a local
// fixture, then repeats the flow through stepReplay so the two paths can't drift.
// Run: node scripts/test-vars.mjs
import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundleCore } from './bundle-core.mjs'

const dir = join(tmpdir(), 'pdr-vars-test')
mkdirSync(dir, { recursive: true })

const { generateScript, replaySteps } = await bundleCore(['scriptGenerator.js', 'stepReplay.js'])

// #order holds the value to capture (with sloppy whitespace, which must be trimmed away);
// #echo is where later steps write, so what they received can be read back.
const fixture = join(dir, 'fixture.html')
writeFileSync(fixture, `<!doctype html><title>Vars</title>
<div id="order" data-id="A-42">   ORD-1234
</div>
<input id="echo">`)
const pageUrl = pathToFileURL(fixture).href

let id = 0
const step = (action, label, params = {}) => ({ id: ++id, action, label, params, sort_order: id })
const go = () => step('navigate', 'open', { url: pageUrl })
const capture = (name, params) => step('captureValue', `capture ${name}`, { name, ...params })

const scenarios = [
  // 1. capture page text → reuse it in a later step's value (the copy/paste case)
  { id: 's1', name: 'capture and reuse', steps: [
    go(),
    capture('orderId', { from: 'text', selector: '#order' }),
    step('fill', 'echo it back', { selector: '#echo', value: 'order={{var.orderId}}' }),
    step('assertValue', 'echoed', { selector: '#echo', value: 'order=ORD-1234' })
  ] },

  // 2. attribute + url sources, and two tokens in one string
  { id: 's2', name: 'attribute and url', steps: [
    go(),
    capture('dataId', { from: 'attribute', selector: '#order', attr: 'data-id' }),
    capture('here', { from: 'url' }),
    step('fill', 'combine', { selector: '#echo', value: '{{var.dataId}}|{{var.here}}' }),
    step('assertValue', 'both resolved', { selector: '#echo', value: `A-42|${pageUrl}` })
  ] },

  // 3. Custom Code writes to the SAME store the token reads from
  { id: 's3', name: 'custom code shares vars', steps: [
    go(),
    step('runScript', 'compute', { code: `vars.total = String((await page.locator('#order').innerText()).trim().length)` }),
    step('fill', 'use it', { selector: '#echo', value: 'len={{var.total}}' }),
    step('assertValue', 'computed', { selector: '#echo', value: 'len=8' })
  ] },

  // 4. an If condition can compare against a captured value
  { id: 's4', name: 'condition reads a var', steps: [
    go(),
    capture('orderId', { from: 'text', selector: '#order' }),
    step('ifStart', 'text matches capture?', { cond: { type: 'text', selector: '#order', expected: '{{var.orderId}}', mode: 'contains' } }),
    step('comment', 'S4-THEN', { text: 'S4-THEN' }),
    step('elseStart', 'Else', {}),
    step('comment', 'S4-ELSE', { text: 'S4-ELSE' }),
    step('ifEnd', 'End If', {})
  ] },

  // 5. an unknown var stays visible instead of silently becoming blank — the author sees the typo
  { id: 's5', name: 'unknown var stays literal', steps: [
    go(),
    step('fill', 'typo', { selector: '#echo', value: '{{var.nope}}' }),
    step('assertValue', 'left as written', { selector: '#echo', value: '{{var.nope}}' })
  ] }
]

const script = generateScript({
  profile: { browser: 'chromium', headless: true, timeout: 10000, base_url: '' },
  scenarios,
  settings: { settle_before_action: '0' },
  outputDir: dir
})
writeFileSync(join(dir, 'run.js'), script, 'utf-8')

const nodeModules = resolve(import.meta.dirname, '..', 'node_modules')
const proc = spawn(process.execPath, [join(dir, 'run.js')], {
  cwd: dir,
  env: { ...process.env, NODE_PATH: process.env.NODE_PATH ? `${nodeModules};${process.env.NODE_PATH}` : nodeModules }
})

const ran = []
const failed = []
const captured = []
let stderr = ''
proc.stdout.on('data', (c) => {
  for (const line of c.toString().split('\n').filter(Boolean)) {
    try {
      const m = JSON.parse(line)
      if (m.type === 'step') { ran.push(m.label); if (m.status === 'failed') failed.push(`${m.label}: ${m.error}`) }
      if (m.type === 'capture') captured.push(`${m.name}=${m.value}`)
    } catch { /* non-JSON chatter */ }
  }
})
proc.stderr.on('data', (c) => { stderr += c.toString() })
await new Promise((done) => proc.on('close', done))

assert.deepEqual(failed, [], `no step should fail:\n${failed.join('\n')}\n${stderr}`)
assert.ok(ran.length, `nothing ran at all:\n${stderr}`)
assert.ok(captured.includes('orderId=ORD-1234'), `capture should trim surrounding whitespace — got ${captured.join(', ')}`)
assert.ok(ran.includes('S4-THEN'), `If comparing against {{var.orderId}} took the wrong branch — ran: ${ran.join(', ')}`)
assert.ok(!ran.includes('S4-ELSE'), `If comparing against {{var.orderId}} took the wrong branch — ran: ${ran.join(', ')}`)

console.log('✅ run path: variable checks passed —', ran.length, 'steps ran')

// --- replay path (record / pick / test) --------------------------------------------------------
const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

const echoAfter = async (steps) => {
  await page.goto(pageUrl)
  const res = await replaySteps(page, [go(), ...steps], '')
  assert.ok(res.ok, `replay failed: ${res.error}`)
  return page.inputValue('#echo')
}

assert.equal(
  await echoAfter([
    capture('orderId', { from: 'text', selector: '#order' }),
    step('fill', 'echo', { selector: '#echo', value: 'order={{var.orderId}}' })
  ]),
  'order=ORD-1234',
  'replay did not substitute a captured variable'
)

assert.equal(
  await echoAfter([
    step('runScript', 'compute', { code: `vars.total = String((await page.locator('#order').innerText()).trim().length)` }),
    step('fill', 'echo', { selector: '#echo', value: 'len={{var.total}}' })
  ]),
  'len=8',
  'replay custom code did not share the variable store'
)

await browser.close()
console.log('✅ replay path: variable checks passed')
