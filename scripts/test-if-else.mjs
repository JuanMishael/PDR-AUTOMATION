// Smoke test for If/Else blocks: generates a real script with ifStart/elseStart/ifEnd markers,
// runs it headless against a local fixture page, and asserts WHICH branch actually executed.
// Comment steps are the branch markers — they report passed without touching the page, so the
// reported labels are a direct readout of the taken path. Run: node scripts/test-if-else.mjs
import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundleCore } from './bundle-core.mjs'

const dir = join(tmpdir(), 'pdr-ifelse-test')
mkdirSync(dir, { recursive: true })

const { generateScript, replaySteps } = await bundleCore(['scriptGenerator.js', 'stepReplay.js'])

// #promo only exists when the URL hash says so — one fixture, both condition outcomes.
const fixture = join(dir, 'fixture.html')
writeFileSync(fixture, `<!doctype html><title>Fixture</title>
<h1 id="title">Hello tester</h1>
<div id="promo" hidden>Promo banner</div>
<input id="out">
<script>
// hashchange too: navigating between #promo and no-hash is a same-document nav, so the page
// script does NOT re-run and the fixture would go stale between scenarios.
const apply = () => { document.getElementById('promo').hidden = location.hash !== '#promo' }
apply(); addEventListener('hashchange', apply)
</script>`)
const pageUrl = pathToFileURL(fixture).href

let id = 0
const step = (action, label, params = {}) => ({ id: ++id, action, label, params, sort_order: id })
const go = (hash = '') => step('navigate', 'open', { url: pageUrl + hash })
const mark = (label) => step('comment', label, { text: label })
const ifStart = (label, cond) => step('ifStart', label, { cond })
const elseStart = () => step('elseStart', 'Else', {})
const ifEnd = () => step('ifEnd', 'End If', {})

const scenarios = [
  // 1. condition true → then runs, else does not
  { id: 's1', name: 'then branch', steps: [
    go('#promo'),
    ifStart('promo visible?', { type: 'visible', selector: '#promo' }),
    mark('S1-THEN'),
    elseStart(),
    mark('S1-ELSE'),
    ifEnd(),
    mark('S1-AFTER')
  ] },

  // 2. same block, condition false → else runs
  { id: 's2', name: 'else branch', steps: [
    go(),
    ifStart('promo visible?', { type: 'visible', selector: '#promo' }),
    mark('S2-THEN'),
    elseStart(),
    mark('S2-ELSE'),
    ifEnd(),
    mark('S2-AFTER')
  ] },

  // 3. nested if inside the taken then-branch
  { id: 's3', name: 'nested', steps: [
    go('#promo'),
    ifStart('outer', { type: 'visible', selector: '#promo' }),
    ifStart('inner', { type: 'visible', selector: '#nope' }),
    mark('S3-INNER-THEN'),
    elseStart(),
    mark('S3-INNER-ELSE'),
    ifEnd(),
    elseStart(),
    mark('S3-OUTER-ELSE'),
    ifEnd()
  ] },

  // 4. no else branch, condition false → block is skipped, the run continues past it
  { id: 's4', name: 'no else', steps: [
    go(),
    ifStart('missing', { type: 'visible', selector: '#nope' }),
    mark('S4-THEN'),
    ifEnd(),
    mark('S4-AFTER')
  ] },

  // 5. NOT + a text condition, and a stray ifEnd that must be ignored rather than eat the rest
  { id: 's5', name: 'negate + stray', steps: [
    go(),
    ifEnd(),
    mark('S5-AFTER-STRAY'),
    ifStart('not visible', { type: 'visible', selector: '#nope', negate: true }),
    mark('S5-NEG-THEN'),
    ifEnd(),
    ifStart('title text', { type: 'text', selector: '#title', expected: 'Hello', mode: 'contains' }),
    mark('S5-TEXT-THEN'),
    ifEnd()
  ] },

  // 6. a missing element must read as a false condition, not a run failure — the else still runs
  //    and the scenario keeps going
  { id: 's6', name: 'missing element is false, not fatal', steps: [
    go(),
    ifStart('exists?', { type: 'exists', selector: '#nope' }),
    mark('S6-THEN'),
    elseStart(),
    mark('S6-ELSE'),
    ifEnd(),
    mark('S6-AFTER')
  ] }
]

const script = generateScript({
  profile: { browser: 'chromium', headless: true, timeout: 10000, base_url: '' },
  scenarios,
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

const ran = []      // labels of steps that actually executed
const failed = []
let stderr = ''
proc.stdout.on('data', (c) => {
  for (const line of c.toString().split('\n').filter(Boolean)) {
    try {
      const m = JSON.parse(line)
      if (m.type === 'step') { ran.push(m.label); if (m.status === 'failed') failed.push(`${m.label}: ${m.error}`) }
    } catch { /* non-JSON chatter */ }
  }
})
proc.stderr.on('data', (c) => { stderr += c.toString() })

await new Promise((done) => proc.on('close', done))

const took = (l) => assert.ok(ran.includes(l), `expected ${l} to run — ran: ${ran.join(', ')}\n${stderr}`)
const skipped = (l) => assert.ok(!ran.includes(l), `expected ${l} NOT to run — ran: ${ran.join(', ')}`)

assert.deepEqual(failed, [], `no step should fail:\n${failed.join('\n')}\n${stderr}`)
assert.ok(ran.length, `nothing ran at all:\n${stderr}`)

took('S1-THEN');        skipped('S1-ELSE');       took('S1-AFTER')
skipped('S2-THEN');     took('S2-ELSE');          took('S2-AFTER')
took('S3-INNER-ELSE');  skipped('S3-INNER-THEN'); skipped('S3-OUTER-ELSE')
skipped('S4-THEN');     took('S4-AFTER')
took('S5-AFTER-STRAY'); took('S5-NEG-THEN');      took('S5-TEXT-THEN')
skipped('S6-THEN');     took('S6-ELSE');          took('S6-AFTER')

console.log('✅ run path: If/Else branch checks passed —', ran.length, 'steps ran')

// --- replay path (record / pick / test) --------------------------------------------------------
// Same markers go through stepReplay's own parser + evalCond. Comments aren't replayable, so the
// branch is read off the page: whichever branch ran is the one that filled #out.
const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

const replayCase = async (hash) => {
  await page.goto(pageUrl)                     // reset, then let the block's own navigate set the hash
  await page.fill('#out', '')
  const res = await replaySteps(page, [
    go(hash),
    ifStart('promo visible?', { type: 'visible', selector: '#promo' }),
    step('fill', 'then', { selector: '#out', value: 'THEN' }),
    elseStart(),
    step('fill', 'else', { selector: '#out', value: 'ELSE' }),
    ifEnd()
  ], '')
  assert.ok(res.ok, `replay failed: ${res.error}`)
  return page.inputValue('#out')
}

assert.equal(await replayCase('#promo'), 'THEN', 'replay took the wrong branch (condition true)')
assert.equal(await replayCase(''), 'ELSE', 'replay took the wrong branch (condition false)')
await browser.close()

console.log('✅ replay path: If/Else branch checks passed')
