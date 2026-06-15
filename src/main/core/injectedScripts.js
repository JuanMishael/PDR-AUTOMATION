/**
 * Scripts injected (via context.addInitScript) into the picker / recorder browser.
 * Each function runs in PAGE context and must be fully self-contained — they share
 * state only through window globals, never closures. Written in conservative ES5
 * style so bundler/minifier output still serializes cleanly to the page.
 */

/** Attaches window.__genSelector + window.__norm. Injected first; both listeners use it. */
export function installSelectorGen() {
  if (window.__genSelector) return

  function esc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&') }
  function uniq(sel) { try { return document.querySelectorAll(sel).length === 1 } catch (e) { return false } }
  function norm(t) { return (t || '').trim().replace(/\s+/g, ' ') }

  function cssPath(el) {
    var parts = [], node = el
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 5) {
      if (node.id) { parts.unshift('#' + esc(node.id)); break }
      var part = node.tagName.toLowerCase(), parent = node.parentElement
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName })
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')'
      }
      parts.unshift(part); node = node.parentElement
    }
    return parts.join(' > ')
  }

  window.__norm = norm
  window.__genSelector = function (el) {
    if (!el || el.nodeType !== 1) return 'body'
    // 1. unique id
    if (el.id && uniq('#' + esc(el.id))) return '#' + esc(el.id)
    // 2. test attributes
    var ta = ['data-testid', 'data-test', 'data-cy', 'data-qa']
    for (var i = 0; i < ta.length; i++) {
      var v = el.getAttribute && el.getAttribute(ta[i])
      if (v) { var s = '[' + ta[i] + '="' + v + '"]'; if (uniq(s)) return s }
    }
    var tag = el.tagName.toLowerCase()
    // 3. name / aria-label
    var name = el.getAttribute('name'); if (name) { var sn = tag + '[name="' + name + '"]'; if (uniq(sn)) return sn }
    var aria = el.getAttribute('aria-label'); if (aria) { var sa = tag + '[aria-label="' + aria.replace(/"/g, '\\"') + '"]'; if (uniq(sa)) return sa }
    // 4. text for interactive elements (beats brittle classes — the modal OK button case)
    var text = norm(el.textContent)
    if (['button', 'a', 'label', 'summary'].indexOf(tag) >= 0 && text && text.length <= 40) {
      var c = Array.prototype.filter.call(document.querySelectorAll(tag), function (e) { return norm(e.textContent) === text }).length
      if (c === 1) return tag + ':has-text("' + text.replace(/"/g, '\\"') + '")'
    }
    // 5. a single unique class, then a class combo
    if (el.classList && el.classList.length) {
      for (var j = 0; j < el.classList.length; j++) { var sc = tag + '.' + esc(el.classList[j]); if (uniq(sc)) return sc }
      var combo = tag + '.' + Array.prototype.map.call(el.classList, esc).join('.'); if (uniq(combo)) return combo
    }
    // 6. structural fallback
    return cssPath(el)
  }
}

/** One-shot element picker: hover-highlight, capture one click, send via window.__pickerPick. */
export function pickerListener() {
  if (window.__pickInstalled) return
  window.__pickInstalled = true
  window.__pickerArmed = false
  var norm = window.__norm || function (t) { return (t || '').trim() }

  var last = null
  function outline(el, on) {
    if (!el || !el.style) return
    el.style.outline = on ? '2px solid #6C63FF' : ''
    el.style.outlineOffset = on ? '1px' : ''
  }

  document.addEventListener('mousemove', function (e) {
    if (!window.__pickerArmed) return
    if (e.target && e.target.id === '__pickerBanner') return
    if (last && last !== e.target) outline(last, false)
    last = e.target; outline(last, true)
  }, true)

  document.addEventListener('click', function (e) {
    if (!window.__pickerArmed) return
    if (e.target && e.target.id === '__pickerBanner') return
    e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation()
    var el = e.target; outline(el, false); window.__pickerArmed = false
    var banner = document.getElementById('__pickerBanner')
    if (banner) { banner.textContent = '✓ Captured — you can return to the app'; banner.style.background = '#10B981' }
    try {
      window.__pickerPick({ selector: window.__genSelector(el), tag: el.tagName.toLowerCase(), text: norm(el.textContent).slice(0, 60) })
    } catch (err) { /* binding not ready */ }
  }, true)

  window.__pickerArm = function () {
    window.__pickerArmed = true
    if (!document.getElementById('__pickerBanner')) {
      var b = document.createElement('div')
      b.id = '__pickerBanner'
      b.textContent = '🎯 Click any element to capture it as your selector'
      b.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;' +
        'background:#6C63FF;color:#fff;font:600 13px system-ui,-apple-system,sans-serif;padding:10px 16px;' +
        'border-radius:999px;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.4);pointer-events:none'
      document.documentElement.appendChild(b)
    }
  }
}

/**
 * Continuous recorder: a Start/Stop bar + capture of click / fill / selectOption /
 * pressKey, each sent via window.__recordStep. Armed state + step count live in
 * sessionStorage so recording survives same-tab navigations (e.g. a login redirect),
 * because addInitScript re-runs this on every new document.
 */
export function recorderListener() {
  if (window.__recInstalled) return
  window.__recInstalled = true
  var norm = window.__norm || function (t) { return (t || '').trim() }

  // --- Smart waits ----------------------------------------------------------
  // Notice when an element appears on the page WHILE the tester pauses, then emit
  // a "wait for it visible" before the action that uses it — instead of recording
  // the raw pause as a hard sleep (the flaky anti-pattern). A MutationObserver
  // stamps every newly-added node; a click after a real pause looks for the
  // container that appeared during that pause.
  var SMART_GAP_MS = 400       // below this it's back-to-back clicking, not a wait
  var pageReadyTs = Infinity   // nothing counts as "appeared" until the load settles
  var lastActionTs = Date.now()

  // Initial-parse nodes are added before load; bounding "appeared" by pageReadyTs
  // keeps them from being mistaken for content that showed up mid-flow.
  window.addEventListener('load', function () { pageReadyTs = Date.now(); lastActionTs = Date.now() }, true)

  try {
    var mo = new MutationObserver(function (muts) {
      var t = Date.now()
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes
        for (var j = 0; j < added.length; j++) {
          var n = added[j]
          if (n && n.nodeType === 1 && n.__recAddedAt == null) n.__recAddedAt = t
        }
      }
    })
    mo.observe(document.documentElement || document, { childList: true, subtree: true })
  } catch (e) { /* observer unsupported */ }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false
    var r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return false
    var st = window.getComputedStyle ? getComputedStyle(el) : null
    if (st && (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0')) return false
    return true
  }

  // The outermost STRICT ancestor of the target that appeared after the last action
  // (e.g. the modal/panel wrapping a freshly clicked button). Strict-ancestor only:
  // Playwright already auto-waits for the action's own target, so a wait for it would
  // be redundant — the value is waiting for the container that gates it.
  function appearedContainer(target) {
    var node = target.parentElement, best = null
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      if (node.__recAddedAt != null && node.__recAddedAt > lastActionTs && node.__recAddedAt > pageReadyTs) best = node
      node = node.parentElement
    }
    return best
  }

  function maybeSmartWait(target) {
    if (Date.now() - lastActionTs < SMART_GAP_MS) return
    var cont = appearedContainer(target)
    if (!cont || !isVisible(cont)) return
    var sel = window.__genSelector(cont)
    if (!sel || sel === 'body') return
    send({ action: 'waitForSelector', selector: sel, state: 'visible', smart: true,
      label: 'Wait for ' + (norm(cont.textContent).slice(0, 30) || sel) })
  }

  function armed() { try { return sessionStorage.getItem('__recArmed') === '1' } catch (e) { return false } }
  function getCount() { try { return parseInt(sessionStorage.getItem('__recCount') || '0', 10) } catch (e) { return 0 } }
  function setCount(n) { try { sessionStorage.setItem('__recCount', String(n)) } catch (e) {} }
  function inBar(t) { return t && t.closest && t.closest('#__recBar') }

  function labelOf(t) {
    var x = norm(t.textContent || ''); if (x) return x.slice(0, 40)
    var ph = t.getAttribute && t.getAttribute('placeholder'); if (ph) return ph.slice(0, 40)
    var nm = t.getAttribute && t.getAttribute('name'); if (nm) return nm.slice(0, 40)
    return (t.tagName || '').toLowerCase()
  }

  function send(step) {
    if (!armed()) return
    var n = getCount() + 1; setCount(n)
    var lbl = document.getElementById('__recCount')
    if (lbl) lbl.textContent = n + ' step' + (n === 1 ? '' : 's') + ' recorded'
    try { window.__recordStep(step) } catch (e) { /* binding not ready */ }
    lastActionTs = Date.now()   // reset the pause baseline after every emitted step
  }

  document.addEventListener('click', function (e) {
    if (!armed()) return
    var t = e.target; if (inBar(t)) return
    maybeSmartWait(t)   // may emit a "wait for the container that just appeared" first
    send({ action: 'click', selector: window.__genSelector(t), label: labelOf(t) })
  }, true)

  document.addEventListener('change', function (e) {
    if (!armed()) return
    var t = e.target; if (inBar(t)) return
    var tn = t && t.tagName
    if (tn === 'SELECT') { send({ action: 'selectOption', selector: window.__genSelector(t), value: t.value, label: labelOf(t) }); return }
    if (tn === 'INPUT' || tn === 'TEXTAREA') {
      var type = ((t.getAttribute('type') || 'text') + '').toLowerCase()
      if (['checkbox', 'radio', 'file', 'button', 'submit'].indexOf(type) >= 0) return
      send({ action: 'fill', selector: window.__genSelector(t), value: t.value, label: labelOf(t) })
    }
  }, true)

  document.addEventListener('keydown', function (e) {
    if (!armed()) return
    var t = e.target; if (inBar(t)) return
    if (['Enter', 'Tab', 'Escape'].indexOf(e.key) >= 0) {
      send({ action: 'pressKey', selector: window.__genSelector(t), key: e.key, label: e.key })
    }
  }, true)

  function buildBar() {
    var existing = document.getElementById('__recBar'); if (existing) existing.remove()
    var bar = document.createElement('div'); bar.id = '__recBar'
    // Compact pill, bottom-centre — stays clear of the site's own top header.
    bar.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;' +
      'display:inline-flex;align-items:center;gap:10px;background:#1b1b2b;color:#fff;' +
      'font:600 13px system-ui,-apple-system,sans-serif;padding:7px 9px 7px 12px;border-radius:999px;' +
      'box-shadow:0 6px 24px rgba(0,0,0,.5);cursor:grab;user-select:none'

    var grip = document.createElement('span')
    grip.textContent = '⠿'; grip.title = 'Drag to move'
    grip.style.cssText = 'opacity:.5;font-size:14px;letter-spacing:-1px'
    var dot = document.createElement('span')
    var btn = document.createElement('button')
    btn.style.cssText = 'cursor:pointer;border:none;border-radius:999px;padding:6px 14px;font:inherit;color:#fff'
    var info = document.createElement('span'); info.id = '__recCount'; info.style.cssText = 'opacity:.85;padding-right:4px'
    info.textContent = getCount() + ' steps'

    function render() {
      if (armed()) {
        dot.textContent = '●'; dot.style.color = '#EF4444'
        btn.textContent = '■ Stop'; btn.style.background = '#EF4444'
      } else {
        dot.textContent = '○'; dot.style.color = '#9CA3AF'
        btn.textContent = '▶ Start Recording'; btn.style.background = '#6C63FF'
      }
    }

    btn.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation()
      if (armed()) {
        try { sessionStorage.setItem('__recArmed', '0') } catch (e) {}
        render(); info.textContent = '✓ ' + getCount() + ' saved'
        try { window.__recordDone() } catch (e) {}
      } else {
        try { sessionStorage.setItem('__recArmed', '1') } catch (e) {}
        render()
      }
    }, true)

    // Drag-to-reposition (so it can be moved off whatever it covers on any layout).
    var drag = false, sx = 0, sy = 0, ox = 0, oy = 0
    bar.addEventListener('mousedown', function (ev) {
      if (ev.target === btn || btn.contains(ev.target)) return
      var r = bar.getBoundingClientRect()
      drag = true; sx = ev.clientX; sy = ev.clientY; ox = r.left; oy = r.top
      bar.style.transform = 'none'; bar.style.left = r.left + 'px'; bar.style.top = r.top + 'px'; bar.style.bottom = 'auto'
      bar.style.cursor = 'grabbing'
      ev.preventDefault(); ev.stopPropagation()
    }, true)
    document.addEventListener('mousemove', function (ev) {
      if (!drag) return
      var maxX = window.innerWidth - bar.offsetWidth, maxY = window.innerHeight - bar.offsetHeight
      bar.style.left = Math.max(0, Math.min(maxX, ox + ev.clientX - sx)) + 'px'
      bar.style.top = Math.max(0, Math.min(maxY, oy + ev.clientY - sy)) + 'px'
      ev.preventDefault()
    }, true)
    document.addEventListener('mouseup', function () { if (drag) { drag = false; bar.style.cursor = 'grab' } }, true)

    bar.appendChild(grip); bar.appendChild(dot); bar.appendChild(btn); bar.appendChild(info)
    document.documentElement.appendChild(bar)
    render()
  }

  if (document.body) buildBar()
  else document.addEventListener('DOMContentLoaded', buildBar)
}
