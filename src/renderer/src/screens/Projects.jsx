import { useEffect, useState } from 'react'
import { Icon } from '../components/SketchDefs'
import { confirmDialog } from '../lib/confirm'

// A Project is a folder grouping profiles (like a Visual Studio solution's projects). This is the
// landing screen: pick a project to work inside, or run / share a whole project at once.
function ProjectCard({ project, profiles, navigate, onExport, onDelete }) {
  const count = profiles.length
  const webRunnable = profiles.filter(p => p.type !== 'api').map(p => p.id)

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: 'var(--accent-soft)', border: '2px solid var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-hand)', fontSize: 20, color: 'var(--accent-ink)'
        }}>📁</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-hand)', fontSize: 19, color: 'var(--ink)', lineHeight: 1.1 }}>
            {project.name}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.description || `${count} profile${count !== 1 ? 's' : ''}`}
          </div>
        </div>
        <span style={{ fontFamily: 'var(--font-hand)', fontSize: 15, color: 'var(--ink-soft)', flexShrink: 0 }}>
          {count} profile{count !== 1 ? 's' : ''}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
        <button className="btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center', minWidth: 110 }}
          onClick={() => navigate('dashboard', { projectId: project.id, projectName: project.name })}>
          <Icon name="dashboard" size={15} fill /> Open
        </button>
        <button className="btn btn-sm" style={{ flex: 1, justifyContent: 'center', minWidth: 90 }}
          disabled={webRunnable.length === 0}
          title={webRunnable.length === 0 ? 'No web profiles to run' : `Run all ${webRunnable.length} web profiles in parallel`}
          onClick={() => navigate('parallel', { profileIds: webRunnable, projectId: project.id, projectName: project.name })}>
          <Icon name="run" size={14} fill /> Run all
        </button>
        <button className="btn btn-sm" style={{ justifyContent: 'center' }}
          onClick={() => onExport(project)} title="Export this whole project (profiles + test data) to a file">
          ⬆ Export
        </button>
        <button className="btn-danger btn-sm" style={{ justifyContent: 'center' }}
          onClick={() => onDelete(project)} title="Delete this project and all its profiles">
          Delete
        </button>
      </div>
    </div>
  )
}

export default function Projects({ navigate }) {
  const [projects, setProjects] = useState([])
  const [profilesByProject, setProfilesByProject] = useState({})
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [msg, setMsg] = useState(null)

  async function load() {
    const [projs, profs] = await Promise.all([window.api.getProjects(), window.api.getProfiles()])
    setProjects(projs)
    const grouped = {}
    for (const p of profs) (grouped[p.project_id] ||= []).push(p)
    setProfilesByProject(grouped)
  }

  useEffect(() => { load() }, [])

  function flash(text) { setMsg(text); setTimeout(() => setMsg(null), 4000) }

  async function createProject() {
    const name = newName.trim()
    if (!name) return
    await window.api.saveProject({ name })
    setNewName(''); setCreating(false)
    await load()
  }

  async function exportProject(project) {
    const res = await window.api.exportProject(project.id)
    flash(res?.ok ? `✓ Exported "${project.name}" (${res.profileCount} profile${res.profileCount !== 1 ? 's' : ''})` : `✗ ${res?.error || 'Export failed'}`)
  }

  async function importProject() {
    const res = await window.api.importProject()
    if (res?.cancelled) return
    if (res?.ok) { flash(`✓ Imported "${res.name}" (${res.profileCount} profile${res.profileCount !== 1 ? 's' : ''})`); await load() }
    else flash(`✗ ${res?.error || 'Import failed'}`)
  }

  async function deleteProject(project) {
    const n = (profilesByProject[project.id] || []).length
    const warn = n > 0 ? ` and its ${n} profile${n !== 1 ? 's' : ''} (scenarios, steps and all)` : ''
    if (!(await confirmDialog(`Delete project "${project.name}"${warn}?`, { confirmText: 'Delete' }))) return
    await window.api.deleteProject(project.id)
    await load()
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1>Projects</h1>
        <p>{projects.length} project{projects.length !== 1 ? 's' : ''} — a project groups related profiles, like a solution holds its projects</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <h2 className="eyebrow" style={{ marginRight: 'auto' }}>Your Projects</h2>
        {msg && <span style={{ fontSize: 12, color: msg.startsWith('✓') ? 'var(--ok)' : 'var(--bad)' }}>{msg}</span>}
        <button className="btn btn-sm" onClick={importProject} title="Import a project shared by another QA (.json)">
          ⬇ Import Project
        </button>
        <button className="btn btn-sm" onClick={() => setCreating(c => !c)}>
          <Icon name="plus" size={15} /> New Project
        </button>
      </div>

      {creating && (
        <div className="card" style={{ display: 'flex', gap: 8, padding: 12, marginBottom: 14, alignItems: 'center' }}>
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createProject(); if (e.key === 'Escape') { setCreating(false); setNewName('') } }}
            placeholder="Project name — e.g. PPGIS" style={{ flex: 1 }} />
          <button className="btn-primary btn-sm" onClick={createProject} disabled={!newName.trim()}>Create</button>
          <button className="btn-ghost btn-sm" onClick={() => { setCreating(false); setNewName('') }}>Cancel</button>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon" style={{ fontSize: 36 }}>📁</div>
          <p>No projects yet. Create one to start grouping profiles.</p>
          <button className="btn-primary" onClick={() => setCreating(true)}>+ Create Project</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 14 }}>
          {projects.map(p => (
            <ProjectCard key={p.id} project={p} profiles={profilesByProject[p.id] || []}
              navigate={navigate} onExport={exportProject} onDelete={deleteProject} />
          ))}
        </div>
      )}
    </div>
  )
}
