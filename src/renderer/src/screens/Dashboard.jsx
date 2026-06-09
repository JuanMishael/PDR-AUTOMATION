import { useEffect, useState } from 'react'

export default function Dashboard({ navigate }) {
  const [profiles, setProfiles] = useState([])
  const [history, setHistory] = useState([])
  const [running, setRunning] = useState(null)

  useEffect(() => {
    window.api.getProfiles().then(setProfiles)
    window.api.getHistory().then(h => setHistory(h.slice(0, 5)))
  }, [])

  async function handleRun(profileId) {
    setRunning(profileId)
    navigate('run', { profileId })
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Dashboard</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 28 }}>Select a profile and run your tests.</p>

      {profiles.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>◈</div>
          <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>No profiles yet. Create one to get started.</p>
          <button className="btn-primary" onClick={() => navigate('profile')}>+ New Profile</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {profiles.map(p => (
            <div key={p.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{p.name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>
                  {p.browser} · {p.base_url}
                </div>
              </div>
              <button className="btn-ghost" onClick={() => navigate('scenarios', { profileId: p.id, profileName: p.name })}>
                Edit Scenarios
              </button>
              <button className="btn-primary" onClick={() => handleRun(p.id)} disabled={running === p.id}>
                ▶ Run
              </button>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 36 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Recent Runs
          </h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {history.map(h => (
              <div key={h.id} className="card"
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', cursor: 'pointer' }}
                onClick={() => navigate('results', { runId: h.id })}>
                <span className={`badge badge-${h.status === 'passed' ? 'success' : 'error'}`}>{h.status}</span>
                <span style={{ flex: 1 }}>{h.profile_name}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{new Date(h.started_at).toLocaleString()}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{h.steps_passed}/{h.steps_total} steps</span>
              </div>
            ))}
          </div>
          <button className="btn-ghost" style={{ marginTop: 12 }} onClick={() => navigate('history')}>
            View All History →
          </button>
        </div>
      )}
    </div>
  )
}
