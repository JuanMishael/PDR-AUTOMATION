// Smoke test for run recording: generates a real script with record_video on, runs it headless,
// and asserts a playable .webm actually landed on disk and its path was reported back to the
// runner. Also covers the failing run — a crashed step exits via process.exit (which skips
// `finally`), so the video flush has to happen on that path too, and that's exactly the run a
// tester wants to watch. Run: node scripts/test-video.mjs
import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync, statSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundleCore } from './bundle-core.mjs'

const dir = join(tmpdir(), 'pdr-video-test')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

const { generateScript, pruneRunArtifacts } = await bundleCore(['scriptGenerator.js', 'db.js'])

const fixture = join(dir, 'fixture.html')
writeFileSync(fixture, `<!doctype html><title>Video</title><h1 id="title">Recording</h1><input id="echo">`)
const pageUrl = pathToFileURL(fixture).href

let id = 0
const step = (action, label, params = {}) => ({ id: ++id, action, label, params, sort_order: id })

// Runs a scenario with recording on; returns the video path the script reported (or null).
const runAndGetVideo = async (name, steps) => {
  const outDir = join(dir, name)
  mkdirSync(outDir, { recursive: true })
  const script = generateScript({
    profile: { browser: 'chromium', headless: true, timeout: 5000, base_url: '' },
    scenarios: [{ id: name, name, steps }],
    settings: { settle_before_action: '0', record_video: '1', trace_on_fail: '0' },
    outputDir: outDir
  })
  writeFileSync(join(outDir, 'run.js'), script, 'utf-8')

  const nodeModules = resolve(import.meta.dirname, '..', 'node_modules')
  const proc = spawn(process.execPath, [join(outDir, 'run.js')], {
    cwd: outDir,
    env: { ...process.env, NODE_PATH: process.env.NODE_PATH ? `${nodeModules};${process.env.NODE_PATH}` : nodeModules }
  })

  let videoPath = null
  let stderr = ''
  proc.stderr.on('data', (c) => {
    stderr += c.toString()
    for (const line of c.toString().split('\n').filter(Boolean)) {
      try { const m = JSON.parse(line); if (m.type === 'video') videoPath = m.path } catch { /* chatter */ }
    }
  })
  proc.stdout.on('data', () => {})
  await new Promise((done) => proc.on('close', done))
  return { videoPath, stderr }
}

// 1. a clean run
const ok = await runAndGetVideo('pass', [
  step('navigate', 'open', { url: pageUrl }),
  step('fill', 'type', { selector: '#echo', value: 'hello' }),
  step('assertVisible', 'title', { selector: '#title' })
])
assert.ok(ok.videoPath, `no video path reported for a passing run:\n${ok.stderr}`)
assert.ok(ok.videoPath.endsWith('.webm'), `expected a .webm, got ${ok.videoPath}`)
assert.ok(statSync(ok.videoPath).size > 0, 'video file is empty — the context was not closed before exit')

// 2. a run that dies mid-way still leaves a watchable recording
const bad = await runAndGetVideo('fail', [
  step('navigate', 'open', { url: pageUrl }),
  step('click', 'missing element', { selector: '#nope' })
])
assert.ok(bad.videoPath, `no video path reported for a FAILING run — the process.exit path skips the flush:\n${bad.stderr}`)
assert.ok(statSync(bad.videoPath).size > 0, 'failing run left an empty video file')

// 3. off means off — no recordVideo in the generated context options
const noVideo = generateScript({
  profile: { browser: 'chromium', headless: true, timeout: 5000, base_url: '' },
  scenarios: [{ id: 'x', name: 'x', steps: [step('navigate', 'open', { url: pageUrl })] }],
  settings: { record_video: '0' },
  outputDir: dir
})
assert.ok(!noVideo.includes('recordVideo'), 'record_video=0 still emitted a recording context')

console.log('✅ video: pass + fail runs both recorded, opt-out honoured')

// 4. retention sweep — the recordings are what makes an un-pruned artifacts dir expensive, so
// the deleting side gets its own check: old run folders go, recent ones stay, and a folder is
// only ever removed from inside the pdr-runs root it was handed.
const runsRoot = join(dir, 'pdr-runs')
const old = join(runsRoot, 'old-run')
const fresh = join(runsRoot, 'fresh-run')
mkdirSync(join(old, 'video'), { recursive: true })
mkdirSync(join(fresh, 'video'), { recursive: true })
writeFileSync(join(old, 'video', 'a.webm'), 'x')
writeFileSync(join(fresh, 'video', 'b.webm'), 'x')
const longAgo = new Date(Date.now() - 40 * 86400000)
utimesSync(old, longAgo, longAgo)

pruneRunArtifacts(runsRoot, 30)
assert.ok(!existsSync(old), 'a 40-day-old run folder survived a 30-day retention window')
assert.ok(existsSync(join(fresh, 'video', 'b.webm')), 'a fresh run folder was deleted')

pruneRunArtifacts(join(dir, 'no-such-dir'), 30)   // must not throw before the first run ever happens
console.log('✅ retention: stale run folders swept, recent ones kept')
