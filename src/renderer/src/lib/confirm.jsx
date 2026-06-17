import { useState, useEffect } from 'react'

// In-app replacement for window.confirm(). Native confirm/alert dialogs leave Electron's
// webContents without keyboard focus on Windows (inputs go dead until the window is
// re-activated), so we render our own modal instead. It's promise-based so call sites read
// almost the same as before:  if (!(await confirmDialog('Delete this?'))) return
//
// Works from anywhere — component or plain function — via a tiny module-level pub/sub that
// the once-mounted <ConfirmHost /> subscribes to.

let publish = null            // set by ConfirmHost while it's mounted
const queue = []              // requests raised before the host mounted (shouldn't happen, but safe)

/**
 * Ask the user to confirm. Resolves true (OK) / false (Cancel or dismissed).
 * opts: { confirmText, cancelText, danger, title }
 */
export function confirmDialog(message, opts = {}) {
  return new Promise(resolve => {
    const req = { message, opts, resolve }
    if (publish) publish(req)
    else queue.push(req)
  })
}

export function ConfirmHost() {
  const [req, setReq] = useState(null)

  useEffect(() => {
    publish = setReq
    // Drain anything queued before mount.
    if (queue.length) { setReq(queue.shift()) }
    return () => { publish = null }
  }, [])

  if (!req) return null

  const { message, opts, resolve } = req
  const {
    confirmText = 'OK',
    cancelText = 'Cancel',
    danger = true,           // most callers are destructive (delete) — red confirm by default
    title = 'Please confirm'
  } = opts

  function settle(value) {
    resolve(value)
    // If another request queued while this one was open, show it next; else close.
    setReq(queue.length ? queue.shift() : null)
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={() => settle(false)}
    >
      <div
        className="card"
        style={{ width: 420, maxWidth: '90vw', display: 'flex', flexDirection: 'column', gap: 14 }}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') settle(false)
          if (e.key === 'Enter') settle(true)
        }}
      >
        <h2 style={{ margin: 0, fontFamily: 'var(--font-hand)', fontSize: 22, color: 'var(--ink)' }}>{title}</h2>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-soft)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button className="btn" onClick={() => settle(false)}>{cancelText}</button>
          <button
            className={danger ? 'btn-danger' : 'btn-primary'}
            autoFocus
            onClick={() => settle(true)}
          >{confirmText}</button>
        </div>
      </div>
    </div>
  )
}
