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

export function generateScript({ profile, scenario, steps }) {
  const timeout = profile.timeout || 30000
  const baseUrl = profile.base_url || ''

  const stepBlocks = steps
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((step, i) => generateStep(step, i, baseUrl))
    .join('\n\n')

  return `
const { chromium, firefox, webkit } = require('playwright');

(async () => {
  const results = [];
  let browser, page;

  try {
    browser = await ${browserLaunchExpr(profile)}
    const context = await browser.newContext();
    page = await context.newPage();
    page.setDefaultTimeout(${timeout});

${indent(stepBlocks, 4)}

  } catch (err) {
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

function generateStep(step, index, baseUrl) {
  const p = typeof step.params === 'string' ? JSON.parse(step.params) : step.params
  const label = step.label || `${step.action} #${index + 1}`
  const stepId = step.id

  const body = actionToCode(step.action, p, baseUrl)

  return `
  // Step ${index + 1}: ${label}
  try {
    ${body}
    results.push({ id: ${JSON.stringify(stepId)}, label: ${JSON.stringify(label)}, status: 'passed' });
    process.stdout.write(JSON.stringify({ type: 'step', id: ${JSON.stringify(stepId)}, label: ${JSON.stringify(label)}, status: 'passed' }) + '\\n');
  } catch (_err) {
    results.push({ id: ${JSON.stringify(stepId)}, label: ${JSON.stringify(label)}, status: 'failed', error: _err.message });
    process.stdout.write(JSON.stringify({ type: 'step', id: ${JSON.stringify(stepId)}, label: ${JSON.stringify(label)}, status: 'failed', error: _err.message }) + '\\n');
    throw _err;
  }`.trim()
}

function actionToCode(action, p, baseUrl) {
  const sel = p.selector ? JSON.stringify(p.selector) : 'null'
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
    case 'click':
      return `await page.click(${sel});`

    case 'dblclick':
      return `await page.dblclick(${sel});`

    case 'rightClick':
      return `await page.click(${sel}, { button: 'right' });`

    case 'hover':
      return `await page.hover(${sel});`

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
      return `await page.press(${sel ?? "'body'"}, ${JSON.stringify(p.key)});`

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
