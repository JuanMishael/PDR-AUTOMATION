// Self-check for nativeRunner's pure locator logic. Run: node scripts/test-native-helpers.mjs
import assert from 'node:assert'
import { locatorFor, xpathLiteral } from '../src/main/core/nativeRunner.js'

// strategy mapping
assert.deepEqual(locatorFor('id', 'com.app:id/x'), { using: 'id', value: 'com.app:id/x' })
assert.deepEqual(locatorFor('uiautomator', 'new UiSelector()'), { using: '-android uiautomator', value: 'new UiSelector()' })
assert.deepEqual(locatorFor('whatever', 'Search'), { using: 'accessibility id', value: 'Search' }) // default

// 'text' convenience builds an exact-text xpath with correct quoting
assert.equal(locatorFor('text', 'Wi-Fi').value, `//*[@text="Wi-Fi"]`)
assert.equal(locatorFor('text', `O'Brien`).value, `//*[@text="O'Brien"]`)   // has ' -> wrap in "

// xpathLiteral: the tricky both-quotes branch -> concat()
assert.equal(xpathLiteral('plain'), '"plain"')
assert.equal(xpathLiteral(`it's`), `"it's"`)
assert.equal(xpathLiteral('say "hi"'), `'say "hi"'`)
const both = xpathLiteral(`a"b'c`)
assert.ok(both.startsWith('concat('), 'both-quotes must use concat()')

console.log('✅ native helper checks passed')
