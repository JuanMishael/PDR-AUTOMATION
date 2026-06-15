const NAV = [
  { id: 'dashboard',  label: 'Dashboard',   icon: '▦' },
  { id: 'profile',    label: 'Profiles',    icon: '⊡' },
  { id: 'scenarios',  label: 'Scenarios',   icon: '≡' },
  { id: 'history',    label: 'History',     icon: '◷' },
  { id: 'health',     label: 'Health',      icon: '◎' },
  { id: 'settings',   label: 'Settings',    icon: '⚙' },
]

export default function Sidebar({ current, navigate }) {
  return (
    <aside style={{
      width: 210,
      minWidth: 210,
      background: 'var(--surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      userSelect: 'none'
    }}>
      {/* Logo */}
      <div style={{
        padding: '22px 20px 18px',
        borderBottom: '1px solid var(--border)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32,
            background: 'var(--accent)',
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 900, color: '#fff',
            boxShadow: '0 2px 12px rgba(108,99,255,0.4)'
          }}>P</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>
              PDR-AUTOMATION
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }}>
              PLAYWRIGHT · V2
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 10px' }}>
        {NAV.map(item => {
          const active = current === item.id
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '9px 12px',
                marginBottom: 2,
                textAlign: 'left',
                background: active ? 'var(--accent-dim)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-muted)',
                borderRadius: 8,
                fontWeight: active ? 700 : 500,
                fontSize: 13,
                border: active ? '1px solid rgba(108,99,255,0.2)' : '1px solid transparent',
                transition: 'all 0.15s'
              }}
            >
              <span style={{ fontSize: 15, width: 18, textAlign: 'center', opacity: active ? 1 : 0.6 }}>
                {item.icon}
              </span>
              {item.label}
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div style={{
        padding: '14px 20px',
        borderTop: '1px solid var(--border)',
        fontSize: 11,
        color: 'var(--text-muted)'
      }}>
        QA Automation
      </div>
    </aside>
  )
}
