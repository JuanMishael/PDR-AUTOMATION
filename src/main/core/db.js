import { app } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, statSync } from 'fs'

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

  // Repair steps.params mangled by an older build, in two stages of the same bug (see
  // paramsJson in storage.js). Stage 1: saving a step whose params were still the raw DB
  // string encoded them TWICE — one parse then returns a string, so every param reads as
  // undefined and the card shows a blank selector while the step runs with none. Stage 2:
  // editing a param on such a card spread that string into character keys ({"0":"{",...}).
  // Both keep every character, so both are recoverable — unwrap the re-encoding, re-join the
  // characters, and let any real key edited in while it was broken win over the recovered one.
  try {
    const res = _db.exec('SELECT id, params FROM steps')
    let fixed = 0
    for (const [id, raw] of (res.length ? res[0].values : [])) {
      let obj
      try { obj = JSON.parse(raw) } catch { continue }
      for (let i = 0; i < 5 && typeof obj === 'string'; i++) {
        try { obj = JSON.parse(obj) } catch { break }
      }
      if (!obj || typeof obj !== 'object') continue

      const idx = Object.keys(obj).filter(k => /^\d+$/.test(k))
      if (idx.length) {
        let inner
        try { inner = JSON.parse(idx.sort((a, b) => a - b).map(k => obj[k]).join('')) } catch { inner = null }
        if (inner && typeof inner === 'object') {
          for (const k of idx) delete obj[k]
          obj = { ...inner, ...obj }
        }
      }

      const json = JSON.stringify(obj)
      if (json !== raw) { _db.run('UPDATE steps SET params = ? WHERE id = ?', [json, id]); fixed++ }
    }
    if (fixed) persist()
  } catch { /* no steps table yet, or nothing to repair */ }

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
  // Run recording: path to the .webm Playwright recorded for this run (Settings → Record video).
  try { _db.run('ALTER TABLE history ADD COLUMN video_path TEXT') } catch { /* already migrated */ }
  // A data field can remember WHERE it goes on the page (selector picked once), so a
  // whole form can be dropped into a scenario as pre-wired fill steps (Test Data Phase 2).
  try { _db.run('ALTER TABLE data_fields ADD COLUMN selector TEXT NOT NULL DEFAULT \'\'') } catch { /* already migrated */ }
  // An API request can be data-driven: run once per data set in a Test Data collection+group
  // (the API analog of a repeating group). Tokens resolve per row at run time.
  try { _db.run('ALTER TABLE api_requests ADD COLUMN iterate_collection_id TEXT') } catch { /* already migrated */ }
  try { _db.run('ALTER TABLE api_requests ADD COLUMN iterate_group TEXT NOT NULL DEFAULT \'\'') } catch { /* already migrated */ }
  // Profiles now live under a Project (see projects table). Nullable column + app-level "strict".
  try { _db.run('ALTER TABLE profiles ADD COLUMN project_id TEXT') } catch { /* already migrated */ }
  // Mobile view: launch the browser with a phone viewport + touch + mobile UA, for web apps that
  // only render in mobile. Applies to runs AND the picker/recorder/selector-test (see deviceProfile).
  try { _db.run('ALTER TABLE profiles ADD COLUMN mobile INTEGER NOT NULL DEFAULT 0') } catch { /* already migrated */ }
  // Native Android profile (type='android'): base_url holds the app package; app_activity is the
  // optional launch activity (blank = let Appium resolve the main one). Driven via Appium, not Playwright.
  try { _db.run('ALTER TABLE profiles ADD COLUMN app_activity TEXT NOT NULL DEFAULT \'\'') } catch { /* already migrated */ }
  // WSDL re-sync: remember the service URL on the profile, and keep the pristine scaffold we
  // generated for each request. On a re-sync we can then tell an untouched envelope (safe to
  // regenerate) from one you filled in (never overwritten) — see api:importWsdl.
  try { _db.run('ALTER TABLE profiles ADD COLUMN wsdl_url TEXT NOT NULL DEFAULT \'\'') } catch { /* already migrated */ }
  try { _db.run('ALTER TABLE api_requests ADD COLUMN wsdl_envelope TEXT NOT NULL DEFAULT \'\'') } catch { /* already migrated */ }

  persist()
  seedDefaultSettings()
  seedDefaultProject()
  pruneHistory()
}

// Drop history rows older than history_retention_days. sql.js serializes the WHOLE db on
// every save, and each history row carries the full run log + scenario_results — so without
// pruning, saves and startup reads get steadily slower. Runs once at launch. 0/blank = keep all.
function pruneHistory() {
  const db = getDb()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'history_retention_days'").get()
  const days = Number(row?.value)
  if (!Number.isFinite(days) || days <= 0) return
  // started_at is stored as an ISO string (…T…Z); wrap in datetime() so both sides are the
  // same normalized format and the comparison isn't a raw string mismatch.
  db.prepare(`DELETE FROM history WHERE datetime(started_at) < datetime('now', ?)`).run(`-${days} days`)
  pruneRunArtifacts(join(app.getPath('temp'), 'pdr-runs'), days)
}

// Every run writes its screenshots, trace.zip, network.json and video into
// %TEMP%/pdr-runs/<runId>/ — and nothing ever deleted them, so the files outlived the history
// row that pointed at them (harmless when it was a screenshot, less so now there's a video).
// Swept by FOLDER AGE rather than by looking up each pruned row: a run's folder name is its
// own uuid, not the history id, and going by age also clears orphans from runs that died
// before a row was ever written. Exported so scripts/test-video.mjs can exercise it.
// ponytail: runs once at startup, before any run exists — no in-flight folder to protect.
export function pruneRunArtifacts(root, days) {
  if (!existsSync(root)) return
  const cutoff = Date.now() - days * 86400000
  for (const name of readdirSync(root)) {
    const dir = join(root, name)
    // Each folder is independent: one that's locked (a browser still holding a video handle)
    // must not stop the rest, and the next launch will get it.
    try { if (statSync(dir).mtimeMs < cutoff) rmSync(dir, { recursive: true, force: true }) }
    catch { /* in use or already gone */ }
  }
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
    ['record_video', '1'],
    ['settle_before_action', '1'],
    ['settle_timeout', '3000']
  ]) insert.run(k, v)
}
