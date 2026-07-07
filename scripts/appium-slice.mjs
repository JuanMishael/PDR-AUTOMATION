// Throwaway probe: does this machine actually drive the phone via Appium?
// Launches Settings, reads the native UI tree, screenshots it, sends Back, closes.
// ponytail: raw fetch against Appium's W3C REST endpoint — no webdriverio dep for a one-off probe.
// If we build the real native engine, swap this for a proper client then.
//
// Run:  1) adb devices   (phone must show 'device', not 'unauthorized')
//       2) npx appium    (in another terminal — starts server on 127.0.0.1:4723)
//       3) node scripts/appium-slice.mjs
import { writeFileSync } from 'node:fs'
import assert from 'node:assert'

const BASE = 'http://127.0.0.1:4723'

async function req(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  const json = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(json)}`)
  return json.value
}

const caps = {
  capabilities: {
    alwaysMatch: {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:appPackage': 'com.android.settings',
      'appium:appActivity': '.Settings',
      'appium:noReset': true,
      'appium:newCommandTimeout': 120,
      // Some OEM ROMs (MIUI/ColorOS/etc.) deny shell WRITE_SECURE_SETTINGS, so the driver
      // can't tweak hidden_api_policy. This tells it to shrug that off instead of failing.
      'appium:ignoreHiddenApiPolicyError': true
    },
    firstMatch: [{}]
  }
}

let sessionId
try {
  console.log('→ creating session (Settings should open on your phone)...')
  const session = await req('POST', '/session', caps)
  sessionId = session.sessionId
  assert(sessionId, 'no sessionId returned')
  console.log('  session:', sessionId)

  const source = await req('GET', `/session/${sessionId}/source`)
  const nodeCount = (source.match(/</g) || []).length
  assert(source.includes('hierarchy'), 'source is not a native UI hierarchy')
  console.log(`→ read native UI tree: ${nodeCount} nodes`)

  const b64 = await req('GET', `/session/${sessionId}/screenshot`)
  const png = Buffer.from(b64, 'base64')
  assert(png.length > 1000, 'screenshot suspiciously small')
  const out = new URL('./appium-slice.png', import.meta.url).pathname.replace(/^\//, '')
  writeFileSync(out, png)
  console.log(`→ screenshot saved: ${out} (${png.length} bytes)`)

  await req('POST', `/session/${sessionId}/appium/device/press_keycode`, { keycode: 4 }) // BACK
  console.log('→ sent BACK keypress — input works')

  console.log('\n✅ SLICE PASSED — the machine can drive your phone.')
} catch (e) {
  console.error('\n❌ SLICE FAILED:', e.message)
  process.exitCode = 1
} finally {
  if (sessionId) await req('DELETE', `/session/${sessionId}`).catch(() => {})
}
