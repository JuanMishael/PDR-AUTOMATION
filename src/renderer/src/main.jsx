import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// Sketchbook fonts — bundled locally so the app stays offline-safe.
import '@fontsource/patrick-hand/400.css'
import '@fontsource/caveat/400.css'
import '@fontsource/caveat/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'

import './index.css'

// Native confirm/alert/prompt leave Electron's webContents without keyboard focus on
// Windows — after dismissing one, inputs go dead until the window is re-activated (the
// minimize/restore the tester has been doing by hand). Wrap them once here so every call,
// anywhere in the app, asks the main process to re-assert focus the moment it closes.
for (const fn of ['confirm', 'alert', 'prompt']) {
  const native = window[fn].bind(window)
  window[fn] = (...args) => {
    try { return native(...args) }
    finally { window.api?.refocus?.() }
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
