import { useEffect, useState } from 'react'
import { confirmDialog } from '../lib/confirm'

const DEFAULTS = {
  app_name: 'PDR-AUTOMATION', browser: 'chromium', headless: '0',
  default_timeout: '30000', history_retention_days: '30',
  screenshot_on_fail: '1', trace_on_fail: '1',
  settle_before_action: '1', settle_timeout: '3000'
}

export default function Settings() {
  const [settings, setSettings] = useState(DEFAULTS)
  const [saved, setSaved] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [sessionMsg, setSessionMsg] = useState('')

  useEffect(() => {
    window.api.getSettings()
      .then(s => setSettings({ ...DEFAULTS, ...s }))
      .catch(() => { /* keep defaults if settings can't be read */ })
  }, [])

  function set(key, value) {
    setSettings(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function save() {
    try {
      await window.api.saveSettings(settings)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      alert('Could not save settings: ' + (e?.message || 'unknown error'))
    }
  }

  async function clearSession() {
    if (!(await confirmDialog('Log out the picker/recorder browser? Your next pick or recording will start signed out.', { title: 'Log out browser', confirmText: 'Log out', danger: false }))) return
    setClearing(true)
    setSessionMsg('')
    try {
      const res = await window.api.clearBrowserSession()
      setSessionMsg(res?.ok ? '✓ Logged out — next pick starts fresh' : (res?.error || 'Could not clear the session'))
    } catch (e) {
      setSessionMsg(e?.message || 'Could not clear the session')
    } finally {
      setClearing(false)
    }
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

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row', textTransform: 'none', letterSpacing: 'normal' }}>
          <input type="checkbox" checked={settings.settle_before_action === '1'} style={{ width: 'auto' }}
            onChange={e => set('settle_before_action', e.target.checked ? '1' : '0')} />
          Calm playback — wait for the page to settle before each step
        </label>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '-10px 0 0 26px' }}>
          Before each click/fill, wait for the page's network to go quiet so the UI has loaded —
          fewer manual waits. Best-effort and capped, so it never hangs. Turn off per-step on a step
          card if a screen polls or streams.
        </p>
        {settings.settle_before_action === '1' && (
          <div style={{ marginLeft: 26 }}>
            <label style={{ textTransform: 'none', letterSpacing: 'normal' }}>Settle cap (ms) — 0 = no limit</label>
            <input type="number" min="0" value={settings.settle_timeout}
              onChange={e => set('settle_timeout', e.target.value)} style={{ maxWidth: 160 }} />
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              0 waits until the network is fully idle (no time limit). On an app with constant
              background traffic (maps/polling) this can wait the whole step out — use a number there.
            </p>
          </div>
        )}

        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
          Network trace is opt-in per step: tick <strong>⚡ Include network trace in result</strong> on a
          step card to record the API calls it makes (shown in Results & the HTML report).
        </p>

        <button className="btn-primary" style={{ marginTop: 4 }} onClick={save}>Save Settings</button>
      </div>

      <div className="card" style={{ marginTop: 20, display: 'grid', gap: 10 }}>
        <div>
          <label style={{ textTransform: 'none', letterSpacing: 'normal' }}>Browser Session</label>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            The picker, recorder, and selector test remember your login so you don't have to sign in
            every time. Clear it to log out or switch users.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={clearSession} disabled={clearing} style={{ width: 'auto' }}>
            {clearing ? 'Clearing…' : 'Clear browser session / log out'}
          </button>
          {sessionMsg && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{sessionMsg}</span>}
        </div>
      </div>
    </div>
  )
}
