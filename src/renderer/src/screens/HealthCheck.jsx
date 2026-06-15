import { useEffect, useState } from 'react'

const CHECKS = [
  { key: 'node',      label: 'Node.js',   desc: 'Runtime environment',    icon: '⬡' },
  { key: 'chromium',  label: 'Chromium',  desc: 'Playwright browser',     icon: '◉' },
  { key: 'firefox',   label: 'Firefox',   desc: 'Playwright browser',     icon: '◉' },
  { key: 'webkit',    label: 'WebKit',    desc: 'Playwright browser',     icon: '◉' }
]

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

  const allOk = results?.overall

  return (
    <div className="fade-in" style={{ maxWidth: 600 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <div className="page-header" style={{ marginBottom: 0, flex: 1 }}>
          <h1>Health Check</h1>
          <p>Verify Playwright and browser dependencies</p>
        </div>
        <button className="btn-ghost" onClick={check} disabled={checking}>
          {checking ? <><span className="pulse">●</span> Checking…</> : '↻ Re-check'}
        </button>
      </div>

      {/* Overall status banner */}
      {results && (
        <div style={{
          padding: '12px 18px', borderRadius: 'var(--radius)', marginBottom: 20,
          background: allOk ? 'var(--success-dim)' : 'var(--warning-dim)',
          border: `1px solid ${allOk ? 'rgba(34,197,94,0.2)' : 'rgba(245,158,11,0.2)'}`,
          display: 'flex', alignItems: 'center', gap: 10
        }}>
          <span style={{ fontSize: 18 }}>{allOk ? '✓' : '⚠'}</span>
          <span style={{ fontWeight: 700, color: allOk ? 'var(--success)' : 'var(--warning)' }}>
            {allOk ? 'All systems operational' : 'Some dependencies need attention'}
          </span>
        </div>
      )}

      {checking && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          <span className="pulse" style={{ fontSize: 24 }}>◎</span>
          <p style={{ marginTop: 12 }}>Running checks…</p>
        </div>
      )}

      {results && (
        <div style={{ display: 'grid', gap: 8 }}>
          {CHECKS.map(item => {
            const r = results[item.key]
            const ok = r?.ok !== false
            return (
              <div key={item.key} className="card" style={{
                display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px',
                borderLeft: `3px solid ${ok ? 'var(--success)' : 'var(--error)'}`
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                  background: ok ? 'var(--success-dim)' : 'var(--error-dim)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, color: ok ? 'var(--success)' : 'var(--error)'
                }}>
                  {ok ? '✓' : '✗'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {r?.version ? `v${r.version}` : item.desc}
                    {r?.error ? ` — ${r.error}` : ''}
                  </div>
                </div>
                <span className={`badge badge-${ok ? 'success' : 'error'}`}>
                  {ok ? 'OK' : 'MISSING'}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {results && !allOk && (
        <div className="card" style={{ marginTop: 16, borderLeft: '3px solid var(--warning)', padding: '16px 20px' }}>
          <div style={{ fontWeight: 700, color: 'var(--warning)', marginBottom: 8 }}>Fix missing browsers</div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8 }}>
            Run this command in your terminal to install missing Playwright browsers:
          </p>
          <code style={{
            display: 'block', background: 'var(--surface2)', padding: '8px 12px',
            borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: 13,
            color: 'var(--accent)'
          }}>
            npx playwright install
          </code>
        </div>
      )}
    </div>
  )
}
