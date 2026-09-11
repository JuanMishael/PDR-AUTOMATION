import { useEffect, useState } from 'react'

// Drop zone for a reference image (Assert Map Changed). The alternative was a text field holding an
// absolute path — which meant the tester had to find the file, copy its path, and paste it, with no
// way to see whether they'd picked the right picture. Here they drag the capture in and look at it.
//
// The file is copied into the app's data dir on drop (see ipc/baselines), so the step keeps working
// after the original is moved or cleaned out of Downloads.
export default function ImageDrop({ value, onChange, hint }) {
  const [preview, setPreview] = useState('')
  const [state, setState] = useState('')      // '', 'over', 'missing', or an error message
  const [busy, setBusy] = useState(false)

  // Redraw whatever the step already holds. A path that no longer resolves is shown as missing
  // rather than blank — the step still carries it, and a silently empty box would hide that.
  useEffect(() => {
    let alive = true
    if (!value) { setPreview(''); setState(''); return }
    window.api.readBaselineImage(value).then(r => {
      if (!alive) return
      if (r?.dataUrl) { setPreview(r.dataUrl); setState('') }
      else { setPreview(''); setState('missing') }
    })
    return () => { alive = false }
  }, [value])

  async function adopt(promise) {
    setBusy(true)
    const r = await promise
    setBusy(false)
    if (!r || r.cancelled) return
    if (r.error) { setState(r.error); return }
    setPreview(r.dataUrl); setState('')
    onChange(r.path)
  }

  function onDrop(e) {
    e.preventDefault(); e.stopPropagation()
    setState('')
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    // The renderer can't see a dropped file's real path; only the preload's webUtils can.
    const path = window.api.pathForFile(file)
    if (!path) { setState('Could not read that file'); return }
    adopt(window.api.saveBaselineImage(path))
  }

  const border = state === 'over' ? 'var(--accent)' : state && state !== 'missing' ? 'var(--bad)' : 'var(--border)'

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div
        onDragOver={e => { e.preventDefault(); setState('over') }}
        onDragLeave={() => setState(s => (s === 'over' ? '' : s))}
        onDrop={onDrop}
        onClick={() => !busy && adopt(window.api.pickBaselineImage())}
        title={value || 'Drop an image here, or click to browse'}
        style={{
          border: `2px dashed ${border}`, borderRadius: 6, padding: preview ? 6 : 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          cursor: 'pointer', background: state === 'over' ? 'var(--accent-soft)' : 'transparent',
          minHeight: 56, textAlign: 'center'
        }}>
        {preview ? (
          <img src={preview} alt="reference"
            style={{ maxHeight: 90, maxWidth: '100%', imageRendering: 'pixelated', borderRadius: 3 }} />
        ) : (
          <span style={{ fontSize: 11, color: state === 'missing' ? 'var(--bad)' : 'var(--text-muted)' }}>
            {busy ? 'Copying…'
              : state === 'missing' ? `Image is gone from disk — drop a new one\n${value}`
              : hint || 'Drop a reference image here, or click to browse'}
          </span>
        )}
      </div>

      {state && state !== 'over' && state !== 'missing' && (
        <span style={{ fontSize: 11, color: 'var(--bad)' }}>{state}</span>
      )}

      {value && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{value}</span>
          <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }}
            onClick={() => { onChange(''); setPreview(''); setState('') }}>Clear</button>
        </div>
      )}
    </div>
  )
}
