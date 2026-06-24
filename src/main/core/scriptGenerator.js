/**
 * Generates a self-contained Playwright script as a JS string at runtime.
 * No .js files are written to disk. The script is passed directly to the runner.
 *
 * Action types (28 total):
 * Navigation  : navigate, reload, goBack, goForward, waitForUrl
 * Interaction : click, dblclick, rightClick, hover, focus, selectOption,
 *               fill, type, clearInput, pressKey, uploadFile, dragAndDrop
 * Assertions  : assertVisible, assertHidden, assertText, assertValue,
 *               assertUrl, assertTitle, assertEnabled, assertChecked
 * Waits       : waitForSelector, waitForTimeout, waitForNetworkIdle
 * Util        : screenshot, executeScript
 */

import { resolveParams } from './tokenResolver'
import { findDragHandleRect, synthDrag } from './dragHelpers'

export function generateScript({ profile, scenarios = [], settings = {}, outputDir = '', dataContext = null, downloadsDir = '' }) {
  const timeout = profile.timeout || 30000
  const baseUrl = profile.base_url || ''
  const traceOnFail = settings.trace_on_fail === '1'
  const screenshotOnFail = settings.screenshot_on_fail === '1'

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
  const blocks = []
  for (const sc of scenarios) {
    // Group/loop markers are expanded away in the runner; drop any that slip through.
    const MARKERS = ['groupStart', 'groupEnd', 'loopStart', 'loopEnd']
    const orderedSteps = [...(sc.steps || [])]
      .filter(s => !MARKERS.includes(s.action))
      .sort((a, b) => a.sort_order - b.sort_order)
    const stepCode = orderedSteps.map(step => {
      const code = generateStep(step, globalIndex, baseUrl, { screenshotOnFail, outputDir, dataContext })
      globalIndex++
      return code
    }).join('\n\n')
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

  try {
    browser = await ${browserLaunchExpr(profile)}
    context = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true });
    page = await context.newPage();
    page.setDefaultTimeout(${timeout});
    ${downloadHandler}
    ${traceStart}

${indent(stepBlocks, 4)}

  } catch (err) {
    ${traceStop}
    process.stderr.write(JSON.stringify({ type: 'fatal', message: err.message }) + '\\n');
    process.exit(1);
  } finally {
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

function generateStep(step, index, baseUrl, { screenshotOnFail = false, outputDir = '', dataContext = null } = {}) {
  const rawParams = typeof step.params === 'string' ? JSON.parse(step.params) : step.params
  // Resolve {{Collection.field}} / {{faker.*}} / {{unique.*}} to concrete values now, so the
  // emitted script stays plain JS with no runtime data dependency.
  const p = dataContext ? resolveParams(rawParams, dataContext) : rawParams
  const label = step.label || `${step.action} #${index + 1}`
  const stepId = step.id
  const perStepScreenshot = !!p._screenshot

  const body = actionToCode(step.action, p, baseUrl)

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
  if (p.selector2 && p.selector2.trim()) {
    return `page.locator(${sel}).or(page.locator(${JSON.stringify(p.selector2.trim())})).first()`
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
      // Skip if we're already on the target page (continuous Run All carries the session
      // over, so a scenario's "Open the app" is a no-op there). Compare by origin+path so
      // a post-login #hash or ?query doesn't defeat the skip. Tolerate the SPA aborting a
      // redundant load (ERR_ABORTED) or redirecting to itself ("interrupted by another
      // navigation") — both mean we're effectively already there.
      return `const _target = ${url};
    const _samePage = (a, b) => {
      try { const x = new URL(a), y = new URL(b); return x.origin === y.origin && x.pathname.replace(/\\/+$/, '') === y.pathname.replace(/\\/+$/, ''); }
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

    case 'focus':
      return `await page.focus(${sel});`

    case 'selectOption':
      return `await page.selectOption(${sel}, ${JSON.stringify(p.value)});`

    case 'fill':
      return `await page.fill(${sel}, ${JSON.stringify(p.value ?? '')});`

    case 'type':
      return `await page.type(${sel}, ${JSON.stringify(p.value ?? '')}, { delay: ${p.delay ?? 50} });`

    case 'clearInput':
      return `await page.fill(${sel}, '');`

    case 'pressKey':
      return `await page.press(${sel}, ${JSON.stringify(p.key)});`

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

    // --- Assertions ---
    case 'assertVisible':
      return `await expect(page.locator(${sel})).toBeVisible();`

    case 'assertHidden':
      return `await expect(page.locator(${sel})).toBeHidden();`

    case 'assertText':
      return p.exact
        ? `await expect(page.locator(${sel})).toHaveText(${JSON.stringify(p.text)});`
        : `await expect(page.locator(${sel})).toContainText(${JSON.stringify(p.text)});`

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
