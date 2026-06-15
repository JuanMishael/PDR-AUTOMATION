import { useEffect, useState } from 'react'

const EMPTY = { name: '', type: 'web', base_url: '', browser: 'chromium', headless: false, timeout: 30000 }

export default function ProfileConfig({ navigate }) {
  const [profiles, setProfiles] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    try {
      setProfiles(await window.api.getProfiles())
    } catch (e) {
      alert('Could not load profiles: ' + (e?.message || 'unknown error'))
    }
  }

  function edit(p) {
    setEditing(p.id)
    setForm({ name: p.name, type: p.type, base_url: p.base_url, browser: p.browser, headless: !!p.headless, timeout: p.timeout })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function reset() {
    setEditing(null)
    setForm(EMPTY)
  }

  async function save() {
    if (!form.name || !form.base_url) return
    setSaving(true)
    try {
      await window.api.saveProfile(editing ? { ...form, id: editing } : form)
      reset()
      await load()
    } catch (e) {
      alert('Could not save profile: ' + (e?.message || 'unknown error'))
    } finally {
      setSaving(false)   // always clears, even on failure
    }
  }

  async function del(id) {
    if (!confirm('Delete this profile and all its scenarios?')) return
    try {
      await window.api.deleteProfile(id)
      if (editing === id) reset()
      await load()
    } catch (e) {
      alert('Could not delete profile: ' + (e?.message || 'unknown error'))
    }
  }

  function field(key, value) {
    setForm(f => ({ ...f, [key]: value }))
  }

  const isValid = form.name.trim() && form.base_url.trim()

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1>{editing ? 'Edit Profile' : 'New Profile'}</h1>
        <p>Configure a test target — browser, URL, and timeout settings.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, maxWidth: 900 }}>
        {/* Form */}
        <div className="card">
          <div style={{ display: 'grid', gap: 14 }}>
            <div>
              <label>Profile Name *</label>
              <input value={form.name} onChange={e => field('name', e.target.value)}
                placeholder="e.g. PPGIS Staging" />
            </div>
            <div>
              <label>Base URL *</label>
              <input value={form.base_url} onChange={e => field('base_url', e.target.value)}
                placeholder="https://staging.example.com" />
            </div>
            <div>
              <label>Browser</label>
              <select value={form.browser} onChange={e => field('browser', e.target.value)}>
                <option value="chromium">Chromium</option>
                <option value="firefox">Firefox</option>
                <option value="webkit">WebKit</option>
              </select>
            </div>
            <div>
              <label>Step Timeout (ms)</label>
              <input type="number" value={form.timeout} min={1000} step={1000}
                onChange={e => field('timeout', Number(e.target.value))} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row',
              textTransform: 'none', letterSpacing: 'normal', fontWeight: 500, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.headless} style={{ width: 'auto' }}
                onChange={e => field('headless', e.target.checked)} />
              Run headless (no visible browser window)
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button className="btn-primary" onClick={save} disabled={saving || !isValid}>
                {saving ? 'Saving…' : editing ? '✓ Update Profile' : '+ Create Profile'}
              </button>
              {editing && <button className="btn-ghost" onClick={reset}>Cancel</button>}
            </div>
          </div>
        </div>

        {/* Profile list */}
        <div>
          <h2 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            Saved Profiles ({profiles.length})
          </h2>
          {profiles.length === 0 ? (
            <div className="card empty-state" style={{ padding: 32 }}>
              <div className="empty-icon" style={{ fontSize: 28 }}>⊡</div>
              <p style={{ margin: 0 }}>No profiles yet.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {profiles.map(p => (
                <div key={p.id} className="card" style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 6, background: 'var(--accent-dim)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 800, color: 'var(--accent)', flexShrink: 0
                    }}>{p.name.slice(0, 2).toUpperCase()}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.browser} · {p.base_url}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => edit(p)}>Edit</button>
                    <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }}
                      onClick={() => navigate('scenarios', { profileId: p.id, profileName: p.name })}>
                      Scenarios
                    </button>
                    <button className="btn-danger" style={{ padding: '4px 10px', fontSize: 11, marginLeft: 'auto' }} onClick={() => del(p.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
