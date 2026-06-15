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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
