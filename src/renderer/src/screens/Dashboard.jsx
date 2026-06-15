import { useEffect, useState } from 'react'

export default function Dashboard({ navigate }) {
  const [profiles, setProfiles] = useState([])
  const [history, setHistory] = useState([])
  const [appName, setAppName] = useState('PDR-AUTOMATION')

  useEffect(() => {
    window.api.getProfiles().then(setProfiles)
    window.api.getHistory().then(h => setHistory(h.slice(0, 6)))
    window.api.getSettings().then(s => { if (s.app_name) setAppName(s.app_name) })
  }, [])

  const totalRuns   = history.length
  const totalPassed = history.filter(h => h.status === 'passed').length
  const totalFailed = history.filter(h => h.status === 'failed').length

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>Welcome back — {profiles.length} profile{profiles.length !== 1 ? 's' : ''} configured</p>
      </div>

      {/* Stats row */}
      {history.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 28 }}>
          {[
            { label: 'Total Runs', value: totalRuns, color: 'var(--text)', icon: '▶' },
            { label: 'Passed',     value: totalPassed, color: 'var(--success)', icon: '✓' },
            { label: 'Failed',     value: totalFailed, color: 'var(--error)', icon: '✗' }
          ].map(stat => (
            <div key={stat.label} style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '16px 20px',
              display: 'flex', alignItems: 'center', gap: 14
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 8,
                background: stat.color === 'var(--text)' ? 'var(--surface2)' : `${stat.color}22`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, color: stat.color, fontWeight: 700, flexShrink: 0
              }}>{stat.icon}</div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 800, color: stat.color, lineHeight: 1 }}>{stat.value}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{stat.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Profiles */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Profiles
        </h2>
        <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => navigate('profile')}>
          + New Profile
        </button>
      </div>

      {profiles.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon">⊡</div>
          <p>No profiles yet. Create one to get started.</p>
          <button className="btn-primary" onClick={() => navigate('profile')}>+ Create Profile</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10, marginBottom: 32 }}>
          {profiles.map(p => (
            <div key={p.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px' }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                background: 'var(--accent-dim)', border: '1px solid rgba(108,99,255,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 800, color: 'var(--accent)'
              }}>
                {p.name.slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.browser} · {p.base_url}
                </div>
              </div>
              <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12, flexShrink: 0 }}
                onClick={() => navigate('scenarios', { profileId: p.id, profileName: p.name })}>
                Edit Scenarios
              </button>
              <button className="btn-primary" style={{ padding: '6px 14px', fontSize: 12, flexShrink: 0 }}
                onClick={() => navigate('run', { profileId: p.id })}>
                ▶ Run
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Recent runs */}
      {history.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Recent Runs
            </h2>
            <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => navigate('history')}>
              View All →
            </button>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {history.map(h => (
              <div key={h.id}
                onClick={() => navigate('results', { runId: h.id })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  transition: 'border-color 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-light)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <span className={`badge badge-${h.status === 'passed' ? 'success' : 'error'}`}>{h.status}</span>
                <span style={{ flex: 1, fontWeight: 500, fontSize: 13 }}>{h.profile_name}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  {h.steps_passed}/{h.steps_total} steps
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  {new Date(h.started_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
