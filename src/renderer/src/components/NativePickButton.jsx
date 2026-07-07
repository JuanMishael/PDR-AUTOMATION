import { useState } from 'react'

// Authoring aid for native Android steps: snapshots the phone's CURRENT screen and lists its
// pickable elements. Click one → fills the step's strategy + locator. Removes the manual
// `adb uiautomator dump` + read-the-XML dance.
export default function NativePickButton({ onPick }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [elements, setElements] = useState([])
  const [q, setQ] = useState('')

  async function load() {
    setOpen(true); setLoading(true); setError(''); setElements([])
    const res = await window.api.nativePickElements()
    setLoading(false)
    if (res?.error) setError(res.error)
    else setElements(res?.elements || [])
  }

  const kind = e => e.editable ? 'input' : e.clickable ? 'tap' : 'text'
  const shown = elements.filter(e =>
    !q || `${e.label} ${e.locator} ${e.cls}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '3px 8px', whiteSpace: 'nowrap' }}
        title="Snapshot the phone's current screen and pick an element" onClick={load}>
        📱 Pick from screen
      </button>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} className="card" style={{ width: 560, maxWidth: '92vw',
            maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontFamily: 'var(--font-hand)', fontSize: 18 }}>Pick an element</strong>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>from the phone's current screen</span>
              <button className="btn-ghost" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={load}>↻ Re-scan</button>
              <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setOpen(false)}>✕</button>
            </div>

            {loading && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Reading the screen…</div>}

            {error && (
              <div className="card" style={{ borderColor: 'var(--warn-line)', background: 'var(--warn-bg)', fontSize: 12.5 }}>
                {error}
                <div style={{ color: 'var(--text-muted)', marginTop: 6 }}>
                  Make sure the phone is connected (<code>adb devices</code>) and the screen you want is open.
                </div>
              </div>
            )}

            {!loading && !error && (
              <>
                <input autoFocus value={q} onChange={e => setQ(e.target.value)}
                  placeholder={`Filter ${elements.length} elements…`} style={{ fontSize: 12 }} />
                <div style={{ overflowY: 'auto', display: 'grid', gap: 4 }}>
                  {shown.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No matching elements.</div>}
                  {shown.map((e, i) => (
                    <button key={i} type="button" className="btn-ghost"
                      onClick={() => { onPick(e.strategy, e.locator); setOpen(false) }}
                      style={{ display: 'grid', gridTemplateColumns: '48px 1fr', gap: 8, textAlign: 'left',
                        padding: '6px 8px', alignItems: 'center' }}>
                      <span className="badge" style={{ fontSize: 9, justifySelf: 'start' }}>{kind(e)}</span>
                      <span style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e.strategy}: {e.locator}
                        </div>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
