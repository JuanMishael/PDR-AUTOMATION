// Proves the steps.params repair in db.js. Two stages of one bug: an older build stringified a
// params value that was ALREADY the raw JSON string from the DB (so one parse returned a string
// and every param read as undefined — blank selector on the card, and the step ran with none),
// and editing a param on such a card then spread that string into character keys.
// Runs the migration body straight out of db.js so the test can't drift from the source.
// Run: node scripts/test-params-repair.mjs
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const initSqlJs = require(resolve(root, 'node_modules/sql.js/dist/sql-wasm.js'))

const src = readFileSync(resolve(root, 'src/main/core/db.js'), 'utf8')
const body = src.split('// Repair steps.params mangled')[1].split('// --- migrations')[0]
const repair = new Function('_db', 'persist', 'try {' + body.split('try {').slice(1).join('try {'))

const SQL = await initSqlJs({ locateFile: f => resolve(root, 'node_modules/sql.js/dist/', f) })
const db = new SQL.Database()
db.run('CREATE TABLE steps (id TEXT PRIMARY KEY, params TEXT)')

const good = '{"selector":"#advSearch","value":"makati"}'
const spread = JSON.stringify({ ...good, selector: '#retyped' })   // stage 2, as the card produced it

db.run('INSERT INTO steps VALUES (?,?)', ['healthy', good])
db.run('INSERT INTO steps VALUES (?,?)', ['encoded', JSON.stringify(good)])
db.run('INSERT INTO steps VALUES (?,?)', ['twice', JSON.stringify(JSON.stringify(good))])
db.run('INSERT INTO steps VALUES (?,?)', ['spread', spread])

let persisted = 0
repair(db, () => persisted++)
const rows = Object.fromEntries(db.exec('SELECT id, params FROM steps')[0].values)
const p = id => JSON.parse(rows[id])

for (const id of ['healthy', 'encoded', 'twice', 'spread']) {
  assert.strictEqual(typeof p(id), 'object', `${id}: params still parse to a ${typeof p(id)}`)
  assert.strictEqual(p(id).value, 'makati', `${id}: lost its recorded value`)
}
assert.strictEqual(p('encoded').selector, '#advSearch')
assert.strictEqual(p('twice').selector, '#advSearch')
assert.strictEqual(p('spread').selector, '#retyped', 'an edit made while broken must win')
assert.ok(!Object.keys(p('spread')).some(k => /^\d+$/.test(k)), 'character keys must be gone')
assert.strictEqual(rows.healthy, good, 'a healthy row must not be rewritten')
assert.strictEqual(persisted, 1, 'one persist for the whole repair pass')
console.log('params repair ok — encoded / twice / spread recovered, healthy row untouched')
