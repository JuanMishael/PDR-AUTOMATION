// Self-check for uiDump.parseUiDump. Run: node scripts/test-ui-dump.mjs
import assert from 'node:assert'
import { parseUiDump } from '../src/main/core/uiDump.js'

const xml = `<?xml version='1.0'?><hierarchy rotation="0">
<node class="android.widget.FrameLayout" resource-id="app:id/card" text="" content-desc="" clickable="false">
  <node class="android.widget.EditText" resource-id="app:id/edtUsername" text="" content-desc="" clickable="true"/>
  <node class="android.widget.Button" resource-id="app:id/btnLogin" text="Login" content-desc="" clickable="true"/>
  <node class="android.widget.ImageButton" resource-id="" text="" content-desc="Show password" clickable="true"/>
  <node class="android.widget.TextView" resource-id="" text="V 1.9.5" content-desc="" clickable="false"/>
  <node class="android.view.View" resource-id="" text="" content-desc="" clickable="false"/>
</node></hierarchy>`

const els = parseUiDump(xml)
const by = t => els.find(e => e.label === t || e.locator === t)

// The empty container and the empty View are excluded (no locator / nothing to target).
assert.equal(els.length, 4, `expected 4 pickable, got ${els.length}: ${JSON.stringify(els.map(e => e.label))}`)

// resource-id wins → strategy 'id'
assert.deepEqual(by('app:id/edtUsername') && { s: by('app:id/edtUsername').strategy, e: by('app:id/edtUsername').editable },
  { s: 'id', e: true })
// clickable button with text: label from text, strategy id
const login = by('Login'); assert.equal(login.strategy, 'id'); assert.equal(login.clickable, true)
// no id but content-desc → accessibility id
const show = by('Show password'); assert.equal(show.strategy, 'accessibility id'); assert.equal(show.locator, 'Show password')
// no id, no desc, has text → text strategy
const ver = by('V 1.9.5'); assert.equal(ver.strategy, 'text'); assert.equal(ver.locator, 'V 1.9.5')

console.log('✅ parseUiDump checks passed —', els.length, 'elements')
