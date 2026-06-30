import { useEffect, useState } from 'react'
import { Icon } from '../components/SketchDefs'
import CopyToProject from '../components/CopyToProject'

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

function ShareButton({ profileId }) {
  const [msg, setMsg] = useState(null)
  async function share(e) {
    e.stopPropagation()
    const res = await window.api.exportProfile(profileId)
    setMsg(res?.ok ? '✓' : '✗')
    setTimeout(() => setMsg(null), 2500)
  }
  return (
    <button className="btn btn-sm" onClick={share} title="Share — export this profile (+ its test data) to a file"
      style={{ justifyContent: 'center', flexShrink: 0 }}>
      {msg || '⬆'} Share
    </button>
  )
}

function ProfileCard({ profile, scenarioCount, runs, navigate, selected, onToggleSelect, currentProjectId, onCopied }) {
  const last = runs[0]
  // Prefer the per-scenario breakdown; fall back to steps for runs recorded before that existed.
  const hasScenarioBreakdown = last && last.scenarios_total > 0
  const breakdown = last
    ? (hasScenarioBreakdown
        ? `${last.scenarios_passed}/${last.scenarios_total} scenarios passed`
        : `${last.steps_passed}/${last.steps_total} steps passed`)
    : null

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 18,
      boxShadow: selected ? '0 0 0 2px var(--accent)' : undefined }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <input type="checkbox" checked={selected} onChange={() => onToggleSelect(profile.id)}
          title="Select to run in parallel" style={{ width: 'auto', flexShrink: 0, cursor: 'pointer', margin: 0 }} />
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
        <ShareButton profileId={profile.id} />
        <CopyToProject profileId={profile.id} currentProjectId={currentProjectId}
          className="btn btn-sm" label="→ Project" onDone={onCopied} />
      </div>
    </div>
  )
}

export default function Dashboard({ navigate, ctx = {} }) {
  const projectId = ctx.projectId
  const projectName = ctx.projectName || 'Profiles'
  const [profiles, setProfiles] = useState([])
  const [history, setHistory] = useState([])
  const [counts, setCounts] = useState({})   // profileId -> scenario count
  const [importMsg, setImportMsg] = useState(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(() => new Set())

  const toggleSelect = (id) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  async function load() {
    const ps = await window.api.getProfiles(projectId)
    setProfiles(ps)
    const entries = await Promise.all(
      ps.map(async p => [p.id, (await window.api.getScenarios(p.id)).length])
    )
    setCounts(Object.fromEntries(entries))
    window.api.getHistory().then(setHistory)
  }

  // The dashboard is always a project drill-down. Reached without a project (e.g. a stale "← Back"),
  // bounce to the Projects list so there's always a project context.
  useEffect(() => { if (!projectId) navigate('projects') }, [projectId])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (projectId) load() }, [projectId])  // eslint-disable-line react-hooks/exhaustive-deps

  async function importProfile() {
    const res = await window.api.importProfile(projectId)
    if (res?.cancelled) return
    if (res?.ok) { setImportMsg(`✓ Imported "${res.name}" (${res.scenarioCount} scenario${res.scenarioCount !== 1 ? 's' : ''})`); await load() }
    else setImportMsg(`✗ ${res?.error || 'Import failed'}`)
    setTimeout(() => setImportMsg(null), 4000)
  }

  // history is returned newest-first; group by profile keeping that order.
  const runsByProfile = {}
  for (const h of history) (runsByProfile[h.profile_id] ||= []).push(h)

  // Recent-runs list is scoped to this project's profiles.
  const projProfileIds = new Set(profiles.map(p => p.id))
  const projectHistory = history.filter(h => projProfileIds.has(h.profile_id))
  const webRunnable = profiles.filter(p => p.type !== 'api').map(p => p.id)

  // Float the most-recently-run profile to the top; never-run profiles sink (keep creation order).
  const lastRunAt = p => { const r = runsByProfile[p.id]?.[0]; return r ? new Date(r.started_at).getTime() : -1 }
  const q = search.trim().toLowerCase()
  const visibleProfiles = [...profiles]
    .filter(p => !q || p.name.toLowerCase().includes(q) || (p.base_url || '').toLowerCase().includes(q))
    .sort((a, b) => lastRunAt(b) - lastRunAt(a))

  if (!projectId) return null  // bouncing to Projects (see effect above)

  return (
    <div className="fade-in">
      <div className="page-header">
        <button className="btn-ghost btn-sm" onClick={() => navigate('projects')} style={{ marginBottom: 8 }}>
          ← All Projects
        </button>
        <h1>{projectName}</h1>
        <p>{profiles.length} profile{profiles.length !== 1 ? 's' : ''} in this project</p>
      </div>

      {/* Profiles */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <h2 className="eyebrow" style={{ marginRight: 'auto' }}>Profiles</h2>
        {profiles.length > 4 && (
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Search profiles…" style={{ fontSize: 12, maxWidth: 220 }} />
        )}
        {importMsg && <span style={{ fontSize: 12, color: importMsg.startsWith('✓') ? 'var(--ok)' : 'var(--bad)' }}>{importMsg}</span>}
        {webRunnable.length > 0 && (
          <button className="btn-primary btn-sm" onClick={() => navigate('parallel', { profileIds: webRunnable, projectId, projectName })}
            title={`Run all ${webRunnable.length} web profiles in this project in parallel`}>
            <Icon name="run" size={14} fill /> Run project
          </button>
        )}
        <button className="btn btn-sm" onClick={importProfile} title="Import a profile shared by another QA (.json)">
          ⬇ Import Profile
        </button>
        <button className="btn btn-sm" onClick={() => navigate('profile', { projectId, projectName })}>
          <Icon name="plus" size={15} /> New Profile
        </button>
      </div>

      {profiles.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon"><Icon name="profile" size={36} /></div>
          <p>No profiles yet. Create one to get started.</p>
          <button className="btn-primary" onClick={() => navigate('profile', { projectId, projectName })}>+ Create Profile</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 14, marginBottom: 34 }}>
          {visibleProfiles.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>No profiles match “{search}”.</p>
          ) : visibleProfiles.map(p => (
            <ProfileCard key={p.id} profile={p}
              scenarioCount={counts[p.id] ?? 0}
              runs={runsByProfile[p.id] || []}
              navigate={navigate}
              selected={selected.has(p.id)}
              onToggleSelect={toggleSelect}
              currentProjectId={projectId}
              onCopied={m => { setImportMsg(m); setTimeout(() => setImportMsg(null), 4000) }} />
          ))}
        </div>
      )}

      {/* Parallel-run action bar — appears once profiles are ticked */}
      {selected.size > 0 && (
        <div style={{ position: 'sticky', bottom: 16, zIndex: 5, display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 16px', marginBottom: 24, background: 'var(--surface)', border: '2px solid var(--accent)',
          borderRadius: 'var(--radius)', boxShadow: '0 6px 20px rgba(0,0,0,0.18)' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{selected.size} profile{selected.size !== 1 ? 's' : ''} selected</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
            <button className="btn-primary btn-sm" onClick={() => navigate('parallel', { profileIds: [...selected], projectId, projectName })}>
              <Icon name="run" size={14} fill /> Run {selected.size} in parallel
            </button>
          </div>
        </div>
      )}

      {/* Recent runs */}
      {projectHistory.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 className="eyebrow">Recent Runs</h2>
            <button className="btn btn-sm" onClick={() => navigate('history')}>View All →</button>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {projectHistory.slice(0, 6).map(h => {
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
