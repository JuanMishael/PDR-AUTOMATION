import { useEffect, useState } from 'react'

export default function Results({ ctx, navigate }) {
  const { runId } = ctx
  const [run, setRun] = useState(null)
  const [results, setResults] = useState([])
  const [exporting, setExporting] = useState(null)

  useEffect(() => {
    if (!runId) return
    window.api.getHistory().then(history => {
      const r = history.find(h => h.id === runId)
      if (r) {
        setRun(r)
        setResults(JSON.parse(r.log || '[]'))
      }
    }).catch(e => alert('Could not load this run: ' + (e?.message || 'unknown error')))
  }, [runId])

  async function exportReport(format) {
    setExporting(format)
    try {
      const res = await window.api.exportReport(runId, format)
      if (res?.error) alert('Export failed: ' + res.error)
    } catch (e) {
      alert('Export failed: ' + (e?.message || 'unknown error'))
    } finally {
      setExporting(null)   // always clears the spinner, even on failure
    }
  }

  if (!runId) return (
    <div className="empty-state">
      <div className="empty-icon">◷</div>
      <p>No run selected. Go to History to pick one.</p>
      <button className="btn-ghost" onClick={() => navigate('history')}>View History</button>
    </div>
  )

  if (!run) return <p style={{ color: 'var(--text-muted)' }}>Loading…</p>

  const passed = results.filter(r => r.status === 'passed').length
  const failed = results.filter(r => r.status === 'failed').length
  const isPass = run.status === 'passed'

  return (
    <div className="fade-in" style={{ maxWidth: 900 }}>
      {/* Back to the scenario builder for this run's profile */}
      <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12, marginBottom: 14 }}
        onClick={() => navigate('scenarios', { profileId: run.profile_id, profileName: run.profile_name })}>
        ← Back to Scenarios
      </button>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 24 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800 }}>Test Results</h1>
            <span className={`badge badge-${isPass ? 'success' : 'error'}`} style={{ fontSize: 11 }}>
              {run.status}
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {run.profile_name} · {new Date(run.started_at).toLocaleString()} · {fmtDuration(run.duration_ms)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['html', 'csv', 'docx'].map(fmt => (
            <button key={fmt} className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }}
              onClick={() => exportReport(fmt)} disabled={!!exporting}>
              {exporting === fmt ? '…' : `↓ ${fmt.toUpperCase()}`}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
        {[
          { label: 'Total',    value: results.length, color: 'var(--text)' },
          { label: 'Passed',   value: passed,          color: 'var(--success)' },
          { label: 'Failed',   value: failed,          color: 'var(--error)' },
          { label: 'Duration', value: fmtDuration(run.duration_ms), color: 'var(--text)' }
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Step list */}
      <div style={{ display: 'grid', gap: 5 }}>
        {results.map((r, i) => {
          const isStepPass = r.status === 'passed'
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 14px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderLeft: `3px solid ${isStepPass ? 'var(--success)' : 'var(--error)'}`,
              borderRadius: 'var(--radius-sm)'
            }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 11, minWidth: 24, paddingTop: 1 }}>{i + 1}</span>
              <span style={{ fontSize: 14, color: isStepPass ? 'var(--success)' : 'var(--error)', flexShrink: 0 }}>
                {isStepPass ? '✓' : '✗'}
              </span>
              <span style={{ flex: 1, fontSize: 13 }}>{r.label}</span>
              {r.error && (
                <span style={{ color: 'var(--error)', fontSize: 11, maxWidth: 280, textAlign: 'right' }}>{r.error}</span>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        {run.trace_path && (
          <button className="btn-ghost"
            onClick={() => window.api.openTraceViewer(run.trace_path)}>
            🔍 Open Trace Viewer
          </button>
        )}
        {run.network_path && (
          <button className="btn-ghost"
            onClick={() => window.api.openNetworkLog(run.id)}>
            🌐 View Network Log
          </button>
        )}
      </div>
    </div>
  )
}

function fmtDuration(ms) {
  if (!ms) return '0s'
  return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`
}
