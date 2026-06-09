import { useEffect, useState } from 'react'

const EMPTY = { name: '', type: 'web', base_url: '', browser: 'chromium', headless: false, timeout: 30000 }

export default function ProfileConfig({ navigate }) {
  const [profiles, setProfiles] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setProfiles(await window.api.getProfiles())
  }

  function edit(p) {
    setEditing(p.id)
    setForm({ name: p.name, type: p.type, base_url: p.base_url, browser: p.browser, headless: !!p.headless, timeout: p.timeout })
  }

  function reset() {
    setEditing(null)
    setForm(EMPTY)
  }

  async function save() {
    if (!form.name || !form.base_url) return
    setSaving(true)
    await window.api.saveProfile(editing ? { ...form, id: editing } : form)
    setSaving(false)
    reset()
    load()
  }

  async function del(id) {
    if (!confirm('Delete this profile and all its scenarios?')) return
    await window.api.deleteProfile(id)
    load()
  }

  return (
    <div style={{ maxWidth: 860, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 20 }}>
          {editing ? 'Edit Profile' : 'New Profile'}
        </h1>
        <div className="card" style={{ display: 'grid', gap: 16 }}>
          <div>
            <label>Profile Name</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. PPGIS Staging" />
          </div>
          <div>
            <label>Base URL</label>
            <input value={form.base_url} onChange={e => setForm({ ...form, base_url: e.target.value })} placeholder="https://staging.example.com" />
          </div>
          <div>
            <label>Browser</label>
            <select value={form.browser} onChange={e => setForm({ ...form, browser: e.target.value })}>
              <option value="chromium">Chromium</option>
              <option value="firefox">Firefox</option>
              <option value="webkit">WebKit</option>
            </select>
          </div>
          <div>
            <label>Timeout (ms)</label>
            <input type="number" value={form.timeout} onChange={e => setForm({ ...form, timeout: Number(e.target.value) })} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row', textTransform: 'none', letterSpacing: 'normal' }}>
            <input type="checkbox" checked={form.headless} onChange={e => setForm({ ...form, headless: e.target.checked })} style={{ width: 'auto' }} />
            Run headless (no browser window)
          </label>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button className="btn-primary" onClick={save} disabled={saving || !form.name || !form.base_url}>
              {saving ? 'Saving…' : editing ? 'Update Profile' : 'Create Profile'}
            </button>
            {editing && <button className="btn-ghost" onClick={reset}>Cancel</button>}
          </div>
        </div>
      </div>

      <div>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Saved Profiles</h2>
        {profiles.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No profiles yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {profiles.map(p => (
              <div key={p.id} className="card" style={{ padding: '14px 16px' }}>
                <div style={{ fontWeight: 700 }}>{p.name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12, margin: '4px 0 10px' }}>
                  {p.browser} · {p.base_url}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => edit(p)}>Edit</button>
                  <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 12 }}
                    onClick={() => navigate('scenarios', { profileId: p.id, profileName: p.name })}>
                    Scenarios
                  </button>
                  <button className="btn-danger" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => del(p.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
