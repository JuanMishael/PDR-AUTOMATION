// Smoke test for WSDL re-sync: re-importing a service must update the SAME request rows (so the
// data, extracts and assertions hooked to them survive), refresh only untouched envelopes, and
// report — never silently drop — operations that disappeared.
// Run: node scripts/test-wsdl-sync.mjs
import assert from 'node:assert'
import { bundleCore } from './bundle-core.mjs'

const { planWsdlSync } = await bundleCore(['wsdlImport.js'])

const OLD_ENV = '<Envelope><GetOrder><id>?</id></GetOrder></Envelope>'
const NEW_ENV = '<Envelope><GetOrder><id>?</id><branch>?</branch></GetOrder></Envelope>'
const NEW_URL = 'https://v2.example.com/Order.svc'

// The collection as it stands: one envelope filled in by hand, one still pristine, one legacy row
// imported before wsdl_envelope existed, and one operation the new WSDL no longer has.
const existing = [
  { id: 'r1', name: 'GetOrder', body: '<Envelope><GetOrder><id>42</id></GetOrder></Envelope>', wsdl_envelope: OLD_ENV },
  { id: 'r2', name: 'CancelOrder', body: OLD_ENV, wsdl_envelope: OLD_ENV },
  { id: 'r3', name: 'LegacyOp', body: '<hand-written/>', wsdl_envelope: '' },
  { id: 'r4', name: 'RetiredOp', body: OLD_ENV, wsdl_envelope: OLD_ENV }
]
const operations = [
  { name: 'GetOrder', soapAction: 'urn:GetOrder', envelope: NEW_ENV },
  { name: 'CancelOrder', soapAction: 'urn:CancelOrder', envelope: NEW_ENV },
  { name: 'LegacyOp', soapAction: 'urn:LegacyOp', envelope: NEW_ENV },
  { name: 'ShipOrder', soapAction: 'urn:ShipOrder', envelope: NEW_ENV }   // brand new
]

const { inserts, updates, removed } = planWsdlSync(existing, operations, NEW_URL)
const by = Object.fromEntries(updates.map(u => [u.name, u]))

// Only the genuinely new operation is inserted — the rest keep their row id, which is the whole
// point: anything attached to that request (test data, extracts, assertions) stays attached.
assert.deepStrictEqual(inserts.map(o => o.name), ['ShipOrder'])
assert.deepStrictEqual(updates.map(u => u.id).sort(), ['r1', 'r2', 'r3'])

// Every matched request follows the new service, edited or not.
for (const u of updates) assert.strictEqual(u.url, NEW_URL)
assert.strictEqual(by.GetOrder.soapAction, 'urn:GetOrder')

// Untouched scaffold → regenerated. Edited body → kept verbatim, flagged for review.
assert.strictEqual(by.CancelOrder.body, NEW_ENV)
assert.strictEqual(by.CancelOrder.refreshed, true)
assert.strictEqual(by.GetOrder.body, existing[0].body)
assert.strictEqual(by.GetOrder.review, true)

// A row from before re-sync existed has no stored scaffold — treat it as edited, never clobber it.
assert.strictEqual(by.LegacyOp.body, '<hand-written/>')
assert.strictEqual(by.LegacyOp.refreshed, false)

// Gone from the WSDL: reported, not deleted (it isn't in inserts/updates, and nothing removes it).
assert.deepStrictEqual(removed, ['RetiredOp'])

// A no-op re-sync of an unchanged service must not report anything as changed.
const same = planWsdlSync(
  [{ id: 'r2', name: 'CancelOrder', body: OLD_ENV, wsdl_envelope: OLD_ENV }],
  [{ name: 'CancelOrder', soapAction: 'urn:CancelOrder', envelope: OLD_ENV }], NEW_URL)
assert.deepStrictEqual(same.inserts, [])
assert.deepStrictEqual(same.removed, [])
assert.strictEqual(same.updates[0].review, false)

console.log('✓ wsdl re-sync: 1 new, 1 refreshed, 1 kept-for-review, 1 legacy untouched, 1 retired reported')
