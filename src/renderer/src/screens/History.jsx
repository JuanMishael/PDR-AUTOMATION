import { useEffect, useState } from 'react'
import { confirmDialog } from '../lib/confirm'

export default function History({ navigate }) {
  const [history, setHistory] = useState([])
  const [filter, setFilter] = useState('all')

  useEffect(() => { load() }, [])

  async function load() {
    try {
      setHistory(await window.api.getHistory())
    } catch (e) {
      alert('Could not load history: ' + (e?.message || 'unknown error'))
    }
  }

  async function del(id, e) {
    e.stopPropagation()
    if (!(await confirmDialog('Delete this run from history?', { confirmText: 'Delete' }))) return
    try {
      await window.api.deleteHistory(id)
      await load()
    } catch (e) {
      alert('Could not delete run: ' + (e?.message || 'unknown error'))
    }
  }

  async function clearAll() {
    if (!(await confirmDialog(`Delete ALL ${history.length} runs from history? This cannot be undone.`, { confirmText: 'Delete all' }))) return
    try {
      await window.api.clearHistory()
      await load()
    } catch (e) {
      alert('Could not clear history: ' + (e?.message || 'unknown error'))
    }
  }

  const filtered = filter === 'all' ? history : history.filter(h => h.status === filter)

  return (
    <div className="fade-in" style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <div className="page-header" style={{ marginBottom: 0, flex: 1 }}>
          <h1>Run History</h1>
          <p>{history.length} total runs recorded</p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {['all', 'passed', 'failed'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              style={{
                padding: '5px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                background: filter === f ? 'var(--accent)' : 'var(--surface)',
                color: filter === f ? '#fff' : 'var(--text-muted)',
                border: `1px solid ${filter === f ? 'var(--accent)' : 'var(--border)'}`,
                textTransform: 'capitalize'
              }}>
              {f}
            </button>
          ))}
          {history.length > 0 && (
            <button className="btn-danger" onClick={clearAll}
              title="Delete every run from history"
              style={{ padding: '5px 14px', fontSize: 12, fontWeight: 700, marginLeft: 6 }}>
              🗑 Delete all
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon">◷</div>
          <p>{history.length === 0 ? 'No runs yet. Run a profile from the Dashboard.' : 'No runs match this filter.'}</p>
          {history.length === 0 && (
            <button className="btn-primary" onClick={() => navigate('dashboard')}>Go to Dashboard</button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 7 }}>
          {filtered.map(h => (
            <div key={h.id}
              onClick={() => navigate('results', { runId: h.id })}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px',
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderLeft: `3px solid ${h.status === 'passed' ? 'var(--success)' : 'var(--error)'}`,
                borderRadius: 'var(--radius-sm)', cursor: 'pointer', transition: 'border-color 0.15s'
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-light)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              <span className={`badge badge-${h.status === 'passed' ? 'success' : 'error'}`}>
                {h.status}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{h.profile_name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                  {new Date(h.started_at).toLocaleString()}
                </div>
              </div>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {h.steps_passed}/{h.steps_total} steps
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {fmtDuration(h.duration_ms)}
              </span>
              <button className="btn-danger" style={{ padding: '4px 10px', fontSize: 11 }}
                onClick={e => del(h.id, e)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function fmtDuration(ms) {
  if (!ms) return '—'
  return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`
}
