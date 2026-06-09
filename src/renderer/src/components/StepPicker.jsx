import { useState } from 'react'
import { ACTIONS_BY_CATEGORY, ACTION_CATEGORIES } from './actionDefs'

export default function StepPicker({ onPick, onClose }) {
  const [activeCategory, setActiveCategory] = useState(ACTION_CATEGORIES[0])
  const [search, setSearch] = useState('')

  const filtered = search
    ? Object.values(ACTIONS_BY_CATEGORY).flat().filter(a =>
        a.label.toLowerCase().includes(search.toLowerCase()) ||
        a.category.toLowerCase().includes(search.toLowerCase())
      )
    : ACTIONS_BY_CATEGORY[activeCategory]

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }} onClick={onClose}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
        width: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden'
      }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '20px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Add Step</h2>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20 }}>×</button>
          </div>
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search actions…" style={{ marginBottom: 14 }} />
          {!search && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
              {ACTION_CATEGORIES.map(cat => (
                <button key={cat} onClick={() => setActiveCategory(cat)}
                  style={{
                    padding: '5px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                    background: activeCategory === cat ? 'var(--accent)' : 'var(--surface2)',
                    color: activeCategory === cat ? '#fff' : 'var(--text-muted)',
                    border: 'none'
                  }}>{cat}</button>
              ))}
            </div>
          )}
        </div>
        <div style={{ overflow: 'auto', padding: '8px 20px 20px' }}>
          {filtered.map(action => (
            <button key={action.key} onClick={() => onPick(action.key)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px',
                background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: 8, marginBottom: 6, color: 'var(--text)'
              }}>
              <div style={{ fontWeight: 600 }}>{action.label}</div>
              {action.params?.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {action.params.map(p => p.label).join(' · ')}
                </div>
              )}
            </button>
          ))}
          {filtered.length === 0 && (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>No matching actions.</p>
          )}
        </div>
      </div>
    </div>
  )
}
