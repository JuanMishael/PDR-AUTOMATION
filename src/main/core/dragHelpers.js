/**
 * In-page drag helpers, shared by the run script (scriptGenerator) and the live replay
 * (stepReplay). Both functions use ONLY browser globals and no closures, so they can be
 * embedded verbatim into a generated script via .toString() as well as passed to
 * page.evaluate() directly.
 *
 * Why this exists: dragging a jQuery UI panel (class "ui-draggable", header
 * ".ui-draggable-handle") only works if the press lands on the drag HANDLE — pressing
 * the panel body does nothing, with no error. And a fast synthetic move burst is often
 * dropped. So we (1) locate the real handle to press, and (2) keep a synthetic-event
 * fallback for cases where trusted mouse events don't drive the library.
 */

// From the element a drag step targets, find the actual drag handle to press and return
// its rect. Climbs to the draggable root and prefers its handle; falls back to the element.
export function findDragHandleRect(el) {
  var target = el
  try {
    var root = el.closest('.ui-draggable, .DRAGIT, .ui-resizable, [class*="draggable"]')
    if (root) {
      var h = root.querySelector('.ui-draggable-handle, .panel-heading, .modal-header, [class*="handle"]')
      if (h) target = h
    }
  } catch (e) { /* keep el */ }
  var r = target.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
}

// Fallback: drive the drag with synthetic DOM mouse events dispatched on the handle and
// document (jQuery UI binds mousemove/up to document after mousedown). Used only when the
// real mouse drag left the panel in place. arg = { el, dx, dy }.
export function synthDrag(arg) {
  var el = arg.el, dx = arg.dx, dy = arg.dy, target = el
  try {
    var root = el.closest('.ui-draggable, .DRAGIT, .ui-resizable, [class*="draggable"]')
    if (root) {
      var h = root.querySelector('.ui-draggable-handle, .panel-heading, .modal-header, [class*="handle"]')
      if (h) target = h
    }
  } catch (e) { /* keep el */ }
  var r = target.getBoundingClientRect()
  var sx = r.left + r.width / 2, sy = r.top + r.height / 2
  function mk(type, x, y, buttons) {
    return new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: buttons
    })
  }
  target.dispatchEvent(mk('mousedown', sx, sy, 1))
  var N = 25
  for (var i = 1; i <= N; i++) {
    document.dispatchEvent(mk('mousemove', sx + (dx * i) / N, sy + (dy * i) / N, 1))
  }
  document.dispatchEvent(mk('mouseup', sx + dx, sy + dy, 0))
}
