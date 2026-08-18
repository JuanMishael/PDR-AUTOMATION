/**
 * Generates a self-contained Playwright script as a JS string at runtime.
 * No .js files are written to disk. The script is passed directly to the runner.
 *
 * Action types:
 * Navigation  : navigate, reload, goBack, goForward, waitForUrl
 * Interaction : click, dblclick, rightClick, hover, focus, selectOption,
 *               setCheckbox, fill, type, clearInput, pressKey, uploadFile,
 *               dragAndDrop
 * Mouse / Map : clickAt, dragByOffset, zoom, pinCoordinate, mapZoom
 * Assertions  : assertVisible, assertHidden, assertText, assertValue,
 *               assertUrl, assertTitle, assertEnabled, assertChecked, assertRequest
 * Waits       : waitForSelector, waitForTimeout, waitForNetworkIdle
 * Util        : screenshot, executeScript
 */

import { resolveParams } from './tokenResolver'
import { findDragHandleRect, synthDrag } from './dragHelpers'
import { mapPickPixel, mapSetZoom } from './mapHelpers'
import { mobileContextOptions } from './deviceProfile'
import { healAlts } from './healChain'

export function generateScript({ profile, scenarios = [], settings = {}, outputDir = '', dataContext = null, downloadsDir = '' }) {
  const timeout = profile.timeout || 30000
  const baseUrl = profile.base_url || ''
  const traceOnFail = settings.trace_on_fail === '1'
  const screenshotOnFail = settings.screenshot_on_fail === '1'
  // Cypress-style run recording. Playwright records the whole context to .webm for free — no
  // encoder, no extra dependency. Always-on when enabled (Playwright can't start recording
  // retroactively once a step fails), so the file is kept whether the run passes or not.
  const recordVideo = settings.record_video !== '0'
  // "Calm playback": before each action, wait for the page's network to go quiet so the UI
  // a prior step triggered has actually landed — instead of clicking/typing into a half-loaded
  // page. Default ON. It's a bounded best-effort settle (never fails the step), so a never-idle
  // app (polling/SSE) just proceeds at the cap. Disable per-step with params._noSettle.
  // Mobile view: emulate a phone (viewport + touch + UA) so a mobile-only web app renders right.
  const mobile = profile.mobile === 1 || profile.mobile === true
  const ctxOptions = { ignoreHTTPSErrors: true, acceptDownloads: true, ...mobileContextOptions(profile.browser, mobile) }
  if (recordVideo) ctxOptions.recordVideo = { dir: outputDir + '/video' }

  const settleEnabled = settings.settle_before_action !== '0'
  // Cap on the per-step settle. 0 = no limit (wait until the network is fully idle) — only safe
  // on apps that actually go quiet; on a polling/streaming app it waits the whole step out.
  const _rawCap = settings.settle_timeout
  const _capN = (_rawCap === '' || _rawCap == null) ? 3000 : Number(_rawCap)
  const settleCap = Number.isFinite(_capN) && _capN >= 0 ? _capN : 3000

  // One browser session for the whole run. Scenarios execute in order, carrying state
  // (cookies, login, created records) from one to the next. A "scenario" marker is
  // emitted before each so the live log and results can attribute steps.
  //
  // Each scenario's steps are wrapped in their own try/catch so a failure ends THAT
  // scenario (its remaining steps are skipped) but the run CONTINUES to the next
  // scenario — every scenario gets its own pass/fail. A within-scenario step failure
  // still stops that scenario (the failing step rethrows); only the per-scenario
  // boundary is caught here. Browser-setup failures still hit the outer try → fatal.
  let globalIndex = 0

  // Group/loop markers are expanded away by expandGroups before we get here; drop any that slip
  // through. If-block markers (ifStart/elseStart/ifEnd) survive expansion and are turned into real
  // runtime if/else below — a condition can only be evaluated live, not statically unrolled.
  const DEAD_MARKERS = ['groupStart', 'groupEnd', 'loopStart', 'loopEnd']

  // Emit a flat step list that MAY contain if-blocks. Recurses into each branch so nested
  // conditionals nest as nested JS if/else. Leaf steps go through generateStep unchanged (each
  // keeps its own try/catch + result reporting); only one branch runs, so a not-taken branch's
  // steps simply don't report (they didn't run).
  const emitList = (list) => {
    const parts = []
    let i = 0
    while (i < list.length) {
      const s = list[i]
      if (DEAD_MARKERS.includes(s.action)) { i++; continue }
      if (s.action === 'ifStart') {
        let depth = 1, j = i + 1, elseAt = -1
        while (j < list.length && depth > 0) {
          const a = list[j].action
          if (a === 'ifStart') depth++
          else if (a === 'ifEnd') { depth--; if (depth === 0) break }
          else if (a === 'elseStart' && depth === 1) elseAt = j
          j++
        }
        const thenList = list.slice(i + 1, elseAt === -1 ? j : elseAt)
        const elseList = elseAt === -1 ? [] : list.slice(elseAt + 1, j)
        parts.push(emitIf(s, emitList(thenList), emitList(elseList)))
        i = j + 1
      } else if (s.action === 'elseStart' || s.action === 'ifEnd') {
        i++   // stray marker (no matching start) — ignore
      } else {
        parts.push(generateStep(s, globalIndex, baseUrl, { screenshotOnFail, outputDir, dataContext, settleEnabled, settleCap }))
        globalIndex++
        i++
      }
    }
    return parts.join('\n\n')
  }

  // Wrap the then/else code in a real runtime if/else driven by __cond(). The condition's selectors
  // ride the same self-healing chain as actions; its {{tokens}} (e.g. an expected value) resolve now.
  const emitIf = (step, thenCode, elseCode) => {
    const raw = typeof step.params === 'string' ? JSON.parse(step.params) : (step.params || {})
    const cond = resolveParams(raw.cond || {}, dataContext)
    const sels = [(cond.selector || '').trim(), ...healAlts(cond)].filter(Boolean)
    const condLit = JSON.stringify({
      type: cond.type || 'visible',
      sel: sels.length ? sels : ['body'],
      expected: cond.expected ?? '',
      mode: cond.mode || 'contains',
      negate: !!cond.negate,
      timeoutMs: Number(cond.timeoutMs) > 0 ? Number(cond.timeoutMs) : 0
    })
    const label = (step.label || 'condition').replace(/\*\//g, '* /')
    const elseBlock = elseCode.trim() ? ` else {\n${indent(elseCode, 2)}\n  }` : ''
    // condLit is inlined as an object LITERAL (not parsed JSON), so wrapVars' __sub() calls are
    // valid inside it — a condition can compare against a captured {{var.x}}.
    return `
  // If: ${label}
  if (await __cond(${wrapVars(condLit)})) {
${indent(thenCode, 2)}
  }${elseBlock}`.trim()
  }

  const blocks = []
  for (const sc of scenarios) {
    const orderedSteps = [...(sc.steps || [])].sort((a, b) => a.sort_order - b.sort_order)
    const stepCode = emitList(orderedSteps)
    blocks.push(
`process.stdout.write(JSON.stringify({ type: 'scenario', id: ${JSON.stringify(sc.id || null)}, name: ${JSON.stringify(sc.name || 'Scenario')} }) + '\\n');
try {
${indent(stepCode, 2)}
} catch (_scErr) {
  // Scenario failed — the failing step already reported its status. Continue to the next scenario.
}`)
  }
  const stepBlocks = blocks.join('\n\n')

  const traceStart = traceOnFail
    ? `await context.tracing.start({ screenshots: true, snapshots: true });`
    : ''

  const traceStop = traceOnFail ? `
    if (context) {
      const tracePath = ${JSON.stringify(outputDir + '/trace.zip')};
      await context.tracing.stop({ path: tracePath });
      process.stderr.write(JSON.stringify({ type: 'trace', path: tracePath }) + '\\n');
    }` : ''

  // Network log flush — drain anything still in flight (a click's responses can land after the
  // run loop ends), wait for the response bodies to resolve, THEN write to disk + tell the runner.
  // Without the drain a late/last traced step captures nothing. Only opted-in steps push, so an
  // empty log = no file.
  const netStop = `
    try { await _settle(2000); } catch { /* page may be gone */ }
    try { await Promise.allSettled(_pending); } catch { /* best-effort */ }
    try {
      if (_netlog.length) {
        // _raw (un-redacted URL) and _seen (assert bookkeeping) are run-time only — never written.
        require('fs').writeFileSync(${JSON.stringify(outputDir + '/network.json')}, JSON.stringify(_netlog, (k, v) => (k === '_raw' || k === '_seen') ? undefined : v));
        process.stderr.write(JSON.stringify({ type: 'network', path: ${JSON.stringify(outputDir + '/network.json')} }) + '\\n');
      }
    } catch { /* best-effort */ }`

  // Video flush. Playwright only finalizes the .webm when the CONTEXT closes, and page.video()
  // has to be grabbed while the page object is still alive — so this runs after the network
  // flush and instead of relying on browser.close() (the fatal path calls process.exit, which
  // skips finally entirely, so both exit paths flush for themselves).
  const videoStop = recordVideo ? `
    try {
      const _vid = page && page.video();
      if (context) await context.close();
      const _vidPath = _vid ? await _vid.path() : null;
      if (_vidPath) process.stderr.write(JSON.stringify({ type: 'video', path: _vidPath }) + '\\n');
    } catch { /* a crashed page must not fail the run over its recording */ }` : ''

  // URL fragments named by assertRequest steps. Those requests are logged even when the step that
  // FIRES them never ticked "include network trace" — otherwise a tester would have to know which
  // step triggers the tile fan-out before the assert could see anything. Keeps the log small:
  // only what an assert actually asks about, plus whatever a step opted into.
  const assertPats = [...new Set(scenarios
    .flatMap((sc) => sc.steps || [])
    .filter((s) => s.action === 'assertRequest')
    .map((s) => { try { const q = typeof s.params === 'string' ? JSON.parse(s.params) : (s.params || {}); return String(q.urlContains || '').trim() } catch { return '' } })
    .filter(Boolean))]

  // Network state + helpers — declared at the IIFE top (NOT inside the try) so _settle() and the
  // finally-block flush can both see them. Capped PER STEP (one click can fan out to many
  // map-layer calls) and overall as a safety net.
  const netDecls = `
  let _inflight = 0, _lastNetTs = Date.now(), _curStep = null;
  const _netlog = [], _pending = [];
  const _NET_MAX = 2000, _PER_STEP_MAX = 50, _BODY_CAP = 4096;
  const _reqStart = new Map();
  const _assertPats = ${JSON.stringify(assertPats)};
  const _cap = (t) => !t ? '' : (t.length > _BODY_CAP ? t.slice(0, _BODY_CAP) + '\\u2026[truncated]' : t);
  const _isImg = (ct) => /^image\\//i.test(ct || '');
  // A GIS tile URL carries the session token as a query param and network.json ships with the run
  // artifacts — the credential must never reach disk.
  const _redact = (u) => String(u).replace(/([?&](?:token|api[_-]?key|apikey|auth|signature|password)=)[^&#]*/gi, '$1[redacted]');
  const _settleEnd = (req) => { _inflight = Math.max(0, _inflight - 1); _lastNetTs = Date.now(); };
  // Should this request be logged against the current step? xhr/fetch/image, and either the step
  // opted in or an assertRequest asked about this URL. Images are the tile fan-out (80+ on a single
  // map pan) so they count against the per-step cap — but a non-image or failed response is the
  // rare row that EXPLAINS a failure, so it's kept even once the cap is spent.
  const _take = (m, url, ctype) => {
    const s = _curStep;
    if (!s || !m) return null;
    if (m.type !== 'xhr' && m.type !== 'fetch' && m.type !== 'image') return null;
    if (!s.trace && !_assertPats.some((x) => url.includes(x))) return null;
    if (_netlog.length >= _NET_MAX) return null;
    if (s.n >= _PER_STEP_MAX && _isImg(ctype)) return null;
    return s;
  };`

  // Network instrumentation: attach the context listeners (needs `context`, so it lives in the try).
  // Counting covers ALL requests so a settle waits for document/script loads too; the LOG is
  // filtered by _take and only records while a step opted in (_curStep.trace) or an assertRequest
  // named the URL.
  const netInstrument = `
    context.on('request', (req) => { _inflight++; _reqStart.set(req, { t: Date.now(), type: req.resourceType() }); });
    context.on('requestfinished', _settleEnd);
    context.on('requestfailed', (req) => {
      _settleEnd(req);
      const m = _reqStart.get(req); _reqStart.delete(req);
      const s = _take(m, req.url(), '');
      if (s) { s.n++; _netlog.push({ step: s.label, method: req.method(), url: _redact(req.url()), type: m.type, ctype: '', status: 0, ok: false, ms: Date.now() - m.t, payload: _cap(req.postData()), body: '', error: (req.failure() && req.failure().errorText) || 'failed' }); }
    });
    context.on('response', (res) => {
      const req = res.request();
      const m = _reqStart.get(req);
      const ctype = ((res.headers()['content-type'] || '').split(';')[0] || '').trim();
      const s = _take(m, res.url(), ctype);   // decide + count synchronously, before the body await races
      if (!s) return;
      s.n++;
      // Row is pushed NOW, body filled in later by reference — so an assertRequest reading _netlog
      // can never race ahead of a response that already arrived.
      // _raw keeps the un-redacted URL for a failure re-fetch; it's stripped before the log is
      // written, so the token stays in memory and never reaches disk.
      const row = { step: s.label, method: req.method(), url: _redact(res.url()), _raw: res.url(), type: m.type, ctype, status: res.status(), ok: res.ok(), ms: Date.now() - m.t, payload: _cap(req.postData()), body: '' };
      _netlog.push(row);
      // Image bodies are binary — reading them just fills network.json with noise. A NON-image body
      // is worth keeping: on a WMS tile that came back as XML, that body is the error text. Note
      // Chromium discards the body of a response the renderer rejected (an <img> that got XML), so
      // this often resolves empty — assertRequest re-fetches on failure to recover the reason.
      if (!_isImg(ctype)) _pending.push(res.text().then((t) => { row.body = _cap(t); }, () => {}));
    });`

  // Bounded best-effort settle: a short floor (so a just-fired XHR has time to register), then
  // wait until no requests are in flight AND the network has been quiet ~500ms — capped, never throws.
  const settleHelper = `
  async function _settle(capMs) {
    const unlimited = !(capMs > 0);   // capMs <= 0 → wait until fully idle, no time limit
    try {
      await page.waitForTimeout(150);
      const _start = Date.now();
      while (unlimited || Date.now() - _start < capMs) {
        if (_inflight === 0 && (Date.now() - _lastNetTs) >= 500) return;
        await page.waitForTimeout(100);
      }
    } catch { /* never let a settle fail the step (e.g. page closed / stopped) */ }
  }`

  // Persist anything the app downloads (CSV export, etc.). Playwright accepts the
  // download into a temp dir and deletes it on close, so without saveAs the tester
  // never sees the file. We save it to the OS Downloads folder with a browser-style
  // " (n)" suffix on name clashes, and attach to popups too (target=_blank exports).
  const downloadHandler = downloadsDir ? `
    const _downloadsDir = ${JSON.stringify(downloadsDir)};
    const _saveDownload = async (download) => {
      try {
        const _fs = require('fs'), _path = require('path');
        _fs.mkdirSync(_downloadsDir, { recursive: true });
        const _name = download.suggestedFilename() || 'download';
        let _dest = _path.join(_downloadsDir, _name);
        if (_fs.existsSync(_dest)) {
          const _ext = _path.extname(_name), _base = _path.basename(_name, _ext);
          let _i = 1;
          do { _dest = _path.join(_downloadsDir, _base + ' (' + (_i++) + ')' + _ext); } while (_fs.existsSync(_dest));
        }
        await download.saveAs(_dest);
        process.stdout.write(JSON.stringify({ type: 'download', path: _dest, name: _path.basename(_dest) }) + '\\n');
      } catch (e) {
        process.stdout.write(JSON.stringify({ type: 'raw', text: 'Download could not be saved: ' + ((e && e.message) || e) }) + '\\n');
      }
    };
    page.on('download', _saveDownload);
    context.on('page', (_p) => _p.on('download', _saveDownload));` : ''

  return `
const { chromium, firefox, webkit } = require('playwright');
const { expect } = require('playwright/test');

(async () => {
  const results = [];
  let browser, context, page;

  // Run-scoped variables. Capture Value and Custom Code write here; every later step reads them
  // through __sub() below. Deliberately NOT persisted — a value scraped off the UI is only true
  // for this run, and a stale one would make a broken test look green.
  const __vars = {};
  const __sub = (s) => typeof s === 'string'
    ? s.replace(/\\{\\{\\s*var\\.([^{}]+?)\\s*\\}\\}/g, (m, n) => (__vars[n.trim()] !== undefined ? __vars[n.trim()] : m))
    : s;
${netDecls}
${settleHelper}

  // Smart file upload so testers don't have to understand hidden file inputs.
  //  - trigger set     → click that button and catch the OS file dialog it opens.
  //  - selector is a real <input type=file> → set the file directly on it.
  //  - selector is anything else (the read-only display box, blank, a button) but the
  //    page has exactly one file input → use that input automatically.
  //  - otherwise treat the selector as the button that opens the dialog (file chooser).
  async function _uploadFile(selector, trigger, filePath) {
    if (trigger) {
      const [fc] = await Promise.all([ page.waitForEvent('filechooser'), page.locator(trigger).click() ]);
      return fc.setFiles(filePath);
    }
    if (selector) {
      const isFileInput = await page.evaluate((s) => {
        try { const el = document.querySelector(s); return !!el && el.matches('input[type=file]'); } catch { return false; }
      }, selector);
      if (isFileInput) return page.setInputFiles(selector, filePath);
    }
    const inputs = await page.locator('input[type=file]').elementHandles();
    if (inputs.length === 1) return inputs[0].setInputFiles(filePath);
    if (selector) {
      const [fc] = await Promise.all([ page.waitForEvent('filechooser'), page.locator(selector).click() ]);
      return fc.setFiles(filePath);
    }
    throw new Error('Upload File: could not find a file input. Set the Upload/Browse button in the step.');
  }

  // Evaluate an If-block condition. MUST NOT throw — a missing element is a false condition, not a
  // run failure — and uses instant checks (isVisible/count), not auto-waiting, since "is it there
  // NOW" is the semantic (with an optional timeoutMs for the appears-slowly case).
  async function __cond(c) {
    try {
      let loc = page.locator(c.sel[0]);
      for (let i = 1; i < c.sel.length; i++) loc = loc.or(page.locator(c.sel[i]));
      loc = loc.first();
      const t = c.timeoutMs || 0;
      let r;
      switch (c.type) {
        case 'visible': r = t ? await loc.waitFor({ state: 'visible', timeout: t }).then(() => true).catch(() => false) : await loc.isVisible(); break;
        case 'hidden':  r = t ? await loc.waitFor({ state: 'hidden', timeout: t }).then(() => true).catch(() => false) : !(await loc.isVisible()); break;
        case 'exists':  r = (await loc.count()) > 0; break;
        case 'text':    { const s = (await loc.innerText().catch(() => '')) || ''; r = c.mode === 'exact' ? s.trim() === c.expected : s.includes(c.expected); break; }
        case 'value':   { const v = (await loc.inputValue().catch(() => '')) || ''; r = c.mode === 'exact' ? v === c.expected : v.includes(c.expected); break; }
        case 'enabled': r = await loc.isEnabled().catch(() => false); break;
        case 'checked': r = await loc.isChecked().catch(() => false); break;
        case 'url':     r = (page.url() || '').includes(c.expected); break;
        case 'title':   { const ti = (await page.title().catch(() => '')) || ''; r = ti.includes(c.expected); break; }
        default:        r = false;
      }
      return c.negate ? !r : r;
    } catch { return !!c.negate; }
  }

  try {
    browser = await ${browserLaunchExpr(profile)}
    context = await browser.newContext(${JSON.stringify(ctxOptions)});
    page = await context.newPage();
    page.setDefaultTimeout(${timeout});
    ${netInstrument}
    ${downloadHandler}
    ${traceStart}

${indent(stepBlocks, 4)}

  } catch (err) {
    ${traceStop}
    ${netStop}
    ${videoStop}
    process.stderr.write(JSON.stringify({ type: 'fatal', message: err.message }) + '\\n');
    process.exit(1);
  } finally {
    ${netStop}
    ${videoStop}
    if (browser) await browser.close();
  }

  process.stdout.write(JSON.stringify({ type: 'done', results }) + '\\n');
})();
`.trim()
}

function browserLaunchExpr(profile) {
  const browser = profile.browser || 'chromium'
  const headless = profile.headless === 1 || profile.headless === true
  return `${browser}.launch({ headless: ${headless} })`
}

// {{var.x}} can't be resolved at generate time like the other tokens — the value doesn't exist
// until the run reaches the Capture Value step. Every param is emitted into the script as a JSON
// string literal, so rewriting just the literals that carry a var token routes them through
// __sub() at runtime. One pass here covers every action instead of touching ~40 emit sites.
// ponytail: regex over emitted code, not an AST — safe because JSON.stringify escapes quotes and
// newlines, so a literal never spans lines. Swap for an AST pass only if emission stops using it.
const VAR_TOKEN = /\{\{\s*var\./
function wrapVars(code) {
  if (!VAR_TOKEN.test(code)) return code
  return code.replace(/"(?:[^"\\]|\\.)*"/g, (lit) => VAR_TOKEN.test(lit) ? `__sub(${lit})` : lit)
}

function generateStep(step, index, baseUrl, { screenshotOnFail = false, outputDir = '', dataContext = null, settleEnabled = false, settleCap = 3000 } = {}) {
  const rawParams = typeof step.params === 'string' ? JSON.parse(step.params) : step.params
  // Resolve {{Collection.field}} / {{faker.*}} / {{unique.*}} to concrete values now, so the
  // emitted script stays plain JS with no runtime data dependency.
  const p = dataContext ? resolveParams(rawParams, dataContext) : rawParams
  const label = step.label || `${step.action} #${index + 1}`
  const stepId = step.id
  const perStepScreenshot = !!p._screenshot

  // Calm-playback settle BEFORE the action: wait for the prior step's network to quiet so the
  // UI it triggered has landed. Skipped for 'comment' (a no-op note) and any step the tester
  // opted out of via params._noSettle (e.g. a known polling/streaming screen).
  const doSettle = settleEnabled && p._noSettle !== true && step.action !== 'comment'
  const settlePre = doSettle ? `await _settle(${settleCap});\n    ` : ''

  // Mark which step is "current" for network attribution — set AFTER the settle (which is still
  // draining the PRIOR step's calls) and BEFORE this action, so calls land tagged to the right
  // step. trace=true only when the tester ticked "include network trace" (params._netTrace).
  const stepMarker = step.action === 'comment' ? ''
    : `_curStep = { label: ${JSON.stringify(label)}, trace: ${p._netTrace === true}, n: 0 };\n    `

  const body = settlePre + stepMarker + wrapVars(actionToCode(step.action, p, baseUrl))

  const perStepSsBlock = perStepScreenshot ? `
    try {
      const _ssPath = ${JSON.stringify(outputDir + `/step-${index + 1}-ok.png`)};
      await page.screenshot({ path: _ssPath, fullPage: false });
      process.stdout.write(JSON.stringify({ type: 'step', id: ${JSON.stringify(stepId)}, label: ${JSON.stringify(label)}, status: 'passed', screenshot: _ssPath }) + '\\n');
    } catch { process.stdout.write(JSON.stringify({ type: 'step', id: ${JSON.stringify(stepId)}, label: ${JSON.stringify(label)}, status: 'passed' }) + '\\n'); }` : `
    process.stdout.write(JSON.stringify({ type: 'step', id: ${JSON.stringify(stepId)}, label: ${JSON.stringify(label)}, status: 'passed' }) + '\\n');`

  const screenshotBlock = screenshotOnFail ? `
    try {
      const _ssPath = ${JSON.stringify(outputDir + '/')}.replace(/\\/+$/, '') + '/step-${index + 1}-fail.png';
      await page.screenshot({ path: _ssPath, fullPage: false });
      process.stdout.write(JSON.stringify({ type: 'step', id: ${JSON.stringify(stepId)}, label: ${JSON.stringify(label)}, status: 'failed', error: _err.message, screenshot: _ssPath }) + '\\n');
    } catch { process.stdout.write(JSON.stringify({ type: 'step', id: ${JSON.stringify(stepId)}, label: ${JSON.stringify(label)}, status: 'failed', error: _err.message }) + '\\n'); }` : `
    process.stdout.write(JSON.stringify({ type: 'step', id: ${JSON.stringify(stepId)}, label: ${JSON.stringify(label)}, status: 'failed', error: _err.message }) + '\\n');`

  return `
  // Step ${index + 1}: ${label}
  try {
    ${body}
    results.push({ id: ${JSON.stringify(stepId)}, label: ${JSON.stringify(label)}, status: 'passed' });
    ${perStepSsBlock.trim()}
  } catch (_err) {
    results.push({ id: ${JSON.stringify(stepId)}, label: ${JSON.stringify(label)}, status: 'failed', error: _err.message });
    ${screenshotBlock.trim()}
    throw _err;
  }`.trim()
}

function locatorExpr(p) {
  const sel = p.selector ? JSON.stringify(p.selector) : "'body'"
  // Self-healing: OR the primary with the manual Alt Selector + auto-captured chain, so a
  // drifted primary still resolves via an alternative that re-finds the same element.
  // ponytail: .or().first() unions and picks DOM order, not primary-first — if a stale auto
  // alt ever matches a WRONG element while the primary still exists, swap this for a
  // primary-preferring resolve() (try primary, fall back only on 0 matches).
  const alts = healAlts(p)
  if (alts.length) {
    const ors = alts.map(a => `.or(page.locator(${JSON.stringify(a)}))`).join('')
    return `page.locator(${sel})${ors}.first()`
  }
  return `page.locator(${sel})`
}

function actionToCode(action, p, baseUrl) {
  const sel = p.selector ? JSON.stringify(p.selector) : "'body'"
  const loc = locatorExpr(p)
  const url = p.url
    ? JSON.stringify(p.url.startsWith('http') ? p.url : baseUrl + p.url)
    : JSON.stringify(baseUrl)

  switch (action) {
    // --- Navigation ---
    case 'navigate': {
      // Default to 'domcontentloaded', not Playwright's 'load' default: heavy apps
      // (e.g. GIS maps) may never fire 'load' within the timeout even when the UI is
      // already interactive. Subsequent steps auto-wait for their own targets.
      const WAIT_UNTIL = ['commit', 'domcontentloaded', 'load', 'networkidle']
      const waitUntil = WAIT_UNTIL.indexOf(p.waitUntil) >= 0 ? p.waitUntil : 'domcontentloaded'
      const navTimeout = Number(p.navTimeout) > 0 ? Number(p.navTimeout) : 0
      const opts = navTimeout
        ? `{ waitUntil: '${waitUntil}', timeout: ${navTimeout} }`
        : `{ waitUntil: '${waitUntil}' }`
      // networkidle may never settle on live apps; use a lighter state to recover with.
      const settle = waitUntil === 'networkidle' ? 'domcontentloaded' : waitUntil
      // Skip if we're already on the EXACT target URL (continuous Run All carries the session
      // over, so a scenario's "Open the app" is a no-op there). Compare origin+path+search+hash
      // so an intentional navigation to a different ?query or #hash — how map/SPA apps route —
      // isn't silently swallowed; only a truly identical URL is skipped. Trailing '/' tolerated.
      // Tolerate the SPA aborting a redundant load (ERR_ABORTED) or redirecting to itself
      // ("interrupted by another navigation") — both mean we're effectively already there.
      return `const _target = ${url};
    const _samePage = (a, b) => {
      try {
        const x = new URL(a), y = new URL(b);
        return x.origin === y.origin && x.pathname.replace(/\\/+$/, '') === y.pathname.replace(/\\/+$/, '')
          && x.search === y.search && x.hash === y.hash;
      }
      catch (e) { return (a || '').replace(/\\/+$/, '') === (b || '').replace(/\\/+$/, ''); }
    };
    if (!_samePage(_target, page.url())) {
      try {
        await page.goto(_target, ${opts});
      } catch (_navErr) {
        if (!/ERR_ABORTED|interrupted by another navigation/i.test(_navErr.message || '')) throw _navErr;
        await page.waitForLoadState('${settle}').catch(() => {});
      }
    }`
    }

    case 'reload':
      return `await page.reload();`

    case 'goBack':
      return `await page.goBack();`

    case 'goForward':
      return `await page.goForward();`

    case 'waitForUrl':
      return `await page.waitForURL(${JSON.stringify(p.pattern)});`

    // --- Interaction ---
    case 'click': {
      const pre = p.waitBefore > 0 ? `await page.waitForTimeout(${Number(p.waitBefore)});\n    ` : ''
      // dispatch: fire the DOM click directly — works on stubborn JS toggles (Bootstrap
      // data-toggle) and elements that are hidden in a collapsed menu. force: skip the
      // visibility/stability actionability checks but still do a real mouse click.
      if (p.dispatch) return `${pre}await ${loc}.dispatchEvent('click');`
      return `${pre}await ${loc}.click(${p.force ? '{ force: true }' : ''});`
    }

    case 'dblclick': {
      const pre = p.waitBefore > 0 ? `await page.waitForTimeout(${Number(p.waitBefore)});\n    ` : ''
      if (p.dispatch) return `${pre}await ${loc}.dispatchEvent('dblclick');`
      return `${pre}await ${loc}.dblclick(${p.force ? '{ force: true }' : ''});`
    }

    case 'rightClick': {
      const pre = p.waitBefore > 0 ? `await page.waitForTimeout(${Number(p.waitBefore)});\n    ` : ''
      return `${pre}await ${loc}.click({ button: 'right'${p.force ? ', force: true' : ''} });`
    }

    case 'hover':
      return `await ${loc}.hover();`

    // These all go through `loc` (not page.<verb>(selector)) so the self-healing fallback chain
    // applies to typing/selecting too — a drifted selector on a Fill Input heals like a Click does.
    case 'focus':
      return `await ${loc}.focus();`

    case 'selectOption':
      return `await ${loc}.selectOption(${JSON.stringify(p.value)});`

    // setChecked is idempotent: only toggles if the box isn't already in the
    // desired state, then no-ops. Keeps the flow moving regardless of starting
    // state — no manual if/else needed.
    case 'setCheckbox': {
      const pre = p.waitBefore > 0 ? `await page.waitForTimeout(${Number(p.waitBefore)});\n    ` : ''
      return `${pre}await ${loc}.setChecked(${p.checked === false ? 'false' : 'true'});`
    }

    case 'fill':
      return `await ${loc}.fill(${JSON.stringify(p.value ?? '')});`

    case 'type':
      return `await ${loc}.type(${JSON.stringify(p.value ?? '')}, { delay: ${p.delay ?? 50} });`

    case 'clearInput':
      return `await ${loc}.fill('');`

    case 'pressKey':
      return `await ${loc}.press(${JSON.stringify(p.key)});`

    case 'uploadFile':
      // Routed through the smart _uploadFile helper: handles a hidden file input, the
      // read-only display box, a blank selector (lone file input), or a button that opens
      // the OS dialog — so a non-technical tester doesn't have to know which is which.
      return `await _uploadFile(${JSON.stringify(p.selector || '')}, ${JSON.stringify((p.trigger || '').trim())}, ${JSON.stringify(p.filePath)});`

    case 'dragAndDrop':
      return `await page.dragAndDrop(${JSON.stringify(p.source)}, ${JSON.stringify(p.target)});`

    // --- Mouse / Map (canvas-friendly low-level actions) ---
    case 'clickAt': {
      // Click an exact pixel — for a map canvas where there's no DOM element at a point.
      const x = Number(p.x) || 0, y = Number(p.y) || 0
      if (p.selector) return `await ${loc}.click({ position: { x: ${x}, y: ${y} } });`
      return `await page.mouse.click(${x}, ${y});`
    }

    case 'dragByOffset': {
      // Slide a draggable panel/handle by (dx, dy). We press the real drag HANDLE (jQuery
      // UI only starts a drag from its handle, not the panel body), move in DISCRETE paced
      // steps (a burst move is often dropped), and — if the panel didn't actually move —
      // fall back to synthetic DOM events that drive the library directly.
      const dx = Number(p.dx) || 0, dy = Number(p.dy) || 0
      return `{
      const _el = await ${loc}.elementHandle();
      if (!_el) throw new Error('Drag source not found: ' + ${sel});
      const _findRect = ${findDragHandleRect.toString()};
      const _r = await page.evaluate(_findRect, _el);
      const _before = await page.evaluate(_findRect, _el);
      const _sx = _r.x + _r.w / 2, _sy = _r.y + _r.h / 2, _N = 25;
      await page.mouse.move(_sx, _sy);
      await page.mouse.down();
      await page.waitForTimeout(80);
      for (let _i = 1; _i <= _N; _i++) {
        await page.mouse.move(_sx + (${dx}) * _i / _N, _sy + (${dy}) * _i / _N);
        await page.waitForTimeout(16);
      }
      await page.waitForTimeout(80);
      await page.mouse.up();
      const _after = await page.evaluate(_findRect, _el);
      if (Math.abs(_after.x - _before.x) < 3 && Math.abs(_after.y - _before.y) < 3) {
        await page.evaluate((${synthDrag.toString()}), { el: _el, dx: ${dx}, dy: ${dy} });
      }
    }`
    }

    case 'zoom': {
      // Position the cursor over the map, then wheel — negative deltaY zooms in.
      // Uses a low-level mouse.move to the element centre (not hover()) so an overlapping
      // draggable panel that "intercepts pointer events" can't make the step time out.
      const deltaY = Number(p.deltaY) || -100
      const times = Math.max(1, Number(p.times) || 1)
      const loop = `for (let _i = 0; _i < ${times}; _i++) { await page.mouse.wheel(0, ${deltaY}); await page.waitForTimeout(150); }`
      if (!p.selector) return loop
      return `{
      const _b = await ${loc}.boundingBox();
      if (_b) await page.mouse.move(_b.x + _b.width / 2, _b.y + _b.height / 2);
      ${loop}
    }`
    }

    case 'pinCoordinate': {
      // Ask the live OpenLayers map to project the exact lat/lng to its pixel, then click
      // that pixel for real (still exercises the app's click handler, just deterministically).
      const lat = Number(p.lat), lng = Number(p.lng)
      const zoom = (p.zoom === '' || p.zoom === null || p.zoom === undefined) ? 'null' : Number(p.zoom)
      const recenter = p.recenter !== false // default true; only an explicit uncheck disables it
      const mapVar = (p.mapVar || 'map').trim() || 'map'
      return `{
      const _r = await page.evaluate((${mapPickPixel.toString()}), { mapVar: ${JSON.stringify(mapVar)}, lon: ${lng}, lat: ${lat}, zoom: ${zoom}, recenter: ${recenter} });
      if (_r.error) throw new Error('Pin coordinate: ' + _r.error);
      if (!_r.inView) throw new Error('Pin coordinate: (${lng}, ${lat}) is off-screen' + (${recenter} ? ' even after recentering — try a lower zoom level' : ' — enable "Recenter" or navigate there first'));
      await page.mouse.click(_r.pageX, _r.pageY);
    }`
    }

    case 'mapZoom': {
      // Zoom via the OL view API → zooms about the centre, deterministic (not cursor-based).
      const zoom = (p.zoom === '' || p.zoom === null || p.zoom === undefined) ? 'null' : Number(p.zoom)
      const delta = (p.delta === '' || p.delta === null || p.delta === undefined) ? 'null' : Number(p.delta)
      const lon = (p.lng === '' || p.lng === null || p.lng === undefined) ? 'null' : Number(p.lng)
      const lat = (p.lat === '' || p.lat === null || p.lat === undefined) ? 'null' : Number(p.lat)
      const mapVar = (p.mapVar || 'map').trim() || 'map'
      return `{
      const _r = await page.evaluate((${mapSetZoom.toString()}), { mapVar: ${JSON.stringify(mapVar)}, zoom: ${zoom}, delta: ${delta}, lon: ${lon}, lat: ${lat} });
      if (_r.error) throw new Error('Map zoom: ' + _r.error);
    }`
    }

    // --- Assertions ---
    case 'assertVisible':
      return `await expect(page.locator(${sel})).toBeVisible();`

    case 'assertHidden':
      return `await expect(page.locator(${sel})).toBeHidden();`

    case 'assertText': {
      // Optional per-step max wait — the assert polls (and latches on first match), so a longer
      // window lets it span a slow async chain AND catch a transient toast within its brief life.
      const opt = Number(p.timeout) > 0 ? `, { timeout: ${Number(p.timeout)} }` : ''
      return p.exact
        ? `await expect(page.locator(${sel})).toHaveText(${JSON.stringify(p.text)}${opt});`
        : `await expect(page.locator(${sel})).toContainText(${JSON.stringify(p.text)}${opt});`
    }

    case 'assertValue':
      return `await expect(page.locator(${sel})).toHaveValue(${JSON.stringify(p.value)});`

    case 'assertUrl':
      return `await expect(page).toHaveURL(${JSON.stringify(p.pattern)});`

    case 'assertTitle':
      return `await expect(page).toHaveTitle(${JSON.stringify(p.pattern)});`

    case 'assertEnabled':
      return p.enabled === false
        ? `await expect(page.locator(${sel})).toBeDisabled();`
        : `await expect(page.locator(${sel})).toBeEnabled();`

    case 'assertChecked':
      return p.checked === false
        ? `await expect(page.locator(${sel})).not.toBeChecked();`
        : `await expect(page.locator(${sel})).toBeChecked();`

    // Did the service call behind a map layer actually succeed? A WMS server answers a broken
    // GetMap with HTTP 200 and a ServiceExceptionReport XML body, so the status code alone reads
    // green while nothing draws — the CONTENT-TYPE is what separates a real tile from a silent
    // failure. Reads the network log every prior step has been filling (see _take).
    case 'assertRequest': {
      const pat = JSON.stringify(String(p.urlContains || '').trim())
      const min = Number(p.minCount) > 0 ? Number(p.minCount) : 1
      const want = p.expect || 'image'
      const okExpr = want === 'any' ? 'true' : want === 'json' ? '/json/i.test(r.ctype)' : '/^image\\//i.test(r.ctype)'
      // Drain first: the layer's calls belong to an EARLIER step, and a tile can still be in
      // flight when this step starts.
      return `await _settle(3000);
    await Promise.allSettled(_pending);
    {
      // Only calls made SINCE the last check of this kind — marking them consumed keeps a
      // scenario's failure from re-failing every later assert in the run.
      const _rows = _netlog.filter((r) => !r._seen && r.url.includes(${pat}));
      _rows.forEach((r) => { r._seen = true; });
      const _bad = _rows.filter((r) => !r.ok || !(${okExpr}));
      if (_rows.length < ${min}) throw new Error('No matching request — nothing called a URL containing ' + ${pat} + ' (found ' + _rows.length + ', expected at least ${min}). Check the URL fragment, or that an earlier step actually triggers the call.');
      if (_bad.length) {
        // Recover the server's reason. Chromium throws away the body of a response the renderer
        // rejected, so a WMS exception delivered to an <img> reads empty — one re-fetch (only ever
        // on the failing path, reusing the run's cookies) turns "HTTP 200 text/xml" into the
        // actual "Layer not defined" / "token expired" a tester can act on.
        let _why = _bad[0].body;
        if (!_why && _bad[0]._raw) { try { _why = await (await context.request.get(_bad[0]._raw)).text(); } catch { /* reason unavailable */ } }
        throw new Error(_bad.length + ' of ' + _rows.length + ' matching requests failed — HTTP ' + _bad[0].status + ' ' + (_bad[0].ctype || 'no content-type') + ' :: ' + _bad[0].url + (_why ? '\\n' + _why.trim().slice(0, 300) : ''));
      }
    }`
    }

    // --- Waits ---
    case 'waitForSelector':
      return `await page.waitForSelector(${sel}, { state: ${JSON.stringify(p.state || 'visible')} });`

    case 'waitForTimeout':
      return `await page.waitForTimeout(${Number(p.ms) || 1000});`

    case 'waitForNetworkIdle':
      return `await page.waitForLoadState('networkidle');`

    // --- Util ---
    case 'screenshot':
      return `await page.screenshot({ path: ${JSON.stringify(p.path || 'screenshot.png')}, fullPage: ${p.fullPage === true} });`

    case 'executeScript':
      // Run the user's JS inside the PAGE context only — pass it as data (JSON.stringify)
      // so it can never break out into the Node runner. eval keeps the expression behaviour
      // of the old raw interpolation; if it evaluates to a function (e.g. `() => ...`) we call it.
      return `await page.evaluate((__s) => { const __r = eval(__s); return typeof __r === 'function' ? __r() : __r; }, ${JSON.stringify(p.script ?? '')});`

    // --- Variables ---
    case 'captureValue': {
      // Read something off the page NOW and stash it as {{var.name}} for later steps — the
      // copy/paste a tester does by hand (order number, generated ID, computed total).
      const name = JSON.stringify(String(p.name || '').trim() || 'value')
      const from = p.from || 'text'
      const expr =
        from === 'value'     ? `await ${loc}.inputValue()`
      : from === 'attribute' ? `await ${loc}.getAttribute(${JSON.stringify(p.attr || 'value')})`
      : from === 'url'       ? `page.url()`
      : from === 'js'        ? `await page.evaluate((__s) => { const __r = eval(__s); return typeof __r === 'function' ? __r() : __r; }, ${JSON.stringify(p.script ?? '')})`
      :                        `await ${loc}.innerText()`
      // Trimmed: UI text arrives with layout whitespace, and a value with a stray \\n breaks the
      // next step's fill/compare in a way that's very hard to see in a log.
      return `__vars[${name}] = String((${expr}) ?? '').trim();
    process.stdout.write(JSON.stringify({ type: 'capture', name: ${name}, value: __vars[${name}] }) + '\\n');`
    }

    case 'runScript':
      // ADVANCED escape hatch: the tester's own Playwright code, inlined verbatim into this
      // script — `page`, `context`, `expect` and `vars` are in scope, and the step's try/catch
      // reports pass/fail like any other. Unlike executeScript (page context, sandboxed) this
      // runs in the RUNNER, on purpose: it's the only way to reach downloads, extra tabs,
      // context.request, etc. A syntax error here breaks the whole generated script — that's the
      // trade for not wrapping it in eval, which would cost the debuggable stack trace.
      return `{
      const vars = __vars;
${indent(String(p.code || '').replace(/\r\n/g, '\n'), 6)}
    }`

    // --- Notes ---
    case 'comment':
      // Author note — collapse newlines so it stays a single // comment line.
      return `// 📝 ${String(p.text || '').replace(/\r?\n/g, ' ')}`

    default:
      return `// Unknown action: ${action}`
  }
}

function indent(str, spaces) {
  const pad = ' '.repeat(spaces)
  return str.split('\n').map(l => (l.trim() ? pad + l : l)).join('\n')
}
