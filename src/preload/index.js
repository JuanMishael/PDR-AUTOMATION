import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Runner
  runProfile: (profileId, dataSetId = null) => ipcRenderer.invoke('runner:run', profileId, dataSetId),
  runScenario: (profileId, scenarioId, dataSetId = null) => ipcRenderer.invoke('runner:runScenario', { profileId, scenarioId, dataSetId }),
  stopRun: (runId) => ipcRenderer.invoke('runner:stop', runId),
  onRunLog: (cb) => ipcRenderer.on('runner:log', (_, data) => cb(data)),
  onRunComplete: (cb) => ipcRenderer.on('runner:complete', (_, data) => cb(data)),
  offRunLog: () => ipcRenderer.removeAllListeners('runner:log'),
  offRunComplete: () => ipcRenderer.removeAllListeners('runner:complete'),

  // Storage — Profiles
  getProfiles: () => ipcRenderer.invoke('storage:getProfiles'),
  saveProfile: (profile) => ipcRenderer.invoke('storage:saveProfile', profile),
  deleteProfile: (id) => ipcRenderer.invoke('storage:deleteProfile', id),
  duplicateProfile: (profileId, newName) => ipcRenderer.invoke('storage:duplicateProfile', profileId, newName),
  copyScenarios: (scenarioIds, targetProfileId) => ipcRenderer.invoke('storage:copyScenarios', scenarioIds, targetProfileId),

  // Storage — Scenarios
  getScenarios: (profileId) => ipcRenderer.invoke('storage:getScenarios', profileId),
  saveScenario: (scenario) => ipcRenderer.invoke('storage:saveScenario', scenario),
  deleteScenario: (id) => ipcRenderer.invoke('storage:deleteScenario', id),
  duplicateScenario: (id) => ipcRenderer.invoke('storage:duplicateScenario', id),
  reorderScenarios: (profileId, orderedIds) => ipcRenderer.invoke('storage:reorderScenarios', profileId, orderedIds),

  // Storage — Steps
  getSteps: (scenarioId) => ipcRenderer.invoke('storage:getSteps', scenarioId),
  saveStep: (step) => ipcRenderer.invoke('storage:saveStep', step),
  deleteStep: (id) => ipcRenderer.invoke('storage:deleteStep', id),
  reorderSteps: (scenarioId, orderedIds) => ipcRenderer.invoke('storage:reorderSteps', scenarioId, orderedIds),
  copySteps: (stepIds, targetScenarioId) => ipcRenderer.invoke('storage:copySteps', stepIds, targetScenarioId),

  // Storage — History
  getHistory: (profileId) => ipcRenderer.invoke('storage:getHistory', profileId),
  deleteHistory: (id) => ipcRenderer.invoke('storage:deleteHistory', id),
  clearHistory: (profileId) => ipcRenderer.invoke('storage:clearHistory', profileId),

  // API profiles — requests / variables / auth
  getApiRequests: (profileId) => ipcRenderer.invoke('storage:getApiRequests', profileId),
  saveApiRequest: (req) => ipcRenderer.invoke('storage:saveApiRequest', req),
  deleteApiRequest: (id) => ipcRenderer.invoke('storage:deleteApiRequest', id),
  reorderApiRequests: (profileId, orderedIds) => ipcRenderer.invoke('storage:reorderApiRequests', profileId, orderedIds),
  getApiVariables: (profileId) => ipcRenderer.invoke('storage:getApiVariables', profileId),
  saveApiVariable: (v) => ipcRenderer.invoke('storage:saveApiVariable', v),
  deleteApiVariable: (id) => ipcRenderer.invoke('storage:deleteApiVariable', id),
  getApiAuth: (profileId) => ipcRenderer.invoke('storage:getApiAuth', profileId),
  saveApiAuth: (auth) => ipcRenderer.invoke('storage:saveApiAuth', auth),
  // API execution
  sendApiRequest: (requestId, dataSetId = null) => ipcRenderer.invoke('api:send', requestId, dataSetId),
  runApiCollection: (profileId) => ipcRenderer.invoke('api:runCollection', profileId),
  importWsdl: (profileId, wsdlUrl) => ipcRenderer.invoke('api:importWsdl', profileId, wsdlUrl),

  // Storage — Custom Steps
  getCustomSteps: () => ipcRenderer.invoke('storage:getCustomSteps'),
  saveCustomStep: (step) => ipcRenderer.invoke('storage:saveCustomStep', step),
  deleteCustomStep: (id) => ipcRenderer.invoke('storage:deleteCustomStep', id),

  // Reporter
  exportReport: (runId, format) => ipcRenderer.invoke('reporter:export', runId, format),
  exportSteps: (profileId, scenarioId) => ipcRenderer.invoke('reporter:exportSteps', profileId, scenarioId),
  openTraceViewer: (tracePath) => ipcRenderer.invoke('reporter:openTrace', tracePath),

  // Selector tester — opts: { url, selector, browser, steps, baseUrl, runSteps }
  testSelector: (opts) => ipcRenderer.invoke('selector:test', opts),

  // Element picker — opts: { url, browser, steps, baseUrl, runSteps }
  pickElement: (opts) => ipcRenderer.invoke('picker:pick', opts),

  // Browser session — wipe the saved login shared by picker/recorder/selector test
  clearBrowserSession: () => ipcRenderer.invoke('session:clear'),

  // Recorder — opts: { url, browser, steps, baseUrl, runSteps }; resolves when stopped
  startRecording: (opts) => ipcRenderer.invoke('recorder:start', opts),
  onRecorderStep: (cb) => ipcRenderer.on('recorder:step', (_, data) => cb(data)),
  offRecorderStep: () => ipcRenderer.removeAllListeners('recorder:step'),
  onRecorderNotice: (cb) => ipcRenderer.on('recorder:notice', (_, msg) => cb(msg)),
  offRecorderNotice: () => ipcRenderer.removeAllListeners('recorder:notice'),

  // Storage — Test Data Library
  getCollections: () => ipcRenderer.invoke('data:getCollections'),
  saveCollection: (collection) => ipcRenderer.invoke('data:saveCollection', collection),
  deleteCollection: (id) => ipcRenderer.invoke('data:deleteCollection', id),
  saveField: (field) => ipcRenderer.invoke('data:saveField', field),
  deleteField: (id) => ipcRenderer.invoke('data:deleteField', id),
  saveDataSet: (set) => ipcRenderer.invoke('data:saveSet', set),
  deleteDataSet: (id) => ipcRenderer.invoke('data:deleteSet', id),
  exportCollection: (id, format) => ipcRenderer.invoke('data:exportCollection', id, format),
  importCollection: () => ipcRenderer.invoke('data:importCollection'),

  // Profile portability — share a whole profile (scenarios + steps + referenced test data)
  exportProfile: (profileId) => ipcRenderer.invoke('transfer:exportProfile', profileId),
  importProfile: () => ipcRenderer.invoke('transfer:importProfile'),

  // Re-assert keyboard focus on the app window (e.g. after a native confirm/alert that
  // otherwise leaves Electron's inputs dead until the window is manually re-activated).
  refocus: () => ipcRenderer.send('window:refocus'),

  // Health
  checkHealth: () => ipcRenderer.invoke('health:check'),

  // Settings
  getSettings: () => ipcRenderer.invoke('storage:getSettings'),
  saveSettings: (settings) => ipcRenderer.invoke('storage:saveSettings', settings)
})
