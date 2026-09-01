// Self-healing must PREFER the primary selector. The old .or() union resolved in DOM order, so a
// loose Alt Selector matching an element ABOVE the target hijacked the step — the click landed on
// the wrong element and the step still reported green. Alts are a fallback for a ROTTED primary.
// Run: node scripts/test-heal-order.mjs
import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundleCore } from './bundle-core.mjs'

const dir = join(tmpdir(), 'pdr-heal-test')
mkdirSync(dir, { recursive: true })
const { generateScript, replaySteps } = await bundleCore(['scriptGenerator.js', 'stepReplay.js'])

// #decoy comes FIRST in the DOM and is matched by the alt selector; the real target is below it.
const fixture = join(dir, 'fixture.html')
writeFileSync(fixture, `<!doctype html><title>Heal order</title>
<input id="out" value="">
<div id="panel">
  <button id="decoy" onclick="out.value += 'DECOY;'">x</button>
  <button id="target" class="btn close-me" onclick="out.value += 'TARGET;'">x</button>
  <button id="fallback" class="btn" onclick="out.value += 'FALLBACK;'">x</button>
</div>
<div id="closed_panel" style="display:none">
  <button class="close-panel" onclick="out.value += 'HIDDEN_TWIN;'">x</button>
</div>
<div id="open_panel">
  <button class="close-panel" onclick="out.value += 'VISIBLE_TWIN;'">x</button>
</div>`)
const pageUrl = pathToFileURL(fixture).href

let id = 0
const step = (action, label, params) => ({ id: ++id, action, label, params, sort_order: id })
const open   = step('navigate', 'open', { url: pageUrl })
// Primary matches #target. Alt matches #decoy first in DOM order — it must NOT win.
const hit    = step('click', 'hit',    { selector: '.close-me', selector2: '#panel > button' })
// Primary matches nothing (rotted) — the alt must take over, proving fallback still works.
const rotted = step('click', 'rotted', { selector: '.gone-in-v2', selector2: '#fallback' })
// Two panels keep a close button each; only one is on screen. Landing on the hidden one waits out
// the whole timeout while the panel the tester is looking at stays open.
const twin   = step('click', 'twin',   { selector: '.close-panel', selector2: '#open_panel button' })

// --- run path
const script = generateScript({
  profile: { browser: 'chromium', headless: true, timeout: 10000, base_url: '' },
  scenarios: [{ id: 's1', name: 'heal', steps: [open, hit, rotted, twin] }],
  settings: { settle_before_action: '0' },
  outputDir: dir
})
const scriptPath = join(dir, 'run.js')
writeFileSync(scriptPath, script, 'utf-8')
const nodeModules = resolve(import.meta.dirname, '..', 'node_modules')
const proc = spawn(process.execPath, [scriptPath], {
  cwd: dir,
  env: { ...process.env, NODE_PATH: process.env.NODE_PATH ? `${nodeModules};${process.env.NODE_PATH}` : nodeModules }
})
const failed = []
let stderr = ''
proc.stdout.on('data', (c) => {
  for (const line of c.toString().split('\n').filter(Boolean)) {
    try { const m = JSON.parse(line); if (m.type === 'step' && m.status === 'failed') failed.push(`${m.label}: ${m.error}`) } catch { /* chatter */ }
  }
})
proc.stderr.on('data', (c) => { stderr += c.toString() })
await new Promise((done) => proc.on('close', done))
assert.deepEqual(failed, [], `no step should fail:\n${failed.join('\n')}\n${stderr}`)

// --- replay path (recorder pre-Start playback / picker / selector tester)
const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto(pageUrl)
const res = await replaySteps(page, [hit, rotted, twin], '')
assert.ok(res.ok, `replay failed: ${res.error}`)
assert.equal(await page.inputValue('#out'), 'TARGET;FALLBACK;VISIBLE_TWIN;',
  'replay: primary beats an earlier-in-DOM alt, a rotted primary falls back, and a visible match beats a hidden twin')
await browser.close()

console.log('ok — heal order (run + replay)')
