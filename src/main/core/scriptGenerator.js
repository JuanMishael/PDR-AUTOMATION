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

export function generateScript({ profile, scenarios = [], settings = {}, outputDir = '' }) {
  const timeout = profile.timeout || 30000
  const baseUrl = profile.base_url || ''
  const traceOnFail = settings.trace_on_fail === '1'
  const screenshotOnFail = settings.screenshot_on_fail === '1'

  // One browser session for the whole run. Scenarios execute in order, carrying state
  // (cookies, login, created records) from one to the next — a "scenario" marker is
  // emitted before each so the live log and results can attribute steps.
  let globalIndex = 0
  const blocks = []
  for (const sc of scenarios) {
    blocks.push(`process.stdout.write(JSON.stringify({ type: 'scenario', name: ${JSON.stringify(sc.name || 'Scenario')} }) + '\\n');`)
    const orderedSteps = [...(sc.steps || [])].sort((a, b) => a.sort_order - b.sort_order)
    for (const step of orderedSteps) {
      blocks.push(generateStep(step, globalIndex, baseUrl, { screenshotOnFail, outputDir }))
      globalIndex++
    }
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

  return `
const { chromium, firefox, webkit } = require('playwright');
const { expect } = require('playwright/test');

(async () => {
  const results = [];
  let browser, context, page;

  try {
    browser = await ${browserLaunchExpr(profile)}
    context = await browser.newContext({ ignoreHTTPSErrors: true });
    page = await context.newPage();
    page.setDefaultTimeout(${timeout});
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

function generateStep(step, index, baseUrl, { screenshotOnFail = false, outputDir = '' } = {}) {
  const p = typeof step.params === 'string' ? JSON.parse(step.params) : step.params
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
    case 'navigate':
      return `await page.goto(${url});`

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
      return `${pre}await ${loc}.click();`
    }

    case 'dblclick': {
      const pre = p.waitBefore > 0 ? `await page.waitForTimeout(${Number(p.waitBefore)});\n    ` : ''
      return `${pre}await ${loc}.dblclick();`
    }

    case 'rightClick': {
      const pre = p.waitBefore > 0 ? `await page.waitForTimeout(${Number(p.waitBefore)});\n    ` : ''
      return `${pre}await ${loc}.click({ button: 'right' });`
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
      return `await page.setInputFiles(${sel}, ${JSON.stringify(p.filePath)});`

    case 'dragAndDrop':
      return `await page.dragAndDrop(${JSON.stringify(p.source)}, ${JSON.stringify(p.target)});`

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
      return `await page.evaluate(${p.script});`

    default:
      return `// Unknown action: ${action}`
  }
}

function indent(str, spaces) {
  const pad = ' '.repeat(spaces)
  return str.split('\n').map(l => (l.trim() ? pad + l : l)).join('\n')
}
