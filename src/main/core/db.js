import { app } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'

let _db       // sql.js Database instance
let _dbPath   // path to the .db file on disk
let _inTx = false  // suppress mid-transaction persists

// Persistence is debounced: sql.js has no incremental write — every save serializes the
// WHOLE database. Writing synchronously on each run() froze the UI during live recording
// (one full rewrite per captured step). We coalesce bursts into a single write, and always
// flush on app quit (see flushDb) so nothing is lost.
const FLUSH_DELAY_MS = 200
let _dirty = false
let _flushTimer = null

function writeNow() {
  _flushTimer = null
  if (!_dirty || !_db) return
  _dirty = false
  writeFileSync(_dbPath, Buffer.from(_db.export()))
}

function persist() {
  if (_inTx) return
  _dirty = true
  if (!_flushTimer) _flushTimer = setTimeout(writeNow, FLUSH_DELAY_MS)
}

// Synchronous flush of any pending write — call before the app exits.
export function flushDb() {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null }
  writeNow()
}

// ---------------------------------------------------------------------------
// better-sqlite3-compatible shim
// sql.js frees a statement after stmt.run() — so we re-prepare on every call.
// ---------------------------------------------------------------------------
function makeProxy(sql) {
  return {
    run(...params) {
      const s = _db.prepare(sql)
      s.run(params)
      s.free()
      persist()
      return {}
    },
    get(...params) {
      const s = _db.prepare(sql)
      s.bind(params)
      const row = s.step() ? s.getAsObject() : undefined
      s.free()
      return row
    },
    all(...params) {
      const s = _db.prepare(sql)
      s.bind(params)
      const rows = []
      while (s.step()) rows.push(s.getAsObject())
      s.free()
      return rows
    }
  }
}

export function getDb() {
  return {
    exec(sql) {
      _db.run(sql)
      persist()
    },
    prepare(sql) {
      return makeProxy(sql)
    },
    pragma(_str) { /* handled at init */ },
    transaction(fn) {
      return (...args) => {
        _db.run('BEGIN')
        _inTx = true
        try {
          fn(...args)
          _db.run('COMMIT')
        } catch (err) {
          _db.run('ROLLBACK')
          throw err
        } finally {
          _inTx = false
          persist()
        }
      }
    }
  }
}

