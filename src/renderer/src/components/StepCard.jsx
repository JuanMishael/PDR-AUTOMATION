import { useState } from 'react'
import { ACTION_DEFS } from './actionDefs'

export default function StepCard({ step, index, total, onChange, onDelete, onMove }) {
  const [expanded, setExpanded] = useState(false)
  const def = ACTION_DEFS[step.action] || { label: step.action, params: [] }
  const params = typeof step.params === 'string' ? JSON.parse(step.params) : (step.params || {})

  function updateParam(key, value) {
    onChange({ ...step, params: { ...params, [key]: value } })
  }

  function updateLabel(value) {
    onChange({ ...step, label: value })
  }

  const statusColor = {
    passed: 'var(--success)',
    failed: 'var(--error)',
    running: 'var(--warning)'
  }[step.runStatus] || 'var(--border)'

  return (
    <div className="card" style={{ padding: 0, borderLeft: `3px solid ${statusColor}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}>
        <span style={{ color: 'var(--text-muted)', fontSize: 12, minWidth: 24 }}>{index + 1}</span>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
          color: 'var(--accent)', background: 'rgba(108,99,255,0.1)', padding: '2px 8px', borderRadius: 4 }}>
          {def.label || step.action}
        </span>
        <span style={{ flex: 1, color: 'var(--text-muted)', fontSize: 13 }}>
          {step.label || def.summary?.(params) || ''}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={e => { e.stopPropagation(); onMove(step.id, 'up') }} disabled={index === 0}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '2px 6px' }}>↑</button>
          <button onClick={e => { e.stopPropagation(); onMove(step.id, 'down') }} disabled={index === total - 1}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '2px 6px' }}>↓</button>
          <button onClick={e => { e.stopPropagation(); onDelete(step.id) }}
            style={{ background: 'none', border: 'none', color: 'var(--error)', padding: '2px 8px', fontSize: 16 }}>×</button>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)', marginTop: 0 }}>
          <div style={{ marginTop: 12, marginBottom: 12 }}>
            <label>Step Label (optional)</label>
            <input value={step.label || ''} onChange={e => updateLabel(e.target.value)} placeholder="Describe this step" />
          </div>
          {def.params.map(p => (
            <div key={p.key} style={{ marginBottom: 10 }}>
              <label>{p.label}</label>
              {p.type === 'boolean' ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row',
                  textTransform: 'none', letterSpacing: 'normal', fontWeight: 400 }}>
                  <input type="checkbox" checked={!!params[p.key]}
                    onChange={e => updateParam(p.key, e.target.checked)} style={{ width: 'auto' }} />
                  {p.label}
                </label>
              ) : p.type === 'select' ? (
                <select value={params[p.key] || p.default || ''} onChange={e => updateParam(p.key, e.target.value)}>
                  {p.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : p.type === 'textarea' ? (
                <textarea rows={3} value={params[p.key] || ''} placeholder={p.placeholder || ''}
                  onChange={e => updateParam(p.key, e.target.value)} />
              ) : (
                <input type={p.type || 'text'} value={params[p.key] || ''} placeholder={p.placeholder || ''}
                  onChange={e => updateParam(p.key, e.target.value)} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
