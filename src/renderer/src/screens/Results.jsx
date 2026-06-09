import { useEffect, useState } from 'react'

export default function Results({ ctx }) {
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
    })
  }, [runId])

  async function exportReport(format) {
    setExporting(format)
    await window.api.exportReport(runId, format)
    setExporting(null)
  }

  if (!run) return <p style={{ color: 'var(--text-muted)' }}>No run selected.</p>

  const passed = results.filter(r => r.status === 'passed').length
  const failed = results.filter(r => r.status === 'failed').length

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Test Results</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: 2 }}>{run.profile_name} · {new Date(run.started_at).toLocaleString()}</p>
        </div>
        <span className={`badge badge-${run.status === 'passed' ? 'success' : 'error'}`} style={{ fontSize: 13 }}>
          {run.status}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {['html', 'csv', 'docx'].map(fmt => (
            <button key={fmt} className="btn-ghost" style={{ padding: '6px 14px', fontSize: 12 }}
              onClick={() => exportReport(fmt)} disabled={!!exporting}>
              {exporting === fmt ? '…' : `↓ ${fmt.toUpperCase()}`}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, marginBottom: 24 }}>
        {[
          { label: 'Total', value: results.length, color: 'var(--text)' },
          { label: 'Passed', value: passed, color: 'var(--success)' },
          { label: 'Failed', value: failed, color: 'var(--error)' },
          { label: 'Duration', value: `${((run.duration_ms || 0) / 1000).toFixed(1)}s`, color: 'var(--text)' }
        ].map(stat => (
          <div key={stat.label} className="card" style={{ flex: 1, textAlign: 'center', padding: '16px 12px' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        {results.map((r, i) => (
          <div key={i} className="card" style={{
            padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12,
            borderLeft: `3px solid ${r.status === 'passed' ? 'var(--success)' : 'var(--error)'}`
          }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 12, minWidth: 24 }}>{i + 1}</span>
            <span className={`badge badge-${r.status === 'passed' ? 'success' : 'error'}`}>{r.status}</span>
            <span style={{ flex: 1 }}>{r.label}</span>
            {r.error && <span style={{ color: 'var(--error)', fontSize: 12 }}>{r.error}</span>}
          </div>
        ))}
      </div>

      {run.trace_path && (
        <button className="btn-ghost" style={{ marginTop: 16 }}
          onClick={() => window.api.openTraceViewer(run.trace_path)}>
          🔍 Open Trace Viewer
        </button>
      )}
    </div>
  )
}