export async function initDb() {
  const dataDir = join(app.getPath('userData'), 'pdr-automation-data')
  mkdirSync(dataDir, { recursive: true })
  _dbPath = join(dataDir, 'pdr-automation.db')

  const initSqlJs = (await import('sql.js')).default
  const SQL = await initSqlJs()

  _db = existsSync(_dbPath)
    ? new SQL.Database(readFileSync(_dbPath))
    : new SQL.Database()

  _db.run('PRAGMA foreign_keys = ON')

  _db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    -- A Project is a folder grouping profiles (like a Visual Studio solution's projects).
    -- "Strict" grouping (every profile in exactly one project) is enforced in app code; the
    -- profiles.project_id column stays nullable so the sql.js ADD COLUMN migration needs no
    -- NOT-NULL backfill dance (see seedDefaultProject for the one-time migration).
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS profiles (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT 'web',
      base_url   TEXT NOT NULL,
      browser    TEXT NOT NULL DEFAULT 'chromium',
      headless   INTEGER NOT NULL DEFAULT 0,
      timeout    INTEGER NOT NULL DEFAULT 30000,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS scenarios (
      id          TEXT PRIMARY KEY,
      profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS steps (
      id          TEXT PRIMARY KEY,
      scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      action      TEXT NOT NULL,
      params      TEXT NOT NULL DEFAULT '{}',
      label       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS history (
      id            TEXT PRIMARY KEY,
      profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      profile_name  TEXT NOT NULL,
      scenario_id   TEXT,
      scenario_name TEXT,
      status        TEXT NOT NULL,
      started_at    TEXT NOT NULL,
      finished_at   TEXT,
      duration_ms   INTEGER,
      steps_total   INTEGER NOT NULL DEFAULT 0,
      steps_passed  INTEGER NOT NULL DEFAULT 0,
      steps_failed  INTEGER NOT NULL DEFAULT 0,
      log           TEXT,
      trace_path    TEXT,
      report_path   TEXT
    );
    CREATE TABLE IF NOT EXISTS custom_steps (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      description     TEXT,
      action          TEXT NOT NULL,
      params_schema   TEXT NOT NULL DEFAULT '[]',
      script_template TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Test Data Library (Phase 1): a Collection is "the form" (defines fields once);
    -- a Data Set is one row of values grouped by intent (positive/negative/edge).
    -- Steps reference values via {{Collection.field}} tokens, resolved at generate-time.
    CREATE TABLE IF NOT EXISTS data_collections (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS data_fields (
      id            TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL REFERENCES data_collections(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      type          TEXT NOT NULL DEFAULT 'text',
      default_token TEXT NOT NULL DEFAULT '',
      sort_order    INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS data_sets (
      id            TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL REFERENCES data_collections(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      group_type    TEXT NOT NULL DEFAULT 'positive',
      field_values  TEXT NOT NULL DEFAULT '{}',
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- API profiles (profiles.type = 'api'): a Postman/SoapUI-style request collection.
    -- Separate from scenarios/steps; runs reuse the history table (API-shaped log).
    CREATE TABLE IF NOT EXISTS api_requests (
      id          TEXT PRIMARY KEY,
      profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT,
      method      TEXT NOT NULL DEFAULT 'GET',
      url         TEXT NOT NULL DEFAULT '',
      headers     TEXT NOT NULL DEFAULT '[]',   -- JSON [{key,value,enabled}]
      query       TEXT NOT NULL DEFAULT '[]',   -- JSON [{key,value,enabled}]
      body        TEXT NOT NULL DEFAULT '',
      body_type   TEXT NOT NULL DEFAULT 'none', -- none|json|xml|soap|form|raw
      soap_action TEXT NOT NULL DEFAULT '',
      extract     TEXT NOT NULL DEFAULT '[]',   -- JSON [{var,from:'json'|'xml'|'header'|'status',path}]
      assertions  TEXT NOT NULL DEFAULT '[]',   -- JSON [{type,expected}]
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Profile-scoped shared variable store. Extractions (e.g. a token) are written back here
    -- so a value fetched by one request is reused by the next — across interactive Sends too.
    CREATE TABLE IF NOT EXISTS api_variables (
      id         TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      value      TEXT NOT NULL DEFAULT '',
      secret     INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    -- One auth/token policy per profile: which request mints the token, where the token lives
    -- in its response, how to inject it, and when to silently re-fetch + retry.
    CREATE TABLE IF NOT EXISTS api_auth (
      id               TEXT PRIMARY KEY,
      profile_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      type             TEXT NOT NULL DEFAULT 'none', -- none|bearer|basic|apikey
      token_request_id TEXT,
      token_path       TEXT NOT NULL DEFAULT '',
      token_var        TEXT NOT NULL DEFAULT 'token',
      header_name      TEXT NOT NULL DEFAULT 'Authorization',
      header_prefix    TEXT NOT NULL DEFAULT 'Bearer ',
      refetch_on       TEXT NOT NULL DEFAULT '401', -- 401|manual
      config           TEXT NOT NULL DEFAULT '{}',
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // --- migrations (idempotent: sql.js throws on duplicate column, which we ignore) ---
  try { _db.run('ALTER TABLE scenarios ADD COLUMN prerequisite_id TEXT') } catch { /* already migrated */ }
  // A scenario can be temporarily disabled — skipped scenarios are excluded from a Run All
  // (an explicit single-scenario run still runs it). Steps skip via params._skip (no column).
  try { _db.run('ALTER TABLE scenarios ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0') } catch { /* already migrated */ }
  // A scenario can be locked — its steps become read-only so an approved/finished scenario
  // isn't edited by accident. A locked scenario still runs normally.
  try { _db.run('ALTER TABLE scenarios ADD COLUMN locked INTEGER NOT NULL DEFAULT 0') } catch { /* already migrated */ }
  // Per-scenario run outcomes: a Run All now continues past a failing scenario and
  // records each scenario's own pass/fail (see runner.js / webRunner.js).
  try { _db.run('ALTER TABLE history ADD COLUMN scenarios_total  INTEGER NOT NULL DEFAULT 0') } catch { /* already migrated */ }
  try { _db.run('ALTER TABLE history ADD COLUMN scenarios_passed INTEGER NOT NULL DEFAULT 0') } catch { /* already migrated */ }
  try { _db.run('ALTER TABLE history ADD COLUMN scenarios_failed INTEGER NOT NULL DEFAULT 0') } catch { /* already migrated */ }
  try { _db.run('ALTER TABLE history ADD COLUMN scenario_results TEXT') } catch { /* already migrated */ }
  // Network log: path to the captured XHR/fetch calls (network.json) for this run, shown in
  // Results and the HTML report (the DevTools-style "controller interactions" view).
  try { _db.run('ALTER TABLE history ADD COLUMN network_path TEXT') } catch { /* already migrated */ }
  // A data field can remember WHERE it goes on the page (selector picked once), so a
  // whole form can be dropped into a scenario as pre-wired fill steps (Test Data Phase 2).
  try { _db.run('ALTER TABLE data_fields ADD COLUMN selector TEXT NOT NULL DEFAULT \'\'') } catch { /* already migrated */ }
  // An API request can be data-driven: run once per data set in a Test Data collection+group
  // (the API analog of a repeating group). Tokens resolve per row at run time.
  try { _db.run('ALTER TABLE api_requests ADD COLUMN iterate_collection_id TEXT') } catch { /* already migrated */ }
  try { _db.run('ALTER TABLE api_requests ADD COLUMN iterate_group TEXT NOT NULL DEFAULT \'\'') } catch { /* already migrated */ }
  // Profiles now live under a Project (see projects table). Nullable column + app-level "strict".
  try { _db.run('ALTER TABLE profiles ADD COLUMN project_id TEXT') } catch { /* already migrated */ }

  persist()
  seedDefaultSettings()
  seedDefaultProject()
}

// One-time migration: home every pre-projects profile under a "Default" project. Runs every
// startup but is a no-op once there are no orphan profiles (fresh installs stay empty — the
// user creates their first project explicitly).
function seedDefaultProject() {
  const db = getDb()
  const orphan = db.prepare("SELECT COUNT(*) AS c FROM profiles WHERE project_id IS NULL OR project_id = ''").get()
  if (!orphan?.c) return
  const id = randomUUID()
  db.prepare('INSERT INTO projects (id, name, description) VALUES (?, ?, ?)')
    .run(id, 'Default', 'Profiles created before Projects existed')
  db.prepare("UPDATE profiles SET project_id = ? WHERE project_id IS NULL OR project_id = ''").run(id)
}

function seedDefaultSettings() {
  const db = getDb()
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
  for (const [k, v] of [
    ['app_name', 'PDR-AUTOMATION'],
    ['browser', 'chromium'],
    ['headless', '0'],
    ['default_timeout', '30000'],
    ['history_retention_days', '30'],
    ['screenshot_on_fail', '1'],
    ['trace_on_fail', '1'],
    ['settle_before_action', '1'],
    ['settle_timeout', '3000']
  ]) insert.run(k, v)
}
