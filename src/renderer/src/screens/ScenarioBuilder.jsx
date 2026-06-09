import { useEffect, useState } from 'react'
import StepCard from '../components/StepCard'
import StepPicker from '../components/StepPicker'

export default function ScenarioBuilder({ navigate, ctx }) {
  const { profileId, profileName } = ctx
  const [scenarios, setScenarios] = useState([])
  const [activeScenario, setActiveScenario] = useState(null)
  const [steps, setSteps] = useState([])
  const [showPicker, setShowPicker] = useState(false)
  const [newScenarioName, setNewScenarioName] = useState('')

  useEffect(() => {
    if (profileId) loadScenarios()
  }, [profileId])

  async function loadScenarios() {
    const data = await window.api.getScenarios(profileId)
    setScenarios(data)
    if (data.length && !activeScenario) selectScenario(data[0])
  }

  async function selectScenario(scenario) {
    setActiveScenario(scenario)
    const s = await window.api.getSteps(scenario.id)
    setSteps(s)
  }

  async function addScenario() {
    if (!newScenarioName.trim()) return
    await window.api.saveScenario({ profile_id: profileId, name: newScenarioName.trim(), sort_order: scenarios.length })
    setNewScenarioName('')
    loadScenarios()
  }

  async function deleteScenario(id) {
    if (!confirm('Delete this scenario and all its steps?')) return
    await window.api.deleteScenario(id)
    setActiveScenario(null)
    setSteps([])
    loadScenarios()
  }

  async function addStep(action) {
    if (!activeScenario) return
    await window.api.saveStep({ scenario_id: activeScenario.id, action, params: {}, sort_order: steps.length })
    const updated = await window.api.getSteps(activeScenario.id)
    setSteps(updated)
    setShowPicker(false)
  }

  async function updateStep(step) {
    await window.api.saveStep(step)
    const updated = await window.api.getSteps(activeScenario.id)
    setSteps(updated)
  }

  async function deleteStep(id) {
    await window.api.deleteStep(id)
    const updated = await window.api.getSteps(activeScenario.id)
    setSteps(updated)
  }

  async function moveStep(id, direction) {
    const idx = steps.findIndex(s => s.id === id)
    const newSteps = [...steps]
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= newSteps.length) return;
    [newSteps[idx], newSteps[swapIdx]] = [newSteps[swapIdx], newSteps[idx]]
    setSteps(newSteps)
    await window.api.reorderSteps(activeScenario.id, newSteps.map(s => s.id))
  }

  if (!profileId) {
    return <p style={{ color: 'var(--text-muted)' }}>No profile selected. Go to Profiles first.</p>
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Scenario Builder</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: 2 }}>Profile: <strong>{profileName}</strong></p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <button className="btn-primary" onClick={() => navigate('run', { profileId })}>▶ Run All</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20 }}>
        {/* Scenario list */}
        <div>
          <div style={{ marginBottom: 10, display: 'flex', gap: 8 }}>
            <input value={newScenarioName} onChange={e => setNewScenarioName(e.target.value)}
              placeholder="Scenario name" onKeyDown={e => e.key === 'Enter' && addScenario()} />
            <button className="btn-primary" style={{ padding: '8px 12px', whiteSpace: 'nowrap' }} onClick={addScenario}>+</button>
          </div>
          {scenarios.map(s => (
            <div key={s.id} onClick={() => selectScenario(s)}
              style={{
                padding: '10px 14px', borderRadius: 8, cursor: 'pointer', marginBottom: 6,
                background: activeScenario?.id === s.id ? 'rgba(108,99,255,0.2)' : 'var(--surface)',
                border: `1px solid ${activeScenario?.id === s.id ? 'var(--accent)' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between'
              }}>
              <span style={{ fontWeight: activeScenario?.id === s.id ? 700 : 400 }}>{s.name}</span>
              <button onClick={e => { e.stopPropagation(); deleteScenario(s.id) }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: 0, fontSize: 16 }}>×</button>
            </div>
          ))}
        </div>

        {/* Step builder */}
        <div>
          {!activeScenario ? (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              Select or create a scenario to build steps.
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700 }}>{activeScenario.name}</h2>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{steps.length} steps</span>
                <button className="btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setShowPicker(true)}>
                  + Add Step
                </button>
              </div>

              {steps.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  No steps yet. Click "+ Add Step" to begin.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {steps.map((step, i) => (
                    <StepCard key={step.id} step={step} index={i} total={steps.length}
                      onChange={updateStep} onDelete={deleteStep} onMove={moveStep} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showPicker && <StepPicker onPick={addStep} onClose={() => setShowPicker(false)} />}
    </div>
  )
}
