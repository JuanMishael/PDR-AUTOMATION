import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Runner
  runProfile: (profileId) => ipcRenderer.invoke('runner:run', profileId),
  stopRun: (runId) => ipcRenderer.invoke('runner:stop', runId),
  onRunLog: (cb) => ipcRenderer.on('runner:log', (_, data) => cb(data)),
  onRunComplete: (cb) => ipcRenderer.on('runner:complete', (_, data) => cb(data)),
  offRunLog: () => ipcRenderer.removeAllListeners('runner:log'),
  offRunComplete: () => ipcRenderer.removeAllListeners('runner:complete'),

  // Storage — Profiles
  getProfiles: () => ipcRenderer.invoke('storage:getProfiles'),
  saveProfile: (profile) => ipcRenderer.invoke('storage:saveProfile', profile),
  deleteProfile: (id) => ipcRenderer.invoke('storage:deleteProfile', id),

  // Storage — Scenarios
  getScenarios: (profileId) => ipcRenderer.invoke('storage:getScenarios', profileId),
  saveScenario: (scenario) => ipcRenderer.invoke('storage:saveScenario', scenario),
  deleteScenario: (id) => ipcRenderer.invoke('storage:deleteScenario', id),

  // Storage — Steps
  getSteps: (scenarioId) => ipcRenderer.invoke('storage:getSteps', scenarioId),
  saveStep: (step) => ipcRenderer.invoke('storage:saveStep', step),
  deleteStep: (id) => ipcRenderer.invoke('storage:deleteStep', id),
  reorderSteps: (scenarioId, orderedIds) => ipcRenderer.invoke('storage:reorderSteps', scenarioId, orderedIds),

  // Storage — History
  getHistory: (profileId) => ipcRenderer.invoke('storage:getHistory', profileId),
  deleteHistory: (id) => ipcRenderer.invoke('storage:deleteHistory', id),

  // Storage — Custom Steps
  getCustomSteps: () => ipcRenderer.invoke('storage:getCustomSteps'),
  saveCustomStep: (step) => ipcRenderer.invoke('storage:saveCustomStep', step),
  deleteCustomStep: (id) => ipcRenderer.invoke('storage:deleteCustomStep', id),

  // Reporter
  exportReport: (runId, format) => ipcRenderer.invoke('reporter:export', runId, format),
  openTraceViewer: (tracePath) => ipcRenderer.invoke('reporter:openTrace', tracePath),

  // Health
  checkHealth: () => ipcRenderer.invoke('health:check'),

  // Settings
  getSettings: () => ipcRenderer.invoke('storage:getSettings'),
  saveSettings: (settings) => ipcRenderer.invoke('storage:saveSettings', settings)
})
