import { useEffect, useState } from 'react'

export default function History({ navigate }) {
  const [history, setHistory] = useState([])

  useEffect(() => { load() }, [])

  async function load() {
    setHistory(await window.api.getHistory())
  }

  async function del(id) {
    await window.api.deleteHistory(id)
    load()
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 24 }}>Run History</h1>
      {history.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
          No runs yet. Run a profile from the Dashboard.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {history.map(h => (
            <div key={h.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px' }}>
              <span className={`badge badge-${h.status === 'passed' ? 'success' : 'error'}`}>{h.status}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{h.profile_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {new Date(h.started_at).toLocaleString()} · {h.steps_passed}/{h.steps_total} steps · {((h.duration_ms || 0) / 1000).toFixed(1)}s
                </div>
              </div>
              <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 12 }}
                onClick={() => navigate('results', { runId: h.id })}>
                View
              </button>
              <button className="btn-danger" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => del(h.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
