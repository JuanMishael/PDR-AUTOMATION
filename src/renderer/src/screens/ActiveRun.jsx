import { useEffect, useRef, useState } from 'react'

export default function ActiveRun({ navigate, ctx }) {
  const { profileId } = ctx
  const [logs, setLogs] = useState([])
  const [status, setStatus] = useState('idle')
  const [summary, setSummary] = useState(null)
  const [runId, setRunId] = useState(null)
  const logRef = useRef(null)

  useEffect(() => {
    if (!profileId) return

    window.api.offRunLog()
    window.api.offRunComplete()

    window.api.onRunLog((data) => {
      setLogs(prev => [...prev, data])
    })

    window.api.onRunComplete((data) => {
      setStatus(data.status)
      setSummary(data)
      setRunId(data.runId)
    })

    setStatus('running')
    setLogs([])
    setSummary(null)
    window.api.runProfile(profileId)

    return () => {
      window.api.offRunLog()
      window.api.offRunComplete()
    }
  }, [profileId])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  function stopRun() {
    if (runId) window.api.stopRun(runId)
    setStatus('stopped')
  }

  const statusColor = { running: 'var(--warning)', passed: 'var(--success)', failed: 'var(--error)', stopped: 'var(--text-muted)' }

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>Active Run</h1>
        <span style={{
          padding: '4px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.05em',
          background: `${statusColor[status]}22`, color: statusColor[status]
        }}>{status}</span>
        {status === 'running' && (
          <button className="btn-danger" style={{ marginLeft: 'auto' }} onClick={stopRun}>Stop</button>
        )}
        {(status === 'passed' || status === 'failed') && (
          <button className="btn-primary" style={{ marginLeft: 'auto' }} onClick={() => navigate('results', { runId })}>
            View Results →
          </button>
        )}
      </div>

      {summary && (
        <div className="card" style={{ display: 'flex', gap: 32, padding: '16px 24px', marginBottom: 20 }}>
          <div><div style={{ fontSize: 28, fontWeight: 800, color: 'var(--success)' }}>{summary.passed}</div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Passed</div></div>
          <div><div style={{ fontSize: 28, fontWeight: 800, color: 'var(--error)' }}>{summary.failed}</div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Failed</div></div>
          <div><div style={{ fontSize: 28, fontWeight: 800 }}>{((summary.durationMs || 0) / 1000).toFixed(1)}s</div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Duration</div></div>
        </div>
      )}

      <div ref={logRef} style={{
        background: '#0a0a14', border: '1px solid var(--border)', borderRadius: 10,
        padding: 16, height: 420, overflow: 'auto', fontFamily: 'Consolas, monospace', fontSize: 13
      }}>
        {logs.length === 0 && <span style={{ color: 'var(--text-muted)' }}>Waiting for output…</span>}
        {logs.map((log, i) => (
          <div key={i} style={{ marginBottom: 4, color: logColor(log) }}>
            {log.type === 'step' ? (
              <span>
                <span style={{ color: log.status === 'passed' ? 'var(--success)' : 'var(--error)' }}>
                  {log.status === 'passed' ? '✓' : '✗'}
                </span>
                {' '}{log.label}
                {log.error && <span style={{ color: 'var(--error)' }}> — {log.error}</span>}
              </span>
            ) : (
              <span>{log.text || JSON.stringify(log)}</span>
            )}
          </div>
        ))}
        {status === 'running' && <span style={{ color: 'var(--warning)', animation: 'blink 1s infinite' }}>▮</span>}
      </div>
    </div>
  )
}

function logColor(log) {
  if (log.type === 'error') return 'var(--error)'
  if (log.type === 'success') return 'var(--success)'
  if (log.type === 'info') return 'var(--text-muted)'
  return 'var(--text)'
}
