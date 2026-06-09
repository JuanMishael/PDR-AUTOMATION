import { useEffect, useState } from 'react'

export default function HealthCheck() {
  const [results, setResults] = useState(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => { check() }, [])

  async function check() {
    setChecking(true)
    setResults(null)
    const r = await window.api.checkHealth()
    setResults(r)
    setChecking(false)
  }

  const ITEMS = [
    { key: 'node', label: 'Node.js', desc: 'Runtime environment' },
    { key: 'chromium', label: 'Chromium', desc: 'Playwright browser' },
    { key: 'firefox', label: 'Firefox', desc: 'Playwright browser' },
    { key: 'webkit', label: 'WebKit', desc: 'Playwright browser' }
  ]

  return (
    <div style={{ maxWidth: 600 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>Health Check</h1>
        <button className="btn-ghost" onClick={check} disabled={checking}>
          {checking ? 'Checking…' : '↻ Re-check'}
        </button>
      </div>

      {checking && <p style={{ color: 'var(--text-muted)' }}>Running checks…</p>}

      {results && (
        <div style={{ display: 'grid', gap: 10 }}>
          {ITEMS.map(item => {
            const r = results[item.key]
            const ok = r?.ok !== false
            return (
              <div key={item.key} className="card" style={{
                display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px',
                borderLeft: `3px solid ${ok ? 'var(--success)' : 'var(--error)'}`
              }}>
                <span style={{ fontSize: 20 }}>{ok ? '✓' : '✗'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{item.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {r?.version ? `v${r.version}` : item.desc}
                    {r?.error ? ` — ${r.error}` : ''}
                  </div>
                </div>
                <span className={`badge badge-${ok ? 'success' : 'error'}`}>{ok ? 'OK' : 'MISSING'}</span>
              </div>
            )
          })}

          {!results.overall && (
            <div className="card" style={{ borderLeft: '3px solid var(--warning)', padding: '16px 20px', marginTop: 8 }}>
              <div style={{ fontWeight: 700, color: 'var(--warning)', marginBottom: 8 }}>Some components need setup</div>
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                Run <code style={{ background: 'var(--surface2)', padding: '1px 6px', borderRadius: 4 }}>npx playwright install</code> to install missing browsers.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
