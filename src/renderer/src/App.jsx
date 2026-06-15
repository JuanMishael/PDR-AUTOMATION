import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import Dashboard from './screens/Dashboard'
import ProfileConfig from './screens/ProfileConfig'
import ScenarioBuilder from './screens/ScenarioBuilder'
import ActiveRun from './screens/ActiveRun'
import Results from './screens/Results'
import History from './screens/History'
import Settings from './screens/Settings'
import HealthCheck from './screens/HealthCheck'

const SCREENS = {
  dashboard: Dashboard,
  profile: ProfileConfig,
  scenarios: ScenarioBuilder,
  run: ActiveRun,
  results: Results,
  history: History,
  settings: Settings,
  health: HealthCheck
}

export default function App() {
  const [screen, setScreen] = useState('dashboard')
  const [ctx, setCtx] = useState({})
  const [appName, setAppName] = useState('PDR-AUTOMATION')

  useEffect(() => {
    window.api.getSettings().then(s => { if (s.app_name) setAppName(s.app_name) })
  }, [])

  function navigate(to, context = {}) {
    setCtx(context)
    setScreen(to)
    // re-read app name when leaving Settings in case it was changed
    if (screen === 'settings') {
      window.api.getSettings().then(s => { if (s.app_name) setAppName(s.app_name) })
    }
  }

  const Screen = SCREENS[screen] || Dashboard

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar current={screen} navigate={navigate} appName={appName} />
      <main style={{ flex: 1, overflow: 'auto', padding: '28px 32px' }}>
        <Screen navigate={navigate} ctx={ctx} />
      </main>
    </div>
  )
}
