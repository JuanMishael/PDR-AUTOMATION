import { useEffect, useRef, useState } from 'react'

export default function ActiveRun({ navigate, ctx }) {
  const { profileId, scenarioId, scenarioName, dataDriven } = ctx
  const [logs, setLogs] = useState([])
  const [status, setStatus] = useState('running')
  const [summary, setSummary] = useState(null)
  const [runId, setRunId] = useState(null)
  const [started, setStarted] = useState(false)
  const [dataSets, setDataSets] = useState(null)   // null = still loading; [] = none
  const [dataSetId, setDataSetId] = useState('')   // '' = use field defaults
  const [runNonce, setRunNonce] = useState(0)      // bump to re-trigger the run effect
  const logRef = useRef(null)

  // Flatten every collection's sets into one pickable list. If there are none, skip the
  // gate entirely and auto-run — so the run path is unchanged when the feature is unused.
  useEffect(() => {
    let cancelled = false
    window.api.getCollections().then(cols => {
      if (cancelled) return
      const flat = []
      for (const c of cols) for (const s of c.sets) flat.push({ id: s.id, label: `${c.name} · ${s.name}`, group: s.group_type })
      setDataSets(flat)
      // Skip the single-set gate when: there's nothing to pick, it's a data-driven run (brings
      // its own sets), or it's Run All (no scenarioId — scenarios get data from loop blocks or
      // field defaults; forcing one global set for the whole run isn't meaningful).
      if (flat.length === 0 || dataDriven || !scenarioId) setStarted(true)
    }).catch(() => { if (!cancelled) { setDataSets([]); setStarted(true) } })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!profileId || !started) return

    window.api.offRunLog()
    window.api.offRunComplete()
    setLogs([])
    setSummary(null)
    setStatus('running')

    window.api.onRunLog((data) => {
      setLogs(prev => [...prev, data])
    })

    window.api.onRunComplete((data) => {
      setStatus(data.status)
      setSummary(data)
      setRunId(data.runId)
    })

    const setId = dataSetId || null
    const runPromise = dataDriven
      ? window.api.runDataDriven({ profileId, scenarioId, dataSetIds: dataDriven.dataSetIds, logoutScenarioId: dataDriven.logoutScenarioId })
      : scenarioId
        ? window.api.runScenario(profileId, scenarioId, setId)
        : window.api.runProfile(profileId, setId)
    runPromise.then(result => {
      if (result?.error) {
        setLogs(prev => [...prev, { type: 'error', text: result.error }])
        setStatus('failed')
      }
    })

    return () => {
      window.api.offRunLog()
      window.api.offRunComplete()
    }
  }, [profileId, scenarioId, started, runNonce])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  // Pre-run gate: only shown when data sets exist and the run hasn't started.
  // NB: every hook must run BEFORE this conditional return — React requires a
  // stable hook order across renders, so no useEffect may live below it.
  if (!started) {
    return (
      <div className="fade-in" style={{ maxWidth: 560 }}>
        <div className="page-header">
          <h1>Choose Test Data</h1>
          <p>{scenarioName ? `Scenario: ${scenarioName}` : 'Running all scenarios'} — pick a data set to fill {'{{token}}'} values, or run with field defaults.</p>
        </div>
        <div className="card" style={{ display: 'grid', gap: 16 }}>
          <div>
            <label>Active data set</label>
            <select value={dataSetId} onChange={e => setDataSetId(e.target.value)}>
              <option value="">— None (use field defaults) —</option>
              {(dataSets || []).map(d => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" onClick={() => setStarted(true)}>▶ Start Run</button>
            <button className="btn-ghost" onClick={() => navigate('dashboard')}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  function stopRun() {
    if (runId) window.api.stopRun(runId)
    setStatus('stopped')
  }

  // Restart the same run (same scenario/data set) without leaving the screen — the run
  // effect re-fires on runNonce and resets logs/summary/status at its top.
  function rerun() {
    setRunId(null)
    setStarted(true)
    setRunNonce(n => n + 1)
  }
  const finished = status === 'passed' || status === 'failed' || status === 'stopped'

  const STATUS_CONFIG = {
    running: { color: 'var(--warning)',  bg: 'var(--warning-dim)',  label: 'Running' },
    passed:  { color: 'var(--success)',  bg: 'var(--success-dim)',  label: 'Passed' },
    failed:  { color: 'var(--error)',    bg: 'var(--error-dim)',    label: 'Failed' },
    stopped: { color: 'var(--text-muted)', bg: 'var(--surface2)', label: 'Stopped' }
  }
  const sc = STATUS_CONFIG[status] || STATUS_CONFIG.running

  return (
    <div className="fade-in" style={{ maxWidth: 860 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div className="page-header" style={{ marginBottom: 0, flex: 1 }}>
          <h1>Active Run</h1>
          <p>{scenarioName ? `Running scenario: ${scenarioName}` : 'Running all scenarios (one continuous session)…'}</p>
        </div>
        <span style={{
          padding: '5px 14px', borderRadius: 999, fontSize: 11, fontWeight: 800,
          textTransform: 'uppercase', letterSpacing: '0.07em',
          background: sc.bg, color: sc.color,
          display: 'flex', alignItems: 'center', gap: 6
        }}>
          {status === 'running' && <span className="pulse">●</span>}
          {sc.label}
        </span>
        {status === 'running' && (
          <button className="btn-danger" onClick={stopRun}>■ Stop</button>
        )}
        {finished && (
          <>
            <button className="btn-ghost" onClick={() => navigate('dashboard')}>← Back</button>
            <button className="btn-primary" onClick={rerun}>
              ↻ Re-run{scenarioName ? '' : ' All'}
            </button>
            {(status === 'passed' || status === 'failed') && runId && (
              <button className="btn-ghost" onClick={() => navigate('results', { runId })}>
                View Results →
              </button>
            )}
          </>
        )}
      </div>

      {/* Summary bar */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
          {[
            { label: 'Passed', value: summary.passed, color: 'var(--success)' },
            { label: 'Failed', value: summary.failed, color: 'var(--error)' },
            { label: 'Duration', value: `${((summary.durationMs || 0) / 1000).toFixed(1)}s`, color: 'var(--text)' }
          ].map(s => (
            <div key={s.label} className="card" style={{ padding: '14px 18px', textAlign: 'center' }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Log window */}
      <div ref={logRef} style={{
        background: '#080812',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '16px 18px',
        height: 440,
        overflow: 'auto',
        fontFamily: 'var(--font-mono)',
        fontSize: 12.5,
        lineHeight: 1.7
      }}>
        {logs.length === 0 && (
          <span style={{ color: 'var(--text-muted)' }}>Initializing Playwright…</span>
        )}
        {logs.map((log, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 10, paddingTop: 2, minWidth: 28, textAlign: 'right', flexShrink: 0 }}>
              {String(i + 1).padStart(3, '0')}
            </span>
            <span style={{ color: logColor(log) }}>
              {log.type === 'step' ? (
                <>
                  <span style={{ color: log.status === 'passed' ? 'var(--success)' : 'var(--error)', fontWeight: 700 }}>
                    {log.status === 'passed' ? '✓' : '✗'}
                  </span>
                  {' '}{log.label}
                  {log.error && <span style={{ color: 'var(--error)', opacity: 0.8 }}> — {log.error}</span>}
                </>
              ) : (
                log.text || JSON.stringify(log)
              )}
            </span>
          </div>
        ))}
        {status === 'running' && (
          <div style={{ marginTop: 4 }}>
            <span className="pulse" style={{ color: 'var(--warning)', fontSize: 16 }}>▮</span>
          </div>
        )}
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
        {logs.length} log entries
      </div>
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
