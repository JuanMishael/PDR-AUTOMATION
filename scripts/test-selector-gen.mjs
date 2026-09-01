// The selector generator must reach rungs 2-3 of docs/SELECTOR-RECIPES.md (meaningful attribute,
// inline onclick) before falling back to a class combo. Fixture is the real Advanced Search panel
// markup: an icon-only close button with no id, no name, no text — the case that used to produce
// `button.btn.pull-right.col-lg-2.glyphicon.glyphicon-remove`, a chain every panel shares.
// Run: node scripts/test-selector-gen.mjs
import assert from 'node:assert'
import { chromium } from 'playwright'
import { bundleCore } from './bundle-core.mjs'

const { installSelectorGen } = await bundleCore(['injectedScripts.js'])

// Two panels with IDENTICAL close-button classes — the reason the class combo never resolved.
const html = `<!doctype html><title>Panels</title>
<div id="myleft_slide"><div class="panel panel-default">
  <button class="btn pull-right col-lg-2 glyphicon glyphicon-remove" onclick="closeLeft()" style="right:3px"></button>
  <div class="panel-heading"><center>Advanced Search</center></div>
  <button type="submit" id="btnFilterSearch" title="Add Filter" onclick="GET_SEARCH(),SESSION()" class="btn btn-default"><i class="fa fa-plus"></i></button>
  <button type="submit" title="Clear" onclick="CLEAR_SEARCH_ADVANCE(),SESSION()" class="btn btn-default"><i class="fa fa-eraser"></i></button>
  <input type="text" class="form-control" placeholder="Search for...">
  <button class="btn btn-default">Save</button>
</div></div>
<div id="myright_slide"><div class="panel panel-default">
  <button class="btn pull-right col-lg-2 glyphicon glyphicon-remove" onclick="closeRight()"></button>
</div></div>`

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.setContent(html)
await page.evaluate(installSelectorGen)

const gen = (sel) => page.evaluate((s) => window.__genSelector(document.querySelector(s)), sel)
const kinds = (sel) => page.evaluate((s) => window.__genCandidates(document.querySelector(s)).map(c => c.kind + ':' + c.selector), sel)

// The close button: no id, no name, no text — must land on the handler, not the class soup.
assert.equal(await gen('#myleft_slide button.glyphicon-remove'), 'button[onclick^="closeLeft"]')
assert.equal(await gen('#myright_slide button.glyphicon-remove'), 'button[onclick^="closeRight"]')
// title beats onclick when present (recipe rung 2 above rung 3), and an id still beats both.
assert.equal(await gen('button[title="Clear"]'), 'button[title="Clear"]')
assert.equal(await gen('#btnFilterSearch'), '#btnFilterSearch')
// A text label still wins for a normal button, and a placeholder rescues a bare input.
assert.equal(await gen('button.btn-default:not([title]):not([id])'), 'button:text-is("Save")')
assert.equal(await gen('input'), 'input[placeholder="Search for..."]')

// The Pick chooser must offer the attribute candidates too, ranked above structural paths.
const c = await kinds('#myleft_slide button.glyphicon-remove')
assert.ok(c.some(x => x === 'attr:button[onclick^="closeLeft"]'), `no attr candidate: ${c.join(', ')}`)
// ★ recommended is the first unique candidate — it must be a hook on the BUTTON, never the
// panel that contains it (clicking a container does nothing, and the step still passes).
assert.ok(c[0] === 'attr:button[onclick^="closeLeft"]', `wrong ★ recommendation: ${c.join(', ')}`)
 assert.ok(c.findIndex(x => x.startsWith('attr:')) < c.findIndex(x => x.startsWith('scoped-structural:')),
  `attributes must outrank a positional path: ${c.join(', ')}`)

await browser.close()
console.log('ok — selector gen (attribute + onclick rungs)')
