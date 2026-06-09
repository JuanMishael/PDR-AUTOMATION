import { useEffect, useState } from 'react'

const DEFAULTS = {
  app_name: 'AutomationTool', browser: 'chromium', headless: '0',
  default_timeout: '30000', history_retention_days: '30',
  screenshot_on_fail: '1', trace_on_fail: '1'
}

export default function Settings() {
  const [settings, setSettings] = useState(DEFAULTS)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.api.getSettings().then(s => setSettings({ ...DEFAULTS, ...s }))
  }, [])

  function set(key, value) {
    setSettings(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function save() {
    await window.api.saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ maxWidth: 540 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>Settings</h1>
        {saved && <span style={{ color: 'var(--success)', fontSize: 13 }}>✓ Saved</span>}
      </div>

      <div className="card" style={{ display: 'grid', gap: 18 }}>
        <div>
          <label>App Name</label>
          <input value={settings.app_name} onChange={e => set('app_name', e.target.value)} />
        </div>
        <div>
          <label>Default Browser</label>
          <select value={settings.browser} onChange={e => set('browser', e.target.value)}>
            <option value="chromium">Chromium</option>
            <option value="firefox">Firefox</option>
            <option value="webkit">WebKit</option>
          </select>
        </div>
        <div>
          <label>Default Timeout (ms)</label>
          <input type="number" value={settings.default_timeout} onChange={e => set('default_timeout', e.target.value)} />
        </div>
        <div>
          <label>History Retention (days)</label>
          <input type="number" value={settings.history_retention_days} onChange={e => set('history_retention_days', e.target.value)} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row', textTransform: 'none', letterSpacing: 'normal' }}>
          <input type="checkbox" checked={settings.headless === '1'} style={{ width: 'auto' }}
            onChange={e => set('headless', e.target.checked ? '1' : '0')} />
          Run headless by default
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row', textTransform: 'none', letterSpacing: 'normal' }}>
          <input type="checkbox" checked={settings.screenshot_on_fail === '1'} style={{ width: 'auto' }}
            onChange={e => set('screenshot_on_fail', e.target.checked ? '1' : '0')} />
          Screenshot on step failure
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row', textTransform: 'none', letterSpacing: 'normal' }}>
          <input type="checkbox" checked={settings.trace_on_fail === '1'} style={{ width: 'auto' }}
            onChange={e => set('trace_on_fail', e.target.checked ? '1' : '0')} />
          Record trace on failure (Playwright Trace Viewer)
        </label>
        <button className="btn-primary" style={{ marginTop: 4 }} onClick={save}>Save Settings</button>
      </div>
    </div>
  )
}
