const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '⬡' },
  { id: 'profile', label: 'Profiles', icon: '⊞' },
  { id: 'scenarios', label: 'Scenarios', icon: '◈' },
  { id: 'history', label: 'History', icon: '⊟' },
  { id: 'health', label: 'Health Check', icon: '◎' },
  { id: 'settings', label: 'Settings', icon: '⚙' }
]

export default function Sidebar({ current, navigate, appName = 'AutomationTool' }) {
  return (
    <aside style={{
      width: 220, minWidth: 220, background: 'var(--surface)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', padding: '24px 0'
    }}>
      <div style={{ padding: '0 20px 28px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)' }}>{appName}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>v2.0 · Playwright</div>
      </div>
      <nav style={{ flex: 1, padding: '12px 0' }}>
        {NAV.map(item => (
          <button
            key={item.id}
            onClick={() => navigate(item.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              width: '100%', padding: '10px 20px', textAlign: 'left',
              background: current === item.id ? 'rgba(108,99,255,0.15)' : 'transparent',
              color: current === item.id ? 'var(--accent)' : 'var(--text-muted)',
              borderRadius: 0, fontWeight: current === item.id ? 700 : 400,
              borderLeft: current === item.id ? '3px solid var(--accent)' : '3px solid transparent'
            }}
          >
            <span style={{ fontSize: 16 }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  )
}
