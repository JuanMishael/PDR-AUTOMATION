import { useRef, useState, useMemo } from 'react'
import { TOKEN_GROUPS } from '../lib/tokens'

// A text input (or textarea) with a {{ }} Token Picker button beside it. Picking a
// token inserts it at the caret — so a tester can build "Hi {{faker.person.firstName}}!"
// without memorizing any syntax. Used in the step editor and the Test Data screen.
//
// Props mirror a plain <input>: value, onChange(nextString), placeholder, style.
// Set multiline for a <textarea>. Resolution happens later in the main process
// (tokenResolver.js); this component only writes the token text.
export default function TokenField({ value = '', onChange, placeholder, style, multiline, rows = 3, extraGroups = [], ...rest }) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)

  function insert(token) {
    const el = ref.current
    const start = el && el.selectionStart != null ? el.selectionStart : String(value).length
    const end = el && el.selectionEnd != null ? el.selectionEnd : start
    const next = String(value).slice(0, start) + token + String(value).slice(end)
    onChange(next)
    setOpen(false)
    // Restore focus + drop the caret right after the inserted token, post-render.
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const pos = start + token.length
      try { el.setSelectionRange(pos, pos) } catch { /* number inputs etc. */ }
    })
  }

  const fieldStyle = { fontFamily: 'var(--font-mono)', fontSize: 12, flex: 1, minWidth: 0, ...style }

  return (
    <div style={{ position: 'relative', display: 'flex', gap: 4, alignItems: multiline ? 'flex-start' : 'center' }}>
      {multiline ? (
        <textarea ref={ref} rows={rows} value={value} placeholder={placeholder}
          onChange={e => onChange(e.target.value)} style={{ ...fieldStyle, resize: 'vertical' }} {...rest} />
      ) : (
        <input ref={ref} value={value} placeholder={placeholder}
          onChange={e => onChange(e.target.value)} style={fieldStyle} {...rest} />
      )}
      <button type="button" className="btn btn-sm" title="Insert a dynamic token"
        onClick={() => setOpen(o => !o)}
        style={{ flexShrink: 0, padding: '4px 8px', fontFamily: 'var(--font-mono)', fontSize: 12,
          background: open ? 'var(--accent-soft)' : undefined, borderColor: open ? 'var(--accent)' : undefined }}>
        {'{ }'}
      </button>
      {open && <TokenMenu onPick={insert} onClose={() => setOpen(false)} extraGroups={extraGroups} />}
    </div>
  )
}

function TokenMenu({ onPick, onClose, extraGroups = [] }) {
  const [q, setQ] = useState('')

  // Caller-supplied groups (e.g. Test Data {{Collection.field}} tokens) come first.
  const allGroups = useMemo(() => [...extraGroups, ...TOKEN_GROUPS], [extraGroups])

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return allGroups
    return allGroups
      .map(g => ({
        ...g,
        tokens: g.tokens.filter(t =>
          t.token.toLowerCase().includes(needle) ||
          t.label.toLowerCase().includes(needle) ||
          t.desc.toLowerCase().includes(needle))
      }))
      .filter(g => g.tokens.length)
  }, [q])

  return (
    <>
      {/* click-away catcher, mirrors the export-menu pattern in TestData */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
      <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 50, marginTop: 4, width: 320, maxHeight: 360,
        display: 'flex', flexDirection: 'column', background: 'var(--surface, #fff)',
        border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.2)', overflow: 'hidden' }}>
        <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)}
            placeholder="🔍 Search tokens — name, email, sentence…"
            style={{ width: '100%', fontSize: 12 }} />
        </div>
        <div style={{ overflow: 'auto', padding: '4px 0' }}>
          {groups.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--ink-soft)', textAlign: 'center', padding: 16, margin: 0 }}>No matching tokens.</p>
          )}
          {groups.map(g => (
            <div key={g.name}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                color: 'var(--ink-soft)', padding: '8px 12px 4px' }}>{g.name}</div>
              {g.tokens.map(t => (
                <button key={t.token} type="button" onClick={() => onPick(t.token)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px',
                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-soft)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-ink, var(--ink))' }}>{t.token}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{t.label} — {t.desc}</div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
