import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'

let _db       // sql.js Database instance
let _dbPath   // path to the .db file on disk
let _inTx = false  // suppress mid-transaction persists

function persist() {
  if (_inTx) return
  writeFileSync(_dbPath, Buffer.from(_db.export()))
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
  `)

  // --- migrations (idempotent: sql.js throws on duplicate column, which we ignore) ---
  try { _db.run('ALTER TABLE scenarios ADD COLUMN prerequisite_id TEXT') } catch { /* already migrated */ }

  persist()
  seedDefaultSettings()
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
    ['trace_on_fail', '1']
  ]) insert.run(k, v)
}
