// Share must carry the test data an If-condition reads. params.cond is NESTED, and the export scan /
// import rewrite used to walk top-level params only — so {{Users.name}} inside a condition neither
// pulled the Users collection into the bundle nor got renamed when the collection did on import.
// Run: node scripts/test-share-cond.mjs
import assert from 'node:assert'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { bundleCore } from './bundle-core.mjs'

rmSync(join(tmpdir(), 'pdr-test-userData'), { recursive: true, force: true })
const { initDb, getDb, serializeProfile, deserializeProfile } = await bundleCore(['db.js', 'portability.js'])
await initDb()
const db = getDb()

const cid = randomUUID()
db.prepare('INSERT INTO data_collections (id, name, description) VALUES (?, ?, ?)').run(cid, 'Users', '')
db.prepare('INSERT INTO data_fields (id, collection_id, name, type, default_token, selector, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run(randomUUID(), cid, 'name', 'text', '', '', 0)
const pid = randomUUID(), sid = randomUUID()
db.prepare("INSERT INTO profiles (id, name, base_url) VALUES (?, 'P', '')").run(pid)
db.prepare("INSERT INTO scenarios (id, profile_id, name) VALUES (?, ?, 'S')").run(sid, pid)
db.prepare("INSERT INTO steps (id, scenario_id, action, params) VALUES (?, ?, 'ifStart', ?)")
  .run(randomUUID(), sid, JSON.stringify({ cond: { type: 'text', selector: '#who', expected: '{{Users.name}}' } }))

const bundle = serializeProfile(db, pid)
assert.deepEqual(bundle.collections.map(c => c.name), ['Users'], 'a collection used only inside an If-condition must be bundled')

// Rename the local copy so import reuses it under a different name — the cond token must follow.
db.prepare("UPDATE data_collections SET name = 'Users_old' WHERE id = ?").run(cid)
const { profileId } = deserializeProfile(db, bundle, null)
const [st] = db.prepare('SELECT s.params FROM steps s JOIN scenarios c ON c.id = s.scenario_id WHERE c.profile_id = ?').all(profileId)
assert.equal(JSON.parse(st.params).cond.expected, '{{Users_old.name}}', 'nested cond token must be rewritten on import')

console.log('ok — share carries If-condition test data')
