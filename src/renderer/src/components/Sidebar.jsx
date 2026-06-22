import { Icon } from './SketchDefs'

const NAV = [
  { id: 'dashboard',  label: 'Dashboard',  icon: 'dashboard' },
  { id: 'profile',    label: 'Profiles',   icon: 'profile'   },
  { id: 'scenarios',  label: 'Scenarios',  icon: 'builder'   },
  { id: 'testdata',   label: 'Test Data',  icon: 'data'      },
  { id: 'history',    label: 'History',    icon: 'history'   },
  { id: 'health',     label: 'Health',     icon: 'health'    },
  { id: 'settings',   label: 'Settings',   icon: 'settings'  },
]

export default function Sidebar({ current, navigate, appName = 'PDR-AUTOMATION' }) {
  return (
    <aside style={{
      width: 224,
      minWidth: 224,
      background: 'var(--surface)',
      borderRight: '2px solid var(--line)',
      display: 'flex',
      flexDirection: 'column',
      userSelect: 'none'
    }}>
      {/* Wordmark */}
      <div style={{
        padding: '20px 18px 16px',
        borderBottom: '1.5px dashed var(--line-soft)'
      }}>
        <div style={{ fontFamily: 'var(--font-marker)', fontSize: 30, fontWeight: 700, lineHeight: 0.95, color: 'var(--ink)' }}>
          {appName.split('-')[0] || appName}<span style={{ color: 'var(--accent)' }}>{appName.includes('-') ? '-' + appName.split('-').slice(1).join('-') : ''}</span>
        </div>
        <div style={{ fontFamily: 'var(--font-hand)', fontSize: 12, color: 'var(--ink-soft)', letterSpacing: '1px', textTransform: 'uppercase', marginTop: 2 }}>
          Automation Tool
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 10px' }}>
        {NAV.map(item => {
          const active = current === item.id
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                width: '100%',
                padding: '9px 11px',
                marginBottom: 4,
                textAlign: 'left',
                background: active ? 'var(--accent-soft)' : 'transparent',
                color: active ? 'var(--accent-ink)' : 'var(--ink-soft)',
                borderRadius: 9,
                fontFamily: 'var(--font-hand)',
                fontSize: 16,
                border: active ? '2px solid color-mix(in srgb, var(--accent) 40%, transparent)' : '2px solid transparent',
                boxShadow: 'none',
                transition: 'background .12s, color .12s'
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--ink)' } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-soft)' } }}
            >
              <Icon name={item.icon} size={19} fill={item.icon === 'dashboard'} />
              {item.label}
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div style={{
        padding: '12px 18px',
        borderTop: '1.5px dashed var(--line-soft)'
      }}>
        <div style={{ fontFamily: 'var(--font-hand)', fontSize: 13, color: 'var(--ink-soft)' }}>
          Pacific Data Resources
        </div>
      </div>
    </aside>
  )
}
