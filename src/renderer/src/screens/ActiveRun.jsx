import { useEffect, useRef, useState } from 'react'

export default function ActiveRun({ navigate, ctx }) {
  const { profileId, scenarioId, scenarioName } = ctx
  const [logs, setLogs] = useState([])
  const [status, setStatus] = useState('running')
  const [summary, setSummary] = useState(null)
  const [runId, setRunId] = useState(null)
  const logRef = useRef(null)

  useEffect(() => {
    if (!profileId) return

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

    const runPromise = scenarioId
      ? window.api.runScenario(profileId, scenarioId)
      : window.api.runProfile(profileId)
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
  }, [profileId, scenarioId])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  function stopRun() {
    if (runId) window.api.stopRun(runId)
    setStatus('stopped')
  }

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
        {(status === 'passed' || status === 'failed') && runId && (
          <button className="btn-primary" onClick={() => navigate('results', { runId })}>
            View Results →
          </button>
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
