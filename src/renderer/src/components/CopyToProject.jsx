import { useEffect, useRef, useState } from 'react'

// "Share to another project": copy a profile (+ its scenarios/steps) into a different project.
// Renders a button that drops down the list of other projects; picking one does the copy.
export default function CopyToProject({ profileId, currentProjectId, className = 'btn btn-sm', label = '→ Copy to project', onDone }) {
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState([])
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    window.api.getProjects().then(setProjects)
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const targets = projects.filter(p => p.id !== currentProjectId)

  async function copy(p) {
    setOpen(false)
    const res = await window.api.copyProfileToProject(profileId, p.id)
    onDone?.(res?.error ? `✗ ${res.error}` : `✓ Copied to ${p.name}`)
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button className={className} onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        title="Copy this profile (scenarios + steps) into another project">{label}</button>
      {open && (
        <div className="card" style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 50,
          minWidth: 180, padding: 6, display: 'grid', gap: 2, maxHeight: 240, overflow: 'auto' }}>
          {targets.length === 0
            ? <div style={{ fontSize: 12, color: 'var(--ink-soft)', padding: '6px 8px' }}>No other projects</div>
            : targets.map(p => (
                <button key={p.id} className="btn-ghost btn-sm" style={{ justifyContent: 'flex-start', width: '100%' }}
                  onClick={e => { e.stopPropagation(); copy(p) }}>📁 {p.name}</button>
              ))}
        </div>
      )}
    </div>
  )
}
