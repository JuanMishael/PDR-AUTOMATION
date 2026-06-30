import { useEffect, useRef, useState } from 'react'

// Runs several profiles AT ONCE. Each profile is an independent run in the main process (its own
// Playwright process + browser + temp dir), so we just fire runProfile() for each and demux the
// shared runner:started/log/complete streams by profileId.
export default function ParallelRun({ navigate, ctx }) {
  const profileIds = ctx.profileIds || []
  const [runs, setRuns] = useState({})   // profileId -> { name, status, liveRunId, resultRunId, passed, failed, durationMs, logs[], expanded }
  const launched = useRef(false)

  // mutate one profile's slice
  const patch = (pid, fn) => setRuns(prev => ({ ...prev, [pid]: { ...prev[pid], ...fn(prev[pid] || {}) } }))

  useEffect(() => {
    if (!profileIds.length) return

    // Seed names so cards render before any event arrives.
    window.api.getProfiles().then(ps => {
      const byId = Object.fromEntries(ps.map(p => [p.id, p.name]))
      setRuns(prev => {
        const next = { ...prev }
        for (const id of profileIds) next[id] = { name: byId[id] || id, status: 'running', logs: [], ...next[id] }
        return next
      })
    })

    window.api.offRunStarted(); window.api.offRunLog(); window.api.offRunComplete()
    window.api.onRunStarted(({ profileId, runId }) => patch(profileId, () => ({ liveRunId: runId, status: 'running' })))
    window.api.onRunLog((data) => patch(data.profileId, r => ({ logs: [...(r.logs || []), data] })))
    window.api.onRunComplete((data) => patch(data.profileId, () => ({
      status: data.status, resultRunId: data.runId, passed: data.passed, failed: data.failed, durationMs: data.durationMs
    })))

    // Fire all runs once (StrictMode guard). Each invoke resolves at its own completion; live
    // updates come from the events above. A setup error for one profile is shown on its card.
    if (!launched.current) {
      launched.current = true
      for (const id of profileIds) {
        window.api.runProfile(id).then(res => {
          if (res?.error) patch(id, () => ({ status: 'failed', logs: [{ type: 'error', text: res.error }] }))
        })
      }
    }

    return () => { window.api.offRunStarted(); window.api.offRunLog(); window.api.offRunComplete() }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const list = profileIds.map(id => ({ id, ...(runs[id] || { name: id, status: 'running', logs: [] }) }))
  const allDone = list.length > 0 && list.every(r => r.status !== 'running')
  const running = list.filter(r => r.status === 'running').length

  // A parallel run belongs to a project — its results (and this screen's Back) return there.
  const back = ctx.projectId
    ? { screen: 'dashboard', ctx: { projectId: ctx.projectId, projectName: ctx.projectName }, label: `Back to ${ctx.projectName || 'project'}` }
    : { screen: 'projects', ctx: {}, label: 'Back to Projects' }

  return (
    <div className="fade-in" style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div className="page-header" style={{ marginBottom: 0, flex: 1 }}>
          <h1>Parallel Run</h1>
          <p>{allDone ? `All ${list.length} runs finished` : `${running} of ${list.length} running…`}</p>
        </div>
        <button className="btn-ghost" onClick={() => navigate(back.screen, back.ctx)}>← {back.label}</button>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {list.map(r => <RunCard key={r.id} run={r} patch={patch} navigate={navigate} back={back} />)}
      </div>
    </div>
  )
}

const STATUS = {
  running: { color: 'var(--warning)', bg: 'var(--warning-dim)', label: 'Running' },
  passed:  { color: 'var(--success)', bg: 'var(--success-dim)', label: 'Passed' },
  failed:  { color: 'var(--error)',   bg: 'var(--error-dim)',   label: 'Failed' },
  stopped: { color: 'var(--text-muted)', bg: 'var(--surface2)', label: 'Stopped' }
}

function RunCard({ run, patch, navigate, back }) {
  const logRef = useRef(null)
  useEffect(() => { if (run.expanded && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [run.logs, run.expanded])

  const sc = STATUS[run.status] || STATUS.running
  const isRunning = run.status === 'running'
  const logs = run.logs || []

  function stop() {
    if (run.liveRunId) window.api.stopRun(run.liveRunId)
    patch(run.id, () => ({ status: 'stopped' }))
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => patch(run.id, r => ({ expanded: !r.expanded }))}
          title={run.expanded ? 'Hide log' : 'Show log'}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, width: 14 }}>
          {run.expanded ? '▾' : '▸'}
        </button>
        <span style={{ flex: 1, fontWeight: 700, fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.name}</span>
        {(run.passed != null || run.failed != null) && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            <span style={{ color: 'var(--success)' }}>{run.passed || 0}✓</span> · <span style={{ color: 'var(--error)' }}>{run.failed || 0}✗</span>
            {run.durationMs != null && <> · {((run.durationMs || 0) / 1000).toFixed(1)}s</>}
          </span>
        )}
        <span style={{ padding: '4px 12px', borderRadius: 999, fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
          letterSpacing: '0.06em', background: sc.bg, color: sc.color, display: 'flex', alignItems: 'center', gap: 6 }}>
          {isRunning && <span className="pulse">●</span>}{sc.label}
        </span>
        {isRunning
          ? <button className="btn-danger btn-sm" onClick={stop}>■ Stop</button>
          : run.resultRunId && <button className="btn-ghost btn-sm" onClick={() => navigate('results', { runId: run.resultRunId, back })}>Results →</button>}
      </div>

      {run.expanded && (
        <div ref={logRef} style={{ marginTop: 10, background: '#080812', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', padding: '10px 12px', height: 200, overflow: 'auto',
          fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6 }}>
          {logs.length === 0 && <span style={{ color: 'var(--text-muted)' }}>Initializing…</span>}
          {logs.map((log, i) => (
            <div key={i} style={{ color: logColor(log) }}>
              {log.type === 'step' ? (
                <><span style={{ color: log.status === 'passed' ? 'var(--success)' : 'var(--error)', fontWeight: 700 }}>{log.status === 'passed' ? '✓' : '✗'}</span>{' '}{log.label}{log.error && <span style={{ color: 'var(--error)', opacity: 0.8 }}> — {log.error}</span>}</>
              ) : (log.text || JSON.stringify(log))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function logColor(log) {
  if (log.type === 'error')   return 'var(--error)'
  if (log.type === 'success') return 'var(--success)'
  if (log.type === 'info')    return 'var(--text-muted)'
  if (log.type === 'step')    return 'var(--text)'
  return 'var(--text-soft)'
}
