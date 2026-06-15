import { useEffect, useState } from 'react'
import { Icon } from '../components/SketchDefs'

function timeAgo(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const s = (Date.now() - d.getTime()) / 1000
  if (s < 60)      return 'just now'
  if (s < 3600)    return `${Math.floor(s / 60)}m ago`
  if (s < 86400)   return `${Math.floor(s / 3600)}h ago`
  if (s < 604800)  return `${Math.floor(s / 86400)}d ago`
  return d.toLocaleDateString()
}

// last ~5 runs as colored dots, oldest → newest (left → right)
function Streak({ runs }) {
  const recent = runs.slice(0, 5).reverse()
  if (!recent.length) return <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>No runs yet</span>
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }} title="Recent runs (oldest → newest)">
      {recent.map((r, i) => (
        <span key={i} style={{
          width: 9, height: 9, borderRadius: '50%',
          background: r.status === 'passed' ? 'var(--ok)' : 'var(--bad)',
          border: `1.5px solid ${r.status === 'passed' ? 'var(--ok-line)' : 'var(--bad-line)'}`
        }} />
      ))}
    </div>
  )
}

function ProfileCard({ profile, scenarioCount, runs, navigate }) {
  const last = runs[0]
  // Prefer the per-scenario breakdown; fall back to steps for runs recorded before that existed.
  const hasScenarioBreakdown = last && last.scenarios_total > 0
  const breakdown = last
    ? (hasScenarioBreakdown
        ? `${last.scenarios_passed}/${last.scenarios_total} scenarios passed`
        : `${last.steps_passed}/${last.steps_total} steps passed`)
    : null

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 18 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: 'var(--accent-soft)', border: '2px solid var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-hand)', fontSize: 17, color: 'var(--accent-ink)'
        }}>
          {profile.name.slice(0, 2).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-hand)', fontSize: 19, color: 'var(--ink)', lineHeight: 1.1 }}>
            {profile.name}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-soft)', marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {profile.browser} · {profile.base_url}
          </div>
        </div>
        {last && (
          <span className={`badge ${last.status === 'passed' ? 'badge-ok' : 'badge-bad'}`}>
            <span className="dot" />{last.status}
          </span>
        )}
      </div>

      {/* Meta */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-hand)', fontSize: 15, color: 'var(--ink-soft)' }}>
          {scenarioCount} scenario{scenarioCount !== 1 ? 's' : ''}
        </span>
        <span style={{ color: 'var(--line-soft)' }}>·</span>
        {last ? (
          <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
            {breakdown} <span style={{ color: 'var(--ink-faint)' }}>· {timeAgo(last.started_at)}</span>
          </span>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--ink-faint)' }}>Never run</span>
        )}
        <div style={{ marginLeft: 'auto' }}><Streak runs={runs} /></div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button className="btn btn-sm" style={{ flex: 1, justifyContent: 'center' }}
          onClick={() => navigate('scenarios', { profileId: profile.id, profileName: profile.name })}>
          <Icon name="builder" size={16} /> Edit Scenarios
        </button>
        <button className="btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }}
          onClick={() => navigate('run', { profileId: profile.id })}>
          <Icon name="run" size={15} fill /> Run
        </button>
      </div>
    </div>
  )
}

export default function Dashboard({ navigate }) {
  const [profiles, setProfiles] = useState([])
  const [history, setHistory] = useState([])
  const [counts, setCounts] = useState({})   // profileId -> scenario count

  useEffect(() => {
    window.api.getProfiles().then(async (ps) => {
      setProfiles(ps)
      const entries = await Promise.all(
        ps.map(async p => [p.id, (await window.api.getScenarios(p.id)).length])
      )
      setCounts(Object.fromEntries(entries))
    })
    window.api.getHistory().then(setHistory)
  }, [])

  // history is returned newest-first; group by profile keeping that order.
  const runsByProfile = {}
  for (const h of history) (runsByProfile[h.profile_id] ||= []).push(h)

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>Welcome back — {profiles.length} profile{profiles.length !== 1 ? 's' : ''} configured</p>
      </div>

      {/* Profiles */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 className="eyebrow">Profiles</h2>
        <button className="btn btn-sm" onClick={() => navigate('profile')}>
          <Icon name="plus" size={15} /> New Profile
        </button>
      </div>

      {profiles.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon"><Icon name="profile" size={36} /></div>
          <p>No profiles yet. Create one to get started.</p>
          <button className="btn-primary" onClick={() => navigate('profile')}>+ Create Profile</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 14, marginBottom: 34 }}>
          {profiles.map(p => (
            <ProfileCard key={p.id} profile={p}
              scenarioCount={counts[p.id] ?? 0}
              runs={runsByProfile[p.id] || []}
              navigate={navigate} />
          ))}
        </div>
      )}

      {/* Recent runs */}
      {history.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 className="eyebrow">Recent Runs</h2>
            <button className="btn btn-sm" onClick={() => navigate('history')}>View All →</button>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {history.slice(0, 6).map(h => {
              const detail = h.scenarios_total > 0
                ? `${h.scenarios_passed}/${h.scenarios_total} scenarios`
                : `${h.steps_passed}/${h.steps_total} steps`
              return (
                <div key={h.id} className="sketch" onClick={() => navigate('results', { runId: h.id })}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', cursor: 'pointer' }}>
                  <span className={`badge ${h.status === 'passed' ? 'badge-ok' : 'badge-bad'}`}>
                    <span className="dot" />{h.status}
                  </span>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{h.profile_name}</span>
                  <span style={{ color: 'var(--ink-soft)', fontSize: 11 }}>{detail}</span>
                  <span style={{ color: 'var(--ink-faint)', fontSize: 11 }}>{timeAgo(h.started_at)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
