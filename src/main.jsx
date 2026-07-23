import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles/tokens.css'
import './styles/interface.css'
import './styles/app.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// PWA: register the hand-rolled service worker in production only.
// Update flow: the SW auto-activates (skipWaiting + clients.claim); when a NEW
// worker takes control of an already-open page we notify the app, which shows
// a "Recharger" toast — the old version is never served indefinitely.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((reg) => {
        // Re-check for a new version whenever the tab regains focus.
        window.addEventListener('focus', () => reg.update().catch(() => {}))
      })
      .catch(() => {})
    let hadController = !!navigator.serviceWorker.controller
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) window.dispatchEvent(new CustomEvent('cockpit:sw-updated'))
      hadController = true
    })
  })
}
