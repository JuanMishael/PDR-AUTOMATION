import { useEffect, useState, useRef } from 'react'
import { ACTION_DEFS, ACTION_CATEGORIES, ACTIONS_BY_CATEGORY } from '../components/actionDefs'
import { confirmDialog } from '../lib/confirm'

// Default keyword per action category
const CATEGORY_KEYWORD = {
  Navigation: 'Given',
  Interaction: 'When',
  Mouse: 'When',
  Assertions: 'Then',
  Waits: 'When',
  Flow: 'When',
  Util: 'When'
}

// Group markers wrap a range of steps (loopStart/loopEnd are legacy repeat-group aliases).
const isGroupStart = a => a === 'groupStart' || a === 'loopStart'
const isGroupEnd = a => a === 'groupEnd' || a === 'loopEnd'

const KEYWORD_COLOR = {
  Given: '#3B82F6',
  When: '#F59E0B',
  Then: '#10B981',
  And:  '#6B7280'
}

// Turn a recorded action payload into step params (keyword + action-specific fields)
function buildRecordedParams(p) {
  const params = { _keyword: p.action === 'navigate' ? 'Given' : 'When' }
  if (p.action === 'click')        return { ...params, selector: p.selector }
  if (p.action === 'fill')         return { ...params, selector: p.selector, value: p.value ?? '' }
  if (p.action === 'selectOption') return { ...params, selector: p.selector, value: p.value ?? '' }
  if (p.action === 'pressKey')     return { ...params, selector: p.selector, key: p.key }
  if (p.action === 'navigate')     return { ...params, url: p.url ?? '' }
  // Assert captured in the recorder's assert mode — a "Then" check (e.g. success toast).
  if (p.action === 'assertVisible') return { _keyword: 'Then', selector: p.selector }
  // Map / canvas gestures captured by the recorder
  if (p.action === 'clickAt')      return { ...params, selector: p.selector, x: p.x, y: p.y }
  if (p.action === 'dragByOffset') return { ...params, selector: p.selector, dx: p.dx, dy: p.dy, x: p.x, y: p.y }
  if (p.action === 'zoom')         return { ...params, selector: p.selector, deltaY: p.deltaY, times: p.times ?? 1 }
  // Smart wait inferred during recording — a real wait-for-visible, not a sleep.
  // Flagged _smart so the card shows it was auto-suggested (the tester can delete it).
  if (p.action === 'waitForSelector') return { ...params, selector: p.selector, state: p.state || 'visible', _smart: !!p.smart }
  return params
}

// ─── Test Selector Button ─────────────────────────────────────────────────────

function TestSelectorButton({ selector, baseUrl, browser, priorSteps = [], onUse, onUseFallback }) {
  const [open, setOpen]         = useState(false)
  const [url, setUrl]           = useState('')
  const [testing, setTesting]   = useState(false)
  const [result, setResult]     = useState(null)
  const [runFromTop, setRunFromTop] = useState(true)
  const ref = useRef(null)

  // Strengthen: dedupe each match's candidate selectors into one ranked list so an
  // ambiguous selector (0 or many matches) can be swapped for a unique, robust one.
  const strengthenOptions = (() => {
    if (!result?.elements) return []
    const seen = {}, list = []
    for (const el of result.elements) for (const c of (el.candidates || [])) {
      if (!seen[c.selector]) { seen[c.selector] = true; list.push(c) }
    }
    return list.filter(c => c.selector !== selector)
  })()

  const hasPriorSteps = priorSteps.length > 0

  // Pre-fill URL when opening
  function toggle() {
    if (!open) {
      setUrl(baseUrl || '')
      setResult(null)
      setRunFromTop(true)
    }
    setOpen(o => !o)
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  async function runTest() {
    if (!selector?.trim()) return
    const replay = runFromTop && hasPriorSteps
    setTesting(true)
    setResult(null)
    try {
      const res = await window.api.testSelector({
        url,
        selector,
        browser: browser || 'chromium',
        baseUrl: baseUrl || '',
        steps: replay ? priorSteps : [],
        runSteps: replay
      })
      setResult(res)
    } catch (e) {
      setResult({ ok: false, error: e?.message || 'Unexpected error — check DevTools console' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={toggle}
        title="Test this selector — optionally after running the steps above it"
        style={{
          padding: '0 8px', height: 30, borderRadius: 6, fontSize: 12, fontWeight: 600,
          background: open ? 'var(--accent-dim)' : 'var(--surface2)',
          border: `1px solid ${open ? 'rgba(108,99,255,0.3)' : 'var(--border)'}`,
          color: open ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer',
          whiteSpace: 'nowrap'
        }}>
        ⊙ Test
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 36, right: 0, zIndex: 200,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: 14, width: 320,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 8 }}>
            Test Selector
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Selector</div>
          <div style={{
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '6px 10px', fontSize: 12, fontFamily: 'monospace',
            color: 'var(--accent)', marginBottom: 10, wordBreak: 'break-all'
          }}>
            {selector || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>no selector entered</span>}
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>URL to test on</div>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://yourapp.com/login"
            onKeyDown={e => e.key === 'Enter' && runTest()}
            style={{ fontSize: 12, marginBottom: 10, width: '100%' }}
          />

          {hasPriorSteps && (
            <label style={{
              display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10,
              padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
              background: runFromTop ? 'var(--accent-dim)' : 'var(--surface2)',
              border: `1px solid ${runFromTop ? 'rgba(108,99,255,0.3)' : 'var(--border)'}`
            }}>
              <input type="checkbox" checked={runFromTop}
                onChange={e => setRunFromTop(e.target.checked)}
                style={{ width: 'auto', marginTop: 2 }} />
              <span style={{ fontSize: 11, lineHeight: 1.4, color: 'var(--text)' }}>
                Run the <strong>{priorSteps.length}</strong> step{priorSteps.length !== 1 ? 's' : ''} above first,
                then test
                <span style={{ display: 'block', color: 'var(--text-muted)', marginTop: 2 }}>
                  Needed for elements that only appear mid-flow (e.g. a modal after login).
                </span>
              </span>
            </label>
          )}

          <button
            onClick={runTest}
            disabled={testing || !selector?.trim()}
            className="btn-primary"
            style={{ width: '100%', fontSize: 12, padding: '7px 0' }}>
            {testing ? '⏳ Testing…' : '▶ Run Test'}
          </button>

          {result && (
            <div style={{ marginTop: 10 }}>
              {result.ok ? (
                <>
                  {result.ranSteps > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                      Ran {result.ranSteps} step{result.ranSteps !== 1 ? 's' : ''} above, then tested:
                    </div>
                  )}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
                    padding: '6px 10px', borderRadius: 6,
                    background: result.count > 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                    border: `1px solid ${result.count > 0 ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`
                  }}>
                    <span style={{ fontSize: 15 }}>{result.count > 0 ? '✓' : '✗'}</span>
                    <span style={{ fontSize: 13, fontWeight: 700,
                      color: result.count > 0 ? '#10B981' : '#EF4444' }}>
                      {result.count > 0
                        ? `${result.count} element${result.count !== 1 ? 's' : ''} found`
                        : 'No elements found'}
                    </span>
                  </div>

                  {result.elements.map((el, i) => (
                    <div key={i} style={{
                      background: 'var(--surface2)', border: '1px solid var(--border)',
                      borderRadius: 6, padding: '6px 10px', marginBottom: 4, fontSize: 11
                    }}>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 3, alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, fontFamily: 'monospace', color: 'var(--accent)' }}>
                          &lt;{el.tag}&gt;
                        </span>
                        {el.id && (
                          <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>#{el.id}</span>
                        )}
                        <span style={{
                          marginLeft: 'auto', padding: '1px 6px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                          background: el.visible ? 'rgba(16,185,129,0.15)' : 'rgba(156,163,175,0.2)',
                          color: el.visible ? '#10B981' : '#6B7280'
                        }}>
                          {el.visible ? 'visible' : 'hidden'}
                        </span>
                      </div>
                      {el.text && (
                        <div style={{ color: 'var(--text-muted)', overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          "{el.text}"
                        </div>
                      )}
                      {el.class && (
                        <div style={{ fontFamily: 'monospace', color: 'var(--text-muted)',
                          fontSize: 10, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          .{el.class.split(' ').join(' .')}
                        </div>
                      )}
                    </div>
                  ))}

                  {result.count > result.elements.length && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 4 }}>
                      +{result.count - result.elements.length} more — consider a more specific selector
                    </div>
                  )}

                  {result.count !== 1 && strengthenOptions.length > 0 && (onUse || onUseFallback) && (
                    <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
                        🛠 Strengthen this selector
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.4 }}>
                        Unique selectors that pin a single matched element — pick one to replace your selector.
                      </div>
                      <div style={{ display: 'grid', gap: 6 }}>
                        {strengthenOptions.slice(0, 6).map(c => (
                          <div key={c.selector} style={{
                            border: '1px solid rgba(16,185,129,0.4)', borderRadius: 8, padding: '7px 9px',
                            background: 'rgba(16,185,129,0.06)'
                          }}>
                            <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--accent)',
                              wordBreak: 'break-all', marginBottom: 6 }}>{c.selector}</div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {onUse && (
                                <button onClick={() => {
                                  onUse(c.selector)
                                  if (onUseFallback) { const alt = bestFallback(strengthenOptions, c.selector); if (alt) onUseFallback(alt.selector) }
                                  setOpen(false)
                                }} className="btn-primary"
                                  style={{ fontSize: 11, padding: '4px 10px' }}>Use</button>
                              )}
                              {onUseFallback && (
                                <button onClick={() => onUseFallback(c.selector)} className="btn-ghost"
                                  title="Set as the Alt Selector fallback (.or())"
                                  style={{ fontSize: 11, padding: '4px 10px' }}>+ fallback</button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div style={{
                  padding: '8px 10px', borderRadius: 6, fontSize: 12,
                  background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                  color: '#EF4444'
                }}>
                  ✗ {result.error}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Pick Button (element picker) ─────────────────────────────────────────────

function PickButton({ baseUrl, browser, priorSteps = [], onPicked, onPickedFallback }) {
  const [picking, setPicking] = useState(false)
  const [msg, setMsg] = useState(null)
  const [candidates, setCandidates] = useState(null)   // non-null → chooser open
  const ref = useRef(null)

  // Close the chooser on outside click
  useEffect(() => {
    if (!candidates) return
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setCandidates(null) }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [candidates])

  async function pick() {
    if (!baseUrl?.trim()) { setMsg({ type: 'err', text: 'Set a Base URL in the profile first' }); return }
    setPicking(true)
    setMsg(null)
    try {
      const res = await window.api.pickElement({
        url: baseUrl,
        browser: browser || 'chromium',
        baseUrl: baseUrl || '',
        steps: priorSteps,
        runSteps: priorSteps.length > 0
      })
      if (res?.ok) {
        const list = res.candidates || []
        // More than one viable selector → let the tester choose the most robust one.
        if (list.length > 1) {
          setCandidates(list)
        } else {
          onPicked(res.selector)
          setMsg({ type: 'ok', text: `Captured <${res.tag}>${res.ranSteps ? ` (after ${res.ranSteps} steps)` : ''}` })
          setTimeout(() => setMsg(null), 4000)
        }
      } else if (res?.cancelled) {
        setMsg(null)
      } else {
        setMsg({ type: 'err', text: res?.error || 'Could not capture element' })
      }
    } catch (e) {
      setMsg({ type: 'err', text: e?.message || 'Picker error — check DevTools console' })
    } finally {
      setPicking(false)
    }
  }

  function use(sel) {
    onPicked(sel)
    let withFallback = false
    if (onPickedFallback) {
      const alt = bestFallback(candidates, sel)
      if (alt) { onPickedFallback(alt.selector); withFallback = true }
    }
    setCandidates(null)
    setMsg({ type: 'ok', text: withFallback ? 'Selector + auto fallback set' : 'Selector set' })
    setTimeout(() => setMsg(null), 3500)
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={pick}
        disabled={picking}
        title="Open the page and click the element — its selector is captured for you"
        style={{
          padding: '0 8px', height: 30, borderRadius: 6, fontSize: 12, fontWeight: 600,
          background: picking ? 'var(--accent-dim)' : 'var(--surface2)',
          border: `1px solid ${picking ? 'rgba(108,99,255,0.3)' : 'var(--border)'}`,
          color: picking ? 'var(--accent)' : 'var(--text-muted)',
          cursor: picking ? 'default' : 'pointer', whiteSpace: 'nowrap'
        }}>
        {picking ? '◎ Opening…' : '🎯 Pick'}
      </button>

      {candidates && (
        <SelectorChooser
          title="Choose a robust selector"
          candidates={candidates}
          onUse={use}
          onFallback={onPickedFallback ? (sel => { onPickedFallback(sel); setMsg({ type: 'ok', text: 'Fallback set' }) }) : null}
          onClose={() => setCandidates(null)}
        />
      )}

      {msg && (
        <div style={{
          position: 'absolute', top: 36, right: 0, zIndex: 200, width: 210,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
          padding: '8px 10px', fontSize: 11, lineHeight: 1.4,
          color: msg.type === 'err' ? '#EF4444' : '#10B981',
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)'
        }}>
          {msg.type === 'err' ? '✗ ' : '✓ '}{msg.text}
        </div>
      )}
    </div>
  )
}

// Best auto-fallback for a chosen primary: a DIFFERENT unique candidate, preferring a
// different strategy (kind) so the .or() is genuine redundancy, not a near-duplicate.
// All candidates derive from the same clicked element, so any of them re-finds it.
function bestFallback(candidates, primarySel) {
  if (!candidates) return null
  const primary = candidates.find(c => c.selector === primarySel)
  const uniques = candidates.filter(c => c.count === 1 && c.selector !== primarySel)
  return uniques.find(c => c.kind !== primary?.kind) || uniques[0] || null
}

// Shared ranked-candidate list used by both Pick (choose a robust selector) and
// Test → Strengthen (disambiguate a selector that matched 0 or many elements).
// First unique candidate is flagged ★ recommended.
function SelectorChooser({ title, candidates, onUse, onFallback, onClose }) {
  const firstUnique = candidates.findIndex(c => c.count === 1)
  return (
    <div style={{
      position: 'absolute', top: 36, right: 0, zIndex: 300, width: 340,
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      padding: 12, boxShadow: '0 10px 36px rgba(0,0,0,0.45)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
          {title}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15 }}>×</button>
      </div>
      <div style={{ display: 'grid', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
        {candidates.map((c, i) => {
          const unique = c.count === 1
          return (
            <div key={c.selector} style={{
              border: `1px solid ${i === firstUnique ? 'rgba(16,185,129,0.4)' : 'var(--border)'}`,
              borderRadius: 8, padding: '7px 9px',
              background: i === firstUnique ? 'rgba(16,185,129,0.06)' : 'var(--surface2)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
                  color: unique ? '#10B981' : '#F59E0B',
                  background: unique ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)'
                }}>
                  {unique ? '✓ 1 match' : `⚠ ${c.count} matches`}
                </span>
                {i === firstUnique && <span style={{ fontSize: 10, color: '#10B981', fontWeight: 700 }}>★ recommended</span>}
              </div>
              <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--accent)', wordBreak: 'break-all', marginBottom: 6 }}>
                {c.selector}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => onUse(c.selector)} className="btn-primary"
                  style={{ fontSize: 11, padding: '4px 10px' }}>Use</button>
                {onFallback && (
                  <button onClick={() => onFallback(c.selector)} className="btn-ghost"
                    title="Set as the Alt Selector fallback (.or())"
                    style={{ fontSize: 11, padding: '4px 10px' }}>+ fallback</button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Canvas Step ─────────────────────────────────────────────────────────────

function CanvasStep({ step, index, total, onChange, onDelete, onMove, onRemoveGroupEnd, profile, priorSteps = [], collections = [], indent = 0, groupCollapsed = false, onToggleGroup, onUngroup, expanded = true, onToggleExpand, selected = false, onToggleSelect, dragId = null, overId = null, dragGroupActive = false, active = false, onDragStartStep, onDragOverStep, onDropStep, onDragEndStep, onActivate }) {
  // Drag-and-drop wiring shared by the normal card and the group cards.
  const dragging = dragId === step.id || (dragGroupActive && selected)
  const showDropLine = overId === step.id && dragId && dragId !== step.id
  const dragHandlers = {
    onDragOver: dragId ? (e => { e.preventDefault(); onDragOverStep && onDragOverStep(step.id) }) : undefined,
    onDrop: dragId ? (e => { e.preventDefault(); onDropStep && onDropStep(step.id) }) : undefined,
    onMouseDown: () => onActivate && onActivate(step.id)
  }
  const gripProps = {
    draggable: true,
    onDragStart: (e) => { e.stopPropagation(); try { e.dataTransfer.effectAllowed = 'move' } catch {} ; onDragStartStep && onDragStartStep(step.id) },
    onDragEnd: () => onDragEndStep && onDragEndStep(),
    title: 'Drag to move',
    style: { cursor: 'grab', color: 'var(--text-muted)', fontSize: 13, flexShrink: 0, userSelect: 'none', padding: '0 2px' }
  }
  const params = typeof step.params === 'string' ? JSON.parse(step.params) : (step.params || {})
  const def = ACTION_DEFS[step.action] || { label: step.action, params: [], category: 'Interaction' }

  const keyword = params._keyword || CATEGORY_KEYWORD[def.category] || 'When'
  const screenshot = !!params._screenshot
  const skipped = !!params._skip

  let summary = ''
  try { summary = (def.summary ? def.summary(params) : (params.selector || params.url || '')) || '' } catch { summary = '' }

  function updateParam(key, value) {
    const updated = { ...step, params: { ...params, [key]: value } }
    onChange(updated)
  }

  function cycleKeyword() {
    const opts = ['Given', 'When', 'Then']
    const next = opts[(opts.indexOf(keyword) + 1) % opts.length]
    updateParam('_keyword', next)
  }

  const isLoop = isGroupStart(step.action) || isGroupEnd(step.action)
  const borderColor = isLoop ? 'var(--accent)' : (KEYWORD_COLOR[keyword] || KEYWORD_COLOR.When)

  // --- Group start: a named, collapsible block with an optional "repeat per data set" ---
  if (isGroupStart(step.action)) {
    const col = collections.find(c => c.id === params.collectionId)
    const grp = params.group || 'positive'
    const n = col ? col.sets.filter(s => grp === 'all' || s.group_type === grp).length : 0
    const repeat = step.action === 'loopStart' || !!params.repeat
    return (
      <div {...dragHandlers} style={{ border: `1px solid ${active ? 'var(--accent)' : 'var(--accent)'}`, borderRadius: 8, marginBottom: 8, marginLeft: indent * 18,
        background: 'var(--accent-dim)', opacity: dragging ? 0.4 : (skipped ? 0.55 : 1),
        boxShadow: showDropLine ? '0 -3px 0 -1px var(--accent)' : (active ? '0 0 0 2px var(--accent)' : undefined) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', flexWrap: 'wrap' }}>
          <span {...gripProps}>⠿</span>
          {onToggleSelect && (
            <input type="checkbox" checked={selected} onChange={onToggleSelect}
              onClick={e => e.stopPropagation()} title="Select the whole group (its steps too)"
              style={{ width: 'auto', flexShrink: 0, cursor: 'pointer', margin: 0 }} />
          )}
          <button onClick={onToggleGroup} title={groupCollapsed ? 'Expand group' : 'Collapse group'}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            {groupCollapsed ? '▸' : '▾'} ⊞
          </button>
          <input value={step.label || ''} onChange={e => onChange({ ...step, label: e.target.value })}
            placeholder="Group name" style={{ fontFamily: 'var(--font-hand)', fontSize: 15, color: 'var(--ink)',
              background: 'transparent', border: 'none', borderBottom: '1px dashed var(--border)', minWidth: 120 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={repeat} onChange={e => updateParam('repeat', e.target.checked)}
              style={{ width: 'auto', margin: 0 }} disabled={step.action === 'loopStart'} />
            🔁 repeat for each data set
          </label>
          {repeat && (
            <>
              <select value={params.collectionId || ''} onChange={e => updateParam('collectionId', e.target.value)} style={{ fontSize: 12 }}>
                <option value="">— collection —</option>
                {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={grp} onChange={e => updateParam('group', e.target.value)} style={{ fontSize: 12 }}>
                <option value="positive">📗 Positive</option>
                <option value="negative">📕 Negative</option>
                <option value="edge">📒 Edge</option>
                <option value="all">All groups</option>
              </select>
            </>
          )}
          {skipped && (
            <span title="This group is skipped — none of its steps run. Click ⊘ to re-enable."
              style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--surface2)',
                border: '1px solid var(--border)', borderRadius: 999, padding: '1px 7px' }}>SKIPPED</span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            <button onClick={() => updateParam('_skip', !skipped)}
              title={skipped ? 'Skipped — click to re-enable this group' : 'Skip this whole group (don’t run its steps)'}
              style={{ background: skipped ? 'rgba(245,158,11,0.14)' : 'none',
                border: skipped ? '1px solid rgba(245,158,11,0.4)' : '1px solid transparent',
                color: skipped ? '#F59E0B' : 'var(--text-muted)', borderRadius: 6, padding: '3px 7px', fontSize: 13, cursor: 'pointer' }}>⊘</button>
            <button onClick={() => onMove(step.id, 'up')} title="Move group up"
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '3px 5px', cursor: 'pointer' }}>↑</button>
            <button onClick={() => onMove(step.id, 'down')} title="Move group down"
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '3px 5px', cursor: 'pointer' }}>↓</button>
            <button onClick={onUngroup} title="Remove the group (keep the steps)"
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>⊟ Ungroup</button>
          </div>
        </div>
        {repeat && (
          <div style={{ padding: '0 12px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
            {col ? `↻ Steps in this group run ${n} time${n !== 1 ? 's' : ''} — once per ${grp === 'all' ? '' : grp + ' '}set, with that set's {{tokens}}.` : 'Pick a collection to repeat over.'}
          </div>
        )}
      </div>
    )
  }

  // --- Group end: a thin closing marker (also a drop target → drop here = last in group).
  // Has its own grip (drag moves the whole group, kept balanced) and an ✕ to remove it. ---
  if (isGroupEnd(step.action)) {
    return (
      <div {...dragHandlers} style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: indent * 18,
        marginBottom: 8, padding: '3px 12px', borderLeft: '2px dashed var(--accent)',
        opacity: dragging ? 0.4 : 0.75,
        boxShadow: showDropLine ? '0 -3px 0 -1px var(--accent)' : (active ? '0 0 0 2px var(--accent)' : undefined) }}>
        <span {...gripProps}>⠿</span>
        <span style={{ flex: 1, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
          textTransform: 'uppercase', color: 'var(--accent)' }}>⊞ end group</span>
        <button onClick={() => onRemoveGroupEnd && onRemoveGroupEnd(step.id)} title="Remove this group marker"
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: 13, padding: '0 4px', lineHeight: 1 }}>✕</button>
      </div>
    )
  }

  // --- Comment: a free-text note for human readers; does nothing at run time ---
  if (step.action === 'comment') {
    return (
      <div {...dragHandlers} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginLeft: indent * 18,
        marginBottom: 8, padding: '8px 10px', border: '1px dashed #E2C770', borderRadius: 8,
        background: 'rgba(245,200,80,0.10)', opacity: dragging ? 0.4 : 1,
        boxShadow: showDropLine ? '0 -3px 0 -1px var(--accent)' : (active ? '0 0 0 2px var(--accent)' : undefined) }}>
        <span {...gripProps} style={{ ...gripProps.style, paddingTop: 2 }}>⠿</span>
        <span style={{ fontSize: 13, flexShrink: 0, paddingTop: 1 }}>💬</span>
        <textarea value={params.text || ''} onChange={e => updateParam('text', e.target.value)} rows={1}
          placeholder="Note for QA readers — ignored when running…"
          style={{ flex: 1, resize: 'vertical', border: 'none', background: 'transparent', fontSize: 12,
            color: 'var(--text)', fontStyle: 'italic', outline: 'none', padding: 0, lineHeight: 1.5 }} />
        <button onClick={() => onDelete(step.id)} title="Delete note"
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: 13, padding: '0 4px', lineHeight: 1 }}>✕</button>
      </div>
    )
  }

  return (
    <div {...dragHandlers} style={{
      border: `1px solid ${selected ? 'rgba(108,99,255,0.45)' : 'var(--border)'}`,
      borderLeft: `3px solid ${borderColor}`,
      borderRadius: 8,
      marginBottom: 8,
      marginLeft: indent * 18,
      opacity: dragging ? 0.4 : (skipped ? 0.55 : 1),
      boxShadow: showDropLine ? '0 -3px 0 -1px var(--accent)' : (active ? '0 0 0 2px var(--accent)' : undefined),
      background: selected ? 'var(--accent-dim)' : (isLoop ? 'var(--accent-dim)' : 'var(--bg)')
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
        <span {...gripProps}>⠿</span>
        {onToggleSelect && (
          <input type="checkbox" checked={selected} onChange={onToggleSelect}
            onClick={e => e.stopPropagation()} title="Select for bulk actions"
            style={{ width: 'auto', flexShrink: 0, cursor: 'pointer', margin: 0 }} />
        )}
        <button onClick={cycleKeyword} title="Click to cycle keyword" style={{
          padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
          background: borderColor + '1a', color: borderColor,
          border: `1px solid ${borderColor}44`, cursor: 'pointer', whiteSpace: 'nowrap',
          flexShrink: 0
        }}>
          {keyword}
        </button>

        <button onClick={onToggleExpand} title={expanded ? 'Collapse' : 'Expand'} style={{
          display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0,
          background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0
        }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 10, flexShrink: 0, width: 10 }}>{expanded ? '▾' : '▸'}</span>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', flexShrink: 0,
            textDecoration: skipped ? 'line-through' : 'none' }}>{def.label}</span>
          {skipped && (
            <span title="This step is skipped — it won't run. Click ⊘ to re-enable."
              style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--surface2)',
                border: '1px solid var(--border)', borderRadius: 999, padding: '1px 7px', flexShrink: 0 }}>
              SKIPPED
            </span>
          )}
          {params._smart && (
            <span title="Auto-suggested while recording — a smart wait inserted because this appeared during your pause. Delete it if not needed."
              style={{ fontSize: 10, fontWeight: 700, color: '#A78BFA', background: 'rgba(167,139,250,0.12)',
                border: '1px solid rgba(167,139,250,0.3)', borderRadius: 999, padding: '1px 7px', flexShrink: 0 }}>
              ✨ auto
            </span>
          )}
          {!expanded && summary && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
          )}
          {!expanded && step.label && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', flexShrink: 0 }}>· {step.label}</span>
          )}
        </button>

        <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexShrink: 0 }}>
          <button onClick={() => updateParam('_skip', !skipped)}
            title={skipped ? 'Skipped — click to re-enable this step' : 'Skip this step (keep it, but don’t run it)'}
            style={{
              background: skipped ? 'rgba(245,158,11,0.14)' : 'none',
              border: skipped ? '1px solid rgba(245,158,11,0.4)' : '1px solid transparent',
              color: skipped ? '#F59E0B' : 'var(--text-muted)',
              borderRadius: 6, padding: '3px 7px', fontSize: 13, cursor: 'pointer'
            }}>⊘</button>
          <button onClick={() => updateParam('_screenshot', !screenshot)}
            title={screenshot ? 'Screenshot ON — click to disable' : 'Click to capture screenshot after this step'}
            style={{
              background: screenshot ? 'rgba(16,185,129,0.12)' : 'none',
              border: screenshot ? '1px solid rgba(16,185,129,0.35)' : '1px solid transparent',
              color: screenshot ? '#10B981' : 'var(--text-muted)',
              borderRadius: 6, padding: '3px 7px', fontSize: 13, cursor: 'pointer'
            }}>📷</button>
          <button onClick={() => onMove(step.id, 'up')} disabled={index === 0}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '3px 5px', cursor: 'pointer', opacity: index === 0 ? 0.3 : 1 }}>↑</button>
          <button onClick={() => onMove(step.id, 'down')} disabled={index === total - 1}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '3px 5px', cursor: 'pointer', opacity: index === total - 1 ? 0.3 : 1 }}>↓</button>
          <button onClick={() => onDelete(step.id)}
            style={{ background: 'none', border: 'none', color: 'var(--error)', padding: '3px 6px', cursor: 'pointer', fontSize: 15 }}>×</button>
        </div>
      </div>

      {/* Step label + params */}
      {expanded && (
      <div style={{ padding: '0 12px 12px', display: 'grid', gap: 6 }}>
        <ParamRow label="Label">
          <input value={step.label || ''} placeholder="Step description (optional)"
            onChange={e => onChange({ ...step, label: e.target.value })}
            style={{ fontSize: 12 }} />
        </ParamRow>

        {def.params.map(p => {
          const isSelector = p.key === 'selector' || p.key === 'selector2' || p.key === 'source' || p.key === 'target'
          return (
            <ParamRow key={p.key} label={p.label}>
              {p.type === 'boolean' ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={!!params[p.key]}
                    onChange={e => updateParam(p.key, e.target.checked)} style={{ width: 'auto' }} />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.label}</span>
                </label>
              ) : p.type === 'select' ? (
                <select value={params[p.key] || p.default || ''}
                  onChange={e => updateParam(p.key, e.target.value)} style={{ fontSize: 12 }}>
                  {p.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : p.type === 'textarea' ? (
                <div style={{ display: 'grid', gap: 4 }}>
                  <textarea rows={2} value={params[p.key] || ''} placeholder={p.placeholder || ''}
                    onChange={e => updateParam(p.key, e.target.value)} style={{ fontSize: 12 }} />
                  {collections.length > 0 && (
                    <div style={{ justifySelf: 'end' }}>
                      <TokenButton collections={collections} onInsert={tok => updateParam(p.key, (params[p.key] || '') + tok)} />
                    </div>
                  )}
                </div>
              ) : isSelector ? (
                <div style={{ display: 'flex', gap: 4 }}>
                  <input type="text" value={params[p.key] || ''} placeholder={p.placeholder || ''}
                    onChange={e => updateParam(p.key, e.target.value)}
                    style={{ fontSize: 12, flex: 1, minWidth: 0 }} />
                  <PickButton
                    baseUrl={profile?.base_url}
                    browser={profile?.browser}
                    priorSteps={priorSteps}
                    onPicked={sel => updateParam(p.key, sel)}
                    onPickedFallback={p.key === 'selector' ? (sel => updateParam('selector2', sel)) : null}
                  />
                  <TestSelectorButton
                    selector={params[p.key]}
                    baseUrl={profile?.base_url}
                    browser={profile?.browser}
                    priorSteps={priorSteps}
                    onUse={sel => updateParam(p.key, sel)}
                    onUseFallback={p.key === 'selector' ? (sel => updateParam('selector2', sel)) : null}
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 4 }}>
                  <input type={p.type || 'text'} value={params[p.key] || ''} placeholder={p.placeholder || ''}
                    onChange={e => updateParam(p.key, e.target.value)} style={{ fontSize: 12, flex: 1, minWidth: 0 }} />
                  {/* Token insert — only where a {{token}} makes sense (skip numeric params). */}
                  {collections.length > 0 && p.type !== 'number' && (
                    <TokenButton collections={collections} onInsert={tok => updateParam(p.key, (params[p.key] || '') + tok)} />
                  )}
                </div>
              )}
            </ParamRow>
          )
        })}

        <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 8, display: 'grid', gap: 6 }}>
          <ParamRow label="Notes">
            <input value={params._notes || ''} placeholder="What this step does"
              onChange={e => updateParam('_notes', e.target.value)} style={{ fontSize: 12 }} />
          </ParamRow>
          <ParamRow label="Expected">
            <input value={params._expected || ''} placeholder="Expected result"
              onChange={e => updateParam('_expected', e.target.value)} style={{ fontSize: 12 }} />
          </ParamRow>
        </div>
      </div>
      )}
    </div>
  )
}

// Insert a Test Data token ({{Collection.field}}) or a dynamic value into a param —
// so testers don't have to remember the token syntax. Appends to the current value.
const DYNAMIC_TOKENS = [
  { label: 'Unique ref', token: '{{unique.ref}}' },
  { label: 'Unique email', token: '{{unique.email}}' },
  { label: 'Unique number', token: '{{unique.number}}' },
  { label: 'Timestamp', token: '{{unique.timestamp}}' },
  { label: 'Faker — first name', token: '{{faker.person.firstName}}' },
  { label: 'Faker — email', token: '{{faker.internet.email}}' }
]

function TokenButton({ collections, onInsert }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  function pick(token) { onInsert(token); setOpen(false) }

  const hdr = { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
    color: 'var(--text-muted)', padding: '6px 10px 2px' }
  const item = { display: 'block', width: '100%', textAlign: 'left', padding: '5px 10px', background: 'none',
    border: 'none', color: 'var(--text)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-mono)' }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button type="button" title="Insert Test Data token" onClick={() => setOpen(o => !o)}
        style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6,
          color: 'var(--accent)', padding: '5px 8px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        {'{ }'}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 30, marginTop: 4, minWidth: 200, maxHeight: 280,
          overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
          boxShadow: '0 6px 20px rgba(0,0,0,.18)' }}>
          {collections.map(c => (
            <div key={c.id}>
              <div style={hdr}>{c.name}</div>
              {c.fields.length === 0 ? (
                <div style={{ ...item, color: 'var(--text-muted)', cursor: 'default', fontFamily: 'inherit' }}>no fields</div>
              ) : c.fields.map(f => (
                <button key={f.id} type="button" style={item} onClick={() => pick(`{{${c.name}.${f.name}}}`)}>
                  {f.name}
                </button>
              ))}
            </div>
          ))}
          <div style={hdr}>Dynamic</div>
          {DYNAMIC_TOKENS.map(d => (
            <button key={d.token} type="button" style={{ ...item, fontFamily: 'inherit' }} onClick={() => pick(d.token)}>
              {d.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Derive a sensible field name from a selector (#Username → Username, [name=email] → email).
function fieldNameFromSelector(sel) {
  if (!sel) return ''
  let m = sel.match(/#([\w-]+)/);                 if (m) return m[1]
  m = sel.match(/name=["']?([\w.-]+)/);            if (m) return m[1]
  m = sel.match(/data-testid=["']?([\w.-]+)/);     if (m) return m[1]
  m = sel.match(/\.([\w-]+)/);                     if (m) return m[1]
  return sel.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24)
}

const VALUE_ACTIONS = { fill: true, type: true, selectOption: true }
const INTENTS = [{ k: 'positive', l: '📗 Positive' }, { k: 'negative', l: '📕 Negative' }, { k: 'edge', l: '📒 Edge' }]

// Steps come back from storage with params as a JSON string (see CanvasStep) — parse safely.
function stepParams(s) {
  try { return typeof s.params === 'string' ? JSON.parse(s.params) : (s.params || {}) } catch { return {} }
}

// Inline test-data creator: prefills field/value rows from this scenario's fill steps
// (so you "demonstrate" the form once), and lets you add rows by hand. Saves to the same
// data_* tables the Test Data pane uses, then optionally rewrites the steps to {{tokens}}.
function CaptureDataModal({ steps, collections, defaultName, onClose, onSaved }) {
  function initialRows() {
    const used = new Set(); const rows = []
    for (const s of steps) {
      if (!VALUE_ACTIONS[s.action]) continue
      const p = stepParams(s)
      const val = p.value
      if (val == null || val === '' || String(val).includes('{{')) continue   // skip blank / already tokenized
      let name = fieldNameFromSelector(p.selector) || `field${rows.length + 1}`
      const base = name; let n = 2
      while (used.has(name.toLowerCase())) name = `${base}${n++}`
      used.add(name.toLowerCase())
      rows.push({ include: true, name, value: String(val), selector: p.selector || '', stepId: s.id })
    }
    return rows
  }

  const [target, setTarget] = useState('__new__')   // '__new__' or an existing collection id
  const [name, setName]     = useState(defaultName || '')
  const [intent, setIntent] = useState('positive')
  const [tokenize, setTokenize] = useState(true)
  const [rows, setRows]     = useState(initialRows)
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)

  const setRow    = (i, patch) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r))
  const addRow    = () => setRows(rs => [...rs, { include: true, name: `field${rs.length + 1}`, value: '', selector: '', stepId: null }])
  const removeRow = (i) => setRows(rs => rs.filter((_, j) => j !== i))

  async function save() {
    const incl = rows.filter(r => r.include && r.name.trim())
    if (!incl.length) { setErr('Tick at least one field to save'); return }
    if (target === '__new__' && !name.trim()) { setErr('Name the new collection'); return }
    setSaving(true); setErr(null)
    try {
      let collectionId, collectionName, startOrder = 0, existing = new Set()
      if (target === '__new__') {
        const res = await window.api.saveCollection({ name: name.trim() })
        collectionId = res.id; collectionName = name.trim()
      } else {
        const c = collections.find(x => x.id === target)
        collectionId = c.id; collectionName = c.name; startOrder = c.fields.length
        existing = new Set(c.fields.map(f => f.name.toLowerCase()))
      }
      let order = startOrder
      for (const r of incl) {
        if (existing.has(r.name.trim().toLowerCase())) continue   // keep the existing field as-is
        await window.api.saveField({ collection_id: collectionId, name: r.name.trim(), type: 'text', selector: r.selector || '', sort_order: order++ })
      }
      const values = {}; for (const r of incl) values[r.name.trim()] = r.value
      const setCount = target === '__new__' ? 0 : (collections.find(x => x.id === target)?.sets.filter(s => s.group_type === intent).length || 0)
      await window.api.saveDataSet({ collection_id: collectionId, name: `${intent} set ${setCount + 1}`, group_type: intent, values, sort_order: setCount })

      const tokenizations = tokenize
        ? incl.filter(r => r.stepId).map(r => ({ stepId: r.stepId, token: `{{${collectionName}.${r.name.trim()}}}` }))
        : []
      await onSaved(tokenizations)
    } catch (e) {
      setErr(e?.message || 'Could not save'); setSaving(false)
    }
  }

  const capturedCount = rows.filter(r => r.stepId).length
  const lbl = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
        width: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ padding: '18px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Capture / create test data</h2>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 14px' }}>
            {capturedCount > 0
              ? `Pulled ${capturedCount} value${capturedCount !== 1 ? 's' : ''} from this scenario's fill steps. Edit names, then save.`
              : 'No literal fill values found in this scenario — add fields by hand below.'}
          </p>
        </div>

        <div style={{ overflow: 'auto', padding: '0 20px', display: 'grid', gap: 12 }}>
          {/* Target collection */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={lbl}>Save to</span>
            <select value={target} onChange={e => setTarget(e.target.value)} style={{ fontSize: 12 }}>
              <option value="__new__">➕ New collection</option>
              {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {target === '__new__' && (
              <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Collection name (e.g. Login)"
                style={{ fontSize: 12, flex: 1, minWidth: 160 }} />
            )}
          </div>

          {/* Field rows */}
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 1.3fr 28px', gap: 8, ...lbl }}>
              <span /><span>Field name</span><span>Value</span><span />
            </div>
            {rows.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>No fields yet — add one below.</p>}
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '24px 1fr 1.3fr 28px', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={r.include} onChange={e => setRow(i, { include: e.target.checked })} style={{ width: 'auto' }} />
                <input value={r.name} onChange={e => setRow(i, { name: e.target.value })}
                  style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}
                  title={r.selector ? `from ${r.selector}` : ''} />
                <input value={r.value} onChange={e => setRow(i, { value: e.target.value })} style={{ fontSize: 12 }} />
                <button onClick={() => removeRow(i)} title="Remove"
                  style={{ background: 'none', border: 'none', color: 'var(--error)', fontSize: 15, cursor: 'pointer' }}>×</button>
              </div>
            ))}
            <button onClick={addRow} style={{ justifySelf: 'start', background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--accent)', fontSize: 12, fontWeight: 600, padding: '5px 12px', cursor: 'pointer' }}>+ Add field</button>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: 16, borderTop: '1px solid var(--border)', marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={lbl}>Group</span>
          <select value={intent} onChange={e => setIntent(e.target.value)} style={{ fontSize: 12 }}>
            {INTENTS.map(g => <option key={g.k} value={g.k}>{g.l}</option>)}
          </select>
          {capturedCount > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={tokenize} onChange={e => setTokenize(e.target.checked)} style={{ width: 'auto' }} />
              Replace step values with {'{{tokens}}'}
            </label>
          )}
          {err && <span style={{ fontSize: 12, color: 'var(--error)' }}>{err}</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={onClose} className="btn btn-sm">Cancel</button>
            <button onClick={save} disabled={saving} className="btn-primary"
              style={{ padding: '6px 16px', fontSize: 13 }}>{saving ? 'Saving…' : 'Save test data'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ParamRow({ label, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'start' }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
        color: 'var(--text-muted)', paddingTop: 7 }}>
        {label}
      </span>
      {children}
    </div>
  )
}

// ─── Profile Picker ───────────────────────────────────────────────────────────

function ProfilePicker({ navigate, onPick }) {
  const [profiles, setProfiles] = useState([])
  useEffect(() => { window.api.getProfiles().then(setProfiles) }, [])

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Scenario Builder</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>Pick a profile to build scenarios for:</p>
      {profiles.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>No profiles yet.</p>
          <button className="btn-primary" onClick={() => navigate('profile')}>+ Create Profile</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10, maxWidth: 480 }}>
          {profiles.map(p => (
            <div key={p.id} className="card" style={{ cursor: 'pointer', padding: '14px 18px' }}
              onClick={() => onPick(p)}>
              <div style={{ fontWeight: 700 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                {p.browser} · {p.base_url}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Copy-scenario-to-another-profile button ─────────────────────────────────

function CopyToProfileButton({ currentProfileId, scenarioId }) {
  const [open, setOpen]         = useState(false)
  const [profiles, setProfiles] = useState([])
  const [msg, setMsg]           = useState(null)
  const ref = useRef(null)

  useEffect(() => {
    if (open) window.api.getProfiles().then(list => setProfiles(list.filter(p => p.id !== currentProfileId)))
  }, [open, currentProfileId])

  useEffect(() => {
    if (!open) return
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  async function copy(target) {
    const res = await window.api.copyScenarios([scenarioId], target.id)
    setOpen(false)
    setMsg(res?.ok ? `✓ Copied to ${target.name}` : `✗ ${res?.error || 'Copy failed'}`)
    setTimeout(() => setMsg(null), 3000)
  }

  const btnStyle = {
    padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer'
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={btnStyle} title="Copy this scenario into another profile">⧉ Copy to…</button>
      {msg && <span style={{ fontSize: 11, marginLeft: 8, color: msg.startsWith('✓') ? '#10B981' : '#EF4444' }}>{msg}</span>}
      {open && (
        <div style={{
          position: 'absolute', top: 32, right: 0, zIndex: 200, width: 220,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)'
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            color: 'var(--text-muted)', padding: '4px 8px' }}>Copy into profile</div>
          {profiles.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px' }}>No other profiles yet.</div>
          ) : profiles.map(p => (
            <button key={p.id} onClick={() => copy(p)} style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '7px 8px', borderRadius: 6,
              background: 'transparent', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: 12
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              {p.name}
              <span style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)' }}>{p.base_url}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Copy-selected-steps-to-another-scenario button ──────────────────────────

function CopyStepsToScenarioButton({ scenarios, currentScenarioId, stepIds, onCopied }) {
  const [open, setOpen] = useState(false)
  const [msg, setMsg]   = useState(null)
  const ref = useRef(null)
  const targets = scenarios.filter(s => s.id !== currentScenarioId)

  useEffect(() => {
    if (!open) return
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  async function copy(target) {
    const res = await window.api.copySteps(stepIds, target.id)
    setOpen(false)
    if (res?.ok) { setMsg(`✓ Copied ${res.count} to ${target.name}`); onCopied && onCopied() }
    else setMsg(`✗ ${res?.error || 'Copy failed'}`)
    setTimeout(() => setMsg(null), 3000)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} title="Copy the selected steps into another scenario"
        style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6,
          padding: '5px 8px', fontSize: 11, fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}>
        ⧉ Copy to scenario…
      </button>
      {msg && <span style={{ fontSize: 11, marginLeft: 8, color: msg.startsWith('✓') ? '#10B981' : '#EF4444' }}>{msg}</span>}
      {open && (
        <div style={{
          position: 'absolute', top: 32, left: 0, zIndex: 200, width: 220,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)'
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            color: 'var(--text-muted)', padding: '4px 8px' }}>Append {stepIds.length} step{stepIds.length !== 1 ? 's' : ''} to</div>
          {targets.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px' }}>No other scenarios in this profile.</div>
          ) : targets.map(s => (
            <button key={s.id} onClick={() => copy(s)} style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '7px 8px', borderRadius: 6,
              background: 'transparent', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: 12
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── A single scenario row (drag handle + inline rename + ⋯ menu) ─────────────

function ScenarioRow({
  s, active, editing, editName, setEditName,
  onSelect, onStartRename, onCommitRename, onCancelRename, onDuplicate, onDelete, onToggleSkip, onToggleLock,
  dragEnabled, isOver, isDragging, onDragStart, onDragEnd, onDragOver, onDrop
}) {
  const skipped = !!s.skipped
  const locked = !!s.locked
  const [menu, setMenu] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const menuRef = useRef(null)
  const btnRef = useRef(null)
  useEffect(() => {
    if (!menu) return
    const h = e => {
      if (menuRef.current && !menuRef.current.contains(e.target) && btnRef.current && !btnRef.current.contains(e.target)) setMenu(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [menu])

  // The scenario list scrolls (overflow:auto), which would clip an in-flow dropdown — so the menu
  // is position:fixed, anchored to the ⋯ button via its on-screen rect.
  function toggleMenu(e) {
    e.stopPropagation()
    if (!menu && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setMenuPos({ top: r.bottom + 4, left: r.right - 150 })
    }
    setMenu(o => !o)
  }

  const item = { display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 6,
    background: 'transparent', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }
  const hov = e => e.currentTarget.style.background = 'var(--surface2)'
  const out = e => e.currentTarget.style.background = 'transparent'

  return (
    <div onClick={() => onSelect(s)} onDragOver={onDragOver} onDrop={onDrop}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '6px 6px 6px 4px', borderRadius: 6, cursor: 'pointer', marginBottom: 2,
        opacity: isDragging ? 0.4 : (skipped ? 0.5 : 1),
        background: active ? 'var(--accent-dim)' : 'transparent',
        border: active ? '1px solid rgba(108,99,255,0.2)' : '1px solid transparent',
        boxShadow: isOver ? '0 -2px 0 0 var(--accent)' : undefined,
        color: active ? 'var(--accent)' : 'var(--text)',
        fontWeight: active ? 700 : 400, fontSize: 13
      }}>
      {dragEnabled && editing !== s.id && (
        <span draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={e => e.stopPropagation()}
          title="Drag to reorder (Run All runs top → bottom)"
          style={{ cursor: 'grab', color: 'var(--text-muted)', fontSize: 13, flexShrink: 0, lineHeight: 1 }}>⠿</span>
      )}
      {editing === s.id ? (
        <input autoFocus value={editName} onClick={e => e.stopPropagation()}
          onChange={e => setEditName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onCommitRename(s); else if (e.key === 'Escape') onCancelRename() }}
          onBlur={() => onCommitRename(s)}
          style={{ fontSize: 13, flex: 1, minWidth: 0, padding: '2px 6px' }} />
      ) : (
        <span onDoubleClick={e => { e.stopPropagation(); if (!locked) onStartRename(s) }}
          title={locked ? 'Locked — steps are read-only' : (skipped ? 'Skipped — excluded from Run All' : 'Double-click to rename')}
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
            textDecoration: skipped ? 'line-through' : 'none' }}>
          {locked && <span style={{ marginRight: 4 }}>🔒</span>}{skipped && <span style={{ marginRight: 4 }}>⊘</span>}{s.name}
        </span>
      )}
      <div style={{ flexShrink: 0 }}>
        <button ref={btnRef} onClick={toggleMenu} title="More…"
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: 16, lineHeight: 1, padding: '0 4px' }}>⋯</button>
        {menu && (
          <div ref={menuRef} style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 1000, width: 150,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 5,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
            {!locked && (
              <button style={item} onMouseEnter={hov} onMouseLeave={out}
                onClick={e => { e.stopPropagation(); setMenu(false); onStartRename(s) }}>✎ Rename</button>
            )}
            <button style={item} onMouseEnter={hov} onMouseLeave={out}
              onClick={e => { e.stopPropagation(); setMenu(false); onDuplicate(s.id) }}>⧉ Duplicate</button>
            <button style={item} onMouseEnter={hov} onMouseLeave={out}
              onClick={e => { e.stopPropagation(); setMenu(false); onToggleLock(s.id) }}>
              {locked ? '🔓 Unlock editing' : '🔒 Lock editing'}</button>
            {!locked && (
              <button style={item} onMouseEnter={hov} onMouseLeave={out}
                onClick={e => { e.stopPropagation(); setMenu(false); onToggleSkip(s.id) }}>
                {skipped ? '✓ Unskip' : '⊘ Skip in Run All'}</button>
            )}
            <button style={{ ...item, color: '#EF4444' }} onMouseEnter={hov} onMouseLeave={out}
              onClick={e => { e.stopPropagation(); setMenu(false); onDelete(s.id) }}>🗑 Delete</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main ScenarioBuilder ─────────────────────────────────────────────────────

export default function ScenarioBuilder({ navigate, ctx }) {
  const [profileId, setProfileId]     = useState(ctx?.profileId || null)
  const [profileName, setProfileName] = useState(ctx?.profileName || '')
  const [profile, setProfile]         = useState(null)
  const [scenarios, setScenarios]     = useState([])
  const [active, setActive]           = useState(null)   // active scenario
  const [steps, setSteps]             = useState([])
  const [newName, setNewName]         = useState('')
  const [editingId, setEditingId]     = useState(null)   // scenario being renamed inline
  const [editName, setEditName]       = useState('')
  const [scenarioSearch, setScenarioSearch] = useState('')   // filter the scenario list
  const [dragSid, setDragSid]         = useState(null)   // scenario being dragged
  const [overSid, setOverSid]         = useState(null)   // scenario drop target (highlight)
  const [search, setSearch]           = useState('')
  const [exporting, setExporting]     = useState(false)
  const [shareMsg, setShareMsg]       = useState(null)
  const [dupMsg, setDupMsg]           = useState(null)
  const [recording, setRecording]     = useState(false)
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set())   // groupStart ids hidden
  const [dragId, setDragId] = useState(null)     // step/group being dragged
  const [overId, setOverId] = useState(null)     // drop-before target (for the indicator line)
  const [activeId, setActiveId] = useState(null) // last-clicked step (highlight)
  const [collections, setCollections] = useState([])
  const [fillMenu, setFillMenu]       = useState(false)   // "Fill form" collection picker open
  const [dataModal, setDataModal]     = useState(false)   // capture/create test data inline
  const saveChain                     = useRef(Promise.resolve())   // serialize background step saves

  function toggleExpand(id) {
    setExpandedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  // Expand/Collapse all also opens/closes every group block (not just step-card params).
  const expandAll   = () => { setExpandedIds(new Set(steps.map(s => s.id))); setCollapsedGroups(new Set()) }
  const collapseAll = () => { setExpandedIds(new Set()); setCollapsedGroups(new Set(steps.filter(s => isGroupStart(s.action)).map(s => s.id))) }

  // Ticking a group's checkbox selects (or clears) the whole block — its inner steps and
  // any nested groups too. A plain step toggles just itself.
  function toggleSelect(id) {
    const idx = steps.findIndex(s => s.id === id)
    setSelectedIds(prev => {
      const n = new Set(prev)
      if (idx >= 0 && isGroupStart(steps[idx].action)) {
        const [us, ue] = unitRange(steps, idx)
        const selecting = !n.has(id)   // follow the group marker's own state
        for (let k = us; k <= ue; k++) selecting ? n.add(steps[k].id) : n.delete(steps[k].id)
      } else {
        n.has(id) ? n.delete(id) : n.add(id)
      }
      return n
    })
  }
  const selectAll       = () => setSelectedIds(new Set(steps.map(s => s.id)))
  const clearSelection  = () => setSelectedIds(new Set())

  async function deleteSelected() {
    if (selectedIds.size === 0 || active?.locked) return
    const n = selectedIds.size
    if (!(await confirmDialog(`Delete ${n} selected step${n !== 1 ? 's' : ''}? This can't be undone.`, { confirmText: 'Delete' }))) return
    for (const id of selectedIds) await window.api.deleteStep(id)
    setSteps(prev => prev.filter(s => !selectedIds.has(s.id)))
    setSelectedIds(new Set())
  }

  // Wrap the selected steps (by their span min..max) in a groupStart/groupEnd pair.
  async function groupSelected() {
    if (!active || active.locked || selectedIds.size === 0) return
    const idxs = steps.map((s, i) => selectedIds.has(s.id) ? i : -1).filter(i => i >= 0)
    const min = Math.min(...idxs), max = Math.max(...idxs)
    // The span must contain whole groups only (balanced markers) — else wrapping it would
    // cross an existing group boundary. Nesting a group fully inside another is fine.
    let d = 0, balanced = true
    for (let k = min; k <= max; k++) {
      if (isGroupStart(steps[k].action)) d++
      else if (isGroupEnd(steps[k].action)) { d--; if (d < 0) { balanced = false; break } }
    }
    if (!balanced || d !== 0) {
      await confirmDialog('That selection splits an existing group. Pick whole groups, or steps within a single group.', { confirmText: 'OK' })
      return
    }
    const gs = await window.api.saveStep({ scenario_id: active.id, action: 'groupStart',
      params: { _keyword: 'When', label: 'Group', repeat: false, group: 'positive' }, label: 'Group', sort_order: 0 })
    const ge = await window.api.saveStep({ scenario_id: active.id, action: 'groupEnd', params: {}, label: '', sort_order: 0 })
    const ids = steps.map(s => s.id)
    const order = [...ids.slice(0, min), gs.id, ...ids.slice(min, max + 1), ge.id, ...ids.slice(max + 1)]
    await window.api.reorderSteps(active.id, order)
    setSteps(await window.api.getSteps(active.id))
    setSelectedIds(new Set())
    if (gs.id) setExpandedIds(prev => new Set(prev).add(gs.id))
  }

  const toggleGroupCollapse = (id) =>
    setCollapsedGroups(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  // Remove a group's markers (keep the inner steps in place).
  async function ungroupGroup(groupStartId) {
    if (active?.locked) return
    const i = steps.findIndex(s => s.id === groupStartId)
    if (i < 0) return
    let j = i + 1
    while (j < steps.length && !isGroupEnd(steps[j].action)) j++
    await window.api.deleteStep(groupStartId)
    if (j < steps.length) await window.api.deleteStep(steps[j].id)
    setSteps(await window.api.getSteps(active.id))
  }

  // Remove an "End group" marker. If it has a depth-matched start it's a real group, so we
  // ungroup the pair (markers go, inner steps stay). A stray/orphan end just gets deleted.
  async function removeGroupEnd(endId) {
    if (active?.locked) return
    const arr = steps
    const idx = arr.findIndex(s => s.id === endId)
    if (idx < 0) return
    let depth = 1, j = idx - 1
    while (j >= 0) {
      if (isGroupEnd(arr[j].action)) depth++
      else if (isGroupStart(arr[j].action)) { depth--; if (depth === 0) break }
      j--
    }
    await window.api.deleteStep(endId)
    if (j >= 0 && depth === 0) await window.api.deleteStep(arr[j].id)   // matched pair → drop the start too
    setSteps(await window.api.getSteps(active.id))
  }

  useEffect(() => {
    if (profileId) {
      loadScenarios()
      window.api.getProfiles().then(list => {
        const p = list.find(x => x.id === profileId)
        if (p) setProfile(p)
      })
    }
  }, [profileId])

  // Test Data collections power the "Fill form" one-click step generator.
  useEffect(() => { window.api.getCollections().then(setCollections).catch(() => {}) }, [])

  async function loadScenarios() {
    const data = await window.api.getScenarios(profileId)
    setScenarios(data)
    if (data.length && !active) selectScenario(data[0])
  }

  async function selectScenario(scenario) {
    setActive(scenario)
    setExpandedIds(new Set())   // collapse for a clean overview on switch
    setSelectedIds(new Set())   // drop any bulk selection from the previous scenario
    setCollapsedGroups(new Set())
    const s = await window.api.getSteps(scenario.id)
    setSteps(s)
  }

  async function setPrerequisite(preId) {
    if (!active || active.locked) return
    const updated = { ...active, prerequisite_id: preId || null }
    await window.api.saveScenario(updated)
    setActive(updated)
    setScenarios(await window.api.getScenarios(profileId))
  }

  // Inline message instead of a native alert(): on Windows a native modal leaves the webContents
  // without keyboard focus, so the NEXT screen's inputs go dead (e.g. renaming the copy in Edit
  // Profile). lib/confirm + inline toasts exist precisely to avoid native modals.
  async function duplicateProfile() {
    const res = await window.api.duplicateProfile(profileId)
    setDupMsg(res?.id
      ? `✓ Duplicated as "${profileName} (copy)" — open it from the Dashboard, then change its Base URL`
      : `✗ ${res?.error || 'Could not duplicate profile'}`)
    setTimeout(() => setDupMsg(null), 5000)
  }

  // Export this whole profile (scenarios + steps + the test-data collections it references) to a
  // shareable .json bundle another QA can import from their Dashboard.
  async function shareProfile() {
    const res = await window.api.exportProfile(profileId)
    setShareMsg(res?.ok ? '✓ Saved' : `✗ ${res?.error || 'Export failed'}`)
    setTimeout(() => setShareMsg(null), 2500)
  }

  async function createScenario() {
    if (!newName.trim()) return
    const result = await window.api.saveScenario({
      profile_id: profileId, name: newName.trim(), sort_order: scenarios.length
    })
    setNewName('')
    const data = await window.api.getScenarios(profileId)
    setScenarios(data)
    const created = data.find(s => s.id === result.id)
    if (created) selectScenario(created)
  }

  async function deleteScenario(id) {
    if (!(await confirmDialog('Delete this scenario and all its steps?', { confirmText: 'Delete' }))) return
    await window.api.deleteScenario(id)
    if (active?.id === id) { setActive(null); setSteps([]) }
    const data = await window.api.getScenarios(profileId)
    setScenarios(data)
    if (data.length) selectScenario(data[0])
  }

  // Reorder scenarios — Run All executes them top→bottom (e.g. Login → Logout → Login).
  // Drag a scenario's grip onto another row to drop it just before that row.
  async function reorderScenarioByDrag(dragId, beforeId) {
    if (!dragId || dragId === beforeId) return
    const ids = scenarios.map(s => s.id)
    const from = ids.indexOf(dragId)
    if (from < 0) return
    ids.splice(from, 1)
    const to = beforeId == null ? ids.length : ids.indexOf(beforeId)
    ids.splice(to < 0 ? ids.length : to, 0, dragId)
    const next = ids.map(id => scenarios.find(s => s.id === id))
    setScenarios(next)
    await window.api.reorderScenarios(profileId, ids)
  }

  // Inline rename: open the editor, then commit (keeps the same id / steps / order).
  function startRename(s) { setEditingId(s.id); setEditName(s.name) }
  function cancelRename() { setEditingId(null); setEditName('') }
  async function commitRename(s) {
    const name = editName.trim()
    if (!name || name === s.name) { cancelRename(); return }
    const updated = { ...s, name }
    await window.api.saveScenario(updated)
    setScenarios(prev => prev.map(x => x.id === s.id ? updated : x))
    if (active?.id === s.id) setActive(updated)
    cancelRename()
  }

  // Skip / unskip a scenario — skipped scenarios are excluded from Run All (an explicit
  // single-scenario ▶ run still runs them).
  async function toggleSkipScenario(id) {
    const s = scenarios.find(x => x.id === id)
    if (!s) return
    const updated = { ...s, skipped: s.skipped ? 0 : 1 }
    await window.api.saveScenario(updated)
    setScenarios(prev => prev.map(x => x.id === id ? updated : x))
    if (active?.id === id) setActive(updated)
  }

  // Lock / unlock a scenario — a locked scenario's steps are read-only (no add, edit, reorder,
  // delete or record), so a finished/approved scenario can't be changed by accident. It still runs.
  async function toggleLockScenario(id) {
    const s = scenarios.find(x => x.id === id)
    if (!s) return
    const updated = { ...s, locked: s.locked ? 0 : 1 }
    await window.api.saveScenario(updated)
    setScenarios(prev => prev.map(x => x.id === id ? updated : x))
    if (active?.id === id) setActive(updated)
  }

  // Duplicate a scenario (+ its steps) within this profile, then select the copy.
  async function duplicateScenario(id) {
    const res = await window.api.duplicateScenario(id)
    const data = await window.api.getScenarios(profileId)
    setScenarios(data)
    if (res?.id) { const c = data.find(s => s.id === res.id); if (c) selectScenario(c) }
  }

  async function addStep(actionKey) {
    if (!active || active.locked) return
    const def = ACTION_DEFS[actionKey]
    const keyword = CATEGORY_KEYWORD[def?.category] || 'When'
    const res = await window.api.saveStep({
      scenario_id: active.id,
      action: actionKey,
      params: { _keyword: keyword },
      label: '',
      sort_order: steps.length
    })
    // A group is always a balanced pair: adding a Group start drops in its matching End
    // right after it, so an orphan end can never be created from the palette.
    if (isGroupStart(actionKey)) {
      await window.api.saveStep({
        scenario_id: active.id, action: 'groupEnd', params: {}, label: '', sort_order: steps.length + 1
      })
    }
    const updated = await window.api.getSteps(active.id)
    setSteps(updated)
    if (res?.id) setExpandedIds(prev => new Set(prev).add(res.id))   // open the new step for editing
  }

  // Drop a whole mapped form in as one fill card per field — selector + {{token}} pre-wired
  // from the collection. Fields without a selector still get a card to complete with 🎯 Pick.
  async function insertFormFill(collection) {
    setFillMenu(false)
    if (!active || active.locked || !collection?.fields?.length) return
    let order = steps.length
    for (const f of collection.fields) {
      await window.api.saveStep({
        scenario_id: active.id,
        action: 'fill',
        params: { _keyword: 'When', selector: f.selector || '', value: `{{${collection.name}.${f.name}}}` },
        label: '',
        sort_order: order++
      })
    }
    setSteps(await window.api.getSteps(active.id))
  }

  const refreshCollections = () => window.api.getCollections().then(setCollections).catch(() => {})

  // Called by the inline data modal after it saves a collection. `tokenizations` is a list
  // of { stepId, token } so we rewrite the source steps' value → {{Collection.field}}.
  async function onDataSaved(tokenizations = []) {
    for (const { stepId, token } of tokenizations) {
      const s = steps.find(x => x.id === stepId)
      if (!s) continue
      await window.api.saveStep({ ...s, params: { ...stepParams(s), value: token } })
    }
    if (tokenizations.length && active) setSteps(await window.api.getSteps(active.id))
    await refreshCollections()
    setDataModal(false)
  }

  function updateStep(step) {
    if (active?.locked) return
    // Update the in-memory state synchronously so a controlled input reflects the new
    // value on the same render as the keystroke. Awaiting the DB save before setState
    // makes the value lag the keystroke, which forces React to reset the caret to the end
    // of the field on every character. Persist in the background instead, serialized
    // through a chain so rapid edits still land in order.
    setSteps(prev => prev.map(s => s.id === step.id ? step : s))
    saveChain.current = saveChain.current
      .then(() => window.api.saveStep(step))
      .catch(() => {})
  }

  async function deleteStep(id) {
    if (active?.locked) return
    await window.api.deleteStep(id)
    setSteps(prev => prev.filter(s => s.id !== id))
    setSelectedIds(prev => { if (!prev.has(id)) return prev; const n = new Set(prev); n.delete(id); return n })
  }

  // The contiguous span [start,end] of the "unit" at idx: a whole group (start→matched end)
  // if idx is a group marker, otherwise just the single step. Used for block-aware moves.
  function unitRange(arr, idx) {
    const s = arr[idx]
    if (isGroupStart(s.action)) {
      let depth = 1, j = idx + 1
      while (j < arr.length && depth > 0) {
        if (isGroupStart(arr[j].action)) depth++
        else if (isGroupEnd(arr[j].action)) { depth--; if (depth === 0) break }
        j++
      }
      return [idx, Math.min(j, arr.length - 1)]
    }
    if (isGroupEnd(s.action)) {
      let depth = 1, j = idx - 1
      while (j >= 0 && depth > 0) {
        if (isGroupEnd(arr[j].action)) depth++
        else if (isGroupStart(arr[j].action)) { depth--; if (depth === 0) break }
        j--
      }
      return [Math.max(j, 0), idx]
    }
    return [idx, idx]
  }

  // Move a step OR a whole group, swapping with the adjacent sibling at the same nesting
  // level. Won't move a unit out of (or into) its parent group — that keeps pairing intact.
  async function moveStep(id, direction) {
    if (active?.locked) return
    const arr = steps
    const idx = arr.findIndex(s => s.id === id)
    if (idx < 0) return
    const [us, ue] = unitRange(arr, idx)
    const ids = arr.map(s => s.id)
    let newIds
    if (direction === 'up') {
      if (us === 0) return
      const [ps, pe] = unitRange(arr, us - 1)
      if (pe !== us - 1) return   // previous element is our parent's open marker → at boundary
      newIds = [...ids.slice(0, ps), ...ids.slice(us, ue + 1), ...ids.slice(ps, us), ...ids.slice(ue + 1)]
    } else {
      if (ue >= arr.length - 1) return
      if (isGroupEnd(arr[ue + 1].action)) return   // next is our parent's close marker → boundary
      const [ns, ne] = unitRange(arr, ue + 1)
      newIds = [...ids.slice(0, us), ...ids.slice(ns, ne + 1), ...ids.slice(us, ue + 1), ...ids.slice(ne + 1)]
    }
    await window.api.reorderSteps(active.id, newIds)
    setSteps(await window.api.getSteps(active.id))
  }

  // Drag-and-drop: move the dragged unit (a step, or a whole group if its start is dragged)
  // to just BEFORE `beforeId` (or to the end when null). Dropping between a group's markers
  // makes the step a member of that group — membership is purely positional.
  async function reorderByDrag(dragStepId, beforeId) {
    if (!dragStepId || active?.locked) return
    const arr = steps
    const di = arr.findIndex(s => s.id === dragStepId)
    if (di < 0) return

    // Multi-move: dragging a step that's part of a (multi) checkbox selection moves the WHOLE
    // selection together, dropped as a contiguous block before `beforeId` (or to the end).
    // Each selected item is expanded to its whole unit (a selected group carries its body), so
    // the moved block is always balanced; relative order is preserved.
    if (selectedIds.has(dragStepId) && selectedIds.size > 1) {
      const moveIdx = new Set()
      arr.forEach((s, i) => { if (selectedIds.has(s.id)) { const [u, e] = unitRange(arr, i); for (let k = u; k <= e; k++) moveIdx.add(k) } })
      const bi = beforeId == null ? -1 : arr.findIndex(s => s.id === beforeId)
      if (bi >= 0 && moveIdx.has(bi)) return   // dropping inside the moving block — no-op
      const ids = arr.map(s => s.id)
      const moving = [...moveIdx].sort((a, b) => a - b).map(i => ids[i])
      const movingSet = new Set(moving)
      const remaining = ids.filter(id => !movingSet.has(id))
      let at = beforeId == null ? remaining.length : remaining.indexOf(beforeId)
      if (at < 0) at = remaining.length
      const newIds = [...remaining.slice(0, at), ...moving, ...remaining.slice(at)]
      if (newIds.join() === ids.join()) return
      await window.api.reorderSteps(active.id, newIds)
      setSteps(await window.api.getSteps(active.id))
      return
    }

    if (dragStepId === beforeId) return
    const [us, ue] = unitRange(arr, di)
    if (beforeId != null) {
      const bi = arr.findIndex(s => s.id === beforeId)
      if (bi >= us && bi <= ue) return   // can't drop a unit inside itself
    }
    const ids = arr.map(s => s.id)
    const unit = ids.slice(us, ue + 1)
    const remaining = [...ids.slice(0, us), ...ids.slice(ue + 1)]
    let at = beforeId == null ? remaining.length : remaining.indexOf(beforeId)
    if (at < 0) at = remaining.length
    const newIds = [...remaining.slice(0, at), ...unit, ...remaining.slice(at)]
    if (newIds.join() === ids.join()) return   // no-op
    await window.api.reorderSteps(active.id, newIds)
    setSteps(await window.api.getSteps(active.id))
  }

  const onDropBefore = (beforeId) => { const d = dragId; setDragId(null); setOverId(null); if (d) reorderByDrag(d, beforeId) }

  async function record() {
    if (!active || active.locked || !profile) return
    if (!profile.base_url?.trim()) { alert('Set a Base URL in this profile before recording.'); return }
    setRecording(true)

    // Track everything created this session so the tester can discard the whole
    // recording on Stop (e.g. a misclick run, or the flow errored partway).
    let navId = null            // the auto-added "Open the app" step, if we add one
    const recordedIds = []      // steps captured live from the recorder

    // A runnable scenario must start by opening the app. If empty, add that first
    // so the recorded steps below it actually have a page to run against.
    let current = steps
    if (current.length === 0) {
      const navRes = await window.api.saveStep({
        scenario_id: active.id, action: 'navigate',
        params: { _keyword: 'Given', url: '' }, label: 'Open the app', sort_order: 0
      })
      if (navRes?.id) navId = navRes.id
      current = await window.api.getSteps(active.id)
      setSteps(current)
    }

    // Serialize live saves so rapid actions keep their order on the canvas.
    let order = current.length
    let chain = Promise.resolve()
    const onStep = (payload) => {
      chain = chain.then(async () => {
        const res = await window.api.saveStep({
          scenario_id: active.id,
          action: payload.action,
          params: buildRecordedParams(payload),
          label: payload.label || '',
          sort_order: order++
        })
        if (res?.id) recordedIds.push(res.id)
        setSteps(await window.api.getSteps(active.id))
      })
    }
    window.api.onRecorderStep(onStep)
    // Non-fatal heads-up if some prior steps couldn't replay (stale selector etc.) —
    // the browser stays open so the tester can keep going by hand.
    window.api.onRecorderNotice?.(msg => alert('Recorder: ' + msg))

    try {
      const res = await window.api.startRecording({
        url: profile.base_url,
        baseUrl: profile.base_url,
        browser: profile.browser || 'chromium',
        steps: current,
        runSteps: true
      })
      await chain
      if (res && !res.ok && res.error) alert('Recorder: ' + res.error)

      // Keep or discard the captured steps — a safety net for a bad/errored take.
      if (recordedIds.length > 0) {
        const n = recordedIds.length
        const keep = await confirmDialog(
          `Recording captured ${n} step${n !== 1 ? 's' : ''}. Keep them on the canvas?`,
          { title: 'Recording finished', confirmText: 'Keep', cancelText: 'Discard', danger: false }
        )
        if (!keep) {
          for (const id of recordedIds) await window.api.deleteStep(id)
          if (navId) await window.api.deleteStep(navId)   // also undo the auto-added "Open the app"
        }
      }
      setSteps(await window.api.getSteps(active.id))
    } catch (e) {
      alert('Recorder error: ' + (e?.message || 'unknown'))
    } finally {
      window.api.offRecorderStep()
      window.api.offRecorderNotice?.()
      setRecording(false)
    }
  }

  async function exportTestCase() {
    if (!active || !steps.length) return
    setExporting(true)
    try { await window.api.exportSteps(profileId, active.id) }
    finally { setExporting(false) }
  }

  const locked = !!active?.locked

  const filteredCategories = ACTION_CATEGORIES.map(cat => ({
    cat,
    actions: ACTIONS_BY_CATEGORY[cat].filter(a =>
      !search || a.label.toLowerCase().includes(search.toLowerCase())
    )
  })).filter(({ actions }) => actions.length > 0)

  // ── Profile not selected yet ──────────────────────────────────────────────
  if (!profileId) {
    return (
      <ProfilePicker navigate={navigate}
        onPick={p => { setProfileId(p.id); setProfileName(p.name) }} />
    )
  }

  // ── Main builder ──────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)', overflow: 'hidden' }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800 }}>Scenario Builder</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
            Profile: <strong>{profileName}</strong>
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {dupMsg && (
            <span style={{ fontSize: 12, maxWidth: 300, lineHeight: 1.3,
              color: dupMsg.startsWith('✓') ? '#10B981' : '#EF4444' }}>{dupMsg}</span>
          )}
          <button onClick={duplicateProfile} title="Clone this profile and all its scenarios (e.g. staging → prebau)" style={{
            padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
            background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer'
          }}>
            ⧉ Duplicate Profile
          </button>
          <button onClick={shareProfile} title="Export this profile (+ its test data) to a file you can share with other QA" style={{
            padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
            background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer'
          }}>
            {shareMsg || '⬆ Share Profile'}
          </button>
          {active && !locked && (
            <button onClick={record} disabled={recording} title="Open the app and record your actions as steps" style={{
              padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
              background: recording ? 'rgba(239,68,68,0.12)' : 'transparent',
              border: `1px solid ${recording ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
              color: recording ? '#EF4444' : 'var(--text-muted)',
              cursor: recording ? 'default' : 'pointer'
            }}>
              {recording ? '● Recording…' : '● Record'}
            </button>
          )}
          {active && steps.length > 0 && (
            <button onClick={exportTestCase} disabled={exporting} style={{
              padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-muted)', cursor: exporting ? 'not-allowed' : 'pointer'
            }}>
              {exporting ? 'Exporting…' : '↓ Export'}
            </button>
          )}
          <button className="btn-primary" onClick={() => navigate('run', { profileId })}
            title="Run all scenarios in order, in one continuous browser session (state carries over)">
            ▶ Run All
          </button>
        </div>
      </div>

      {/* Two-pane */}
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 12, flex: 1, overflow: 'hidden', minHeight: 0 }}>

        {/* ── LEFT: Scenario list + Step Library ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>

          {/* Scenario list */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, flexShrink: 0 }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)',
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>
              Scenarios
            </div>
            <div style={{ padding: 8 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder="New scenario…" onKeyDown={e => e.key === 'Enter' && createScenario()}
                  style={{ fontSize: 12, flex: 1 }} />
                <button className="btn-primary" style={{ padding: '6px 10px' }} onClick={createScenario}>+</button>
              </div>
              {scenarios.length > 4 && (
                <input value={scenarioSearch} onChange={e => setScenarioSearch(e.target.value)}
                  placeholder="🔍 Filter scenarios…" style={{ fontSize: 12, width: '100%', marginBottom: 6 }} />
              )}
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {scenarios.length === 0 && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>No scenarios yet</p>
                )}
                {(() => {
                  const q = scenarioSearch.trim().toLowerCase()
                  const visible = q ? scenarios.filter(s => s.name.toLowerCase().includes(q)) : scenarios
                  if (scenarios.length > 0 && visible.length === 0) {
                    return <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>No matches</p>
                  }
                  const dragEnabled = !q   // reordering only makes sense against the full, unfiltered order
                  return visible.map(s => (
                    <ScenarioRow key={s.id} s={s}
                      active={active?.id === s.id}
                      editing={editingId} editName={editName} setEditName={setEditName}
                      onSelect={selectScenario}
                      onStartRename={startRename} onCommitRename={commitRename} onCancelRename={cancelRename}
                      onDuplicate={duplicateScenario} onDelete={deleteScenario} onToggleSkip={toggleSkipScenario}
                      onToggleLock={toggleLockScenario}
                      dragEnabled={dragEnabled}
                      isOver={overSid === s.id && dragSid !== s.id}
                      isDragging={dragSid === s.id}
                      onDragStart={() => setDragSid(s.id)}
                      onDragEnd={() => { setDragSid(null); setOverSid(null) }}
                      onDragOver={e => { if (dragSid) { e.preventDefault(); setOverSid(s.id) } }}
                      onDrop={e => { e.preventDefault(); reorderScenarioByDrag(dragSid, s.id); setDragSid(null); setOverSid(null) }}
                    />
                  ))
                })()}
              </div>
            </div>
          </div>

          {/* Step Library */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
            flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em',
                color: 'var(--text-muted)', marginBottom: 6 }}>Step Library</div>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search actions…" style={{ fontSize: 12, width: '100%' }} />
              {/* Create/capture test data without leaving the builder. */}
              {active && !locked && (
                <button onClick={() => setDataModal(true)} title="Turn this scenario's values into reusable test data, or add fields by hand"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                    marginTop: 6, padding: '6px 10px', borderRadius: 6, background: 'var(--surface2)',
                    border: '1px dashed var(--border)', color: 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  <span>💾 Capture / create test data</span>
                  <span style={{ color: 'var(--accent)', fontSize: 14 }}>+</span>
                </button>
              )}
              {/* One-click: drop a mapped Test Data collection in as pre-wired fill steps. */}
              {active && !locked && collections.length > 0 && (
                <div style={{ position: 'relative', marginTop: 6 }}>
                  <button onClick={() => setFillMenu(o => !o)} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                    padding: '6px 10px', borderRadius: 6, background: 'var(--accent-soft, var(--surface2))',
                    border: '1px solid var(--accent)', color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    <span>▦ Fill form from data…</span>
                    <span style={{ fontSize: 10 }}>▾</span>
                  </button>
                  {fillMenu && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4,
                      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
                      boxShadow: '0 6px 20px rgba(0,0,0,.18)', overflow: 'hidden' }}>
                      {collections.map(c => {
                        const mapped = c.fields.filter(f => f.selector).length
                        return (
                          <button key={c.id} onClick={() => insertFormFill(c)} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                            textAlign: 'left', padding: '7px 10px', background: 'none', border: 'none',
                            borderBottom: '1px solid var(--border)', color: 'var(--text)', fontSize: 12, cursor: 'pointer' }}>
                            <span>{c.name}</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                              {c.fields.length} field{c.fields.length !== 1 ? 's' : ''}{mapped < c.fields.length ? ` · ${mapped} mapped` : ''}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
              {!active ? (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 8px' }}>
                  Select a scenario first
                </p>
              ) : locked ? (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 8px', lineHeight: 1.5 }}>
                  🔒 This scenario is locked.<br />Unlock it to add or edit steps.
                </p>
              ) : (
                filteredCategories.map(({ cat, actions }) => (
                  <div key={cat} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em',
                      color: 'var(--text-muted)', padding: '2px 4px', marginBottom: 3 }}>{cat}</div>
                    {actions.map(action => (
                      <button key={action.key} onClick={() => addStep(action.key)} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        width: '100%', textAlign: 'left', padding: '6px 10px', borderRadius: 6, marginBottom: 2,
                        background: 'var(--surface2)', border: '1px solid var(--border)',
                        color: 'var(--text)', fontSize: 12, cursor: 'pointer'
                      }}>
                        <span style={{ fontWeight: 500 }}>{action.label}</span>
                        <span style={{ color: 'var(--accent)', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>+</span>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT: Canvas ── */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
          display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!active ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 36 }}>◈</div>
              <p>Select or create a scenario to get started.</p>
            </div>
          ) : (
            <>
              <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{active.name}</span>
                  {locked && (
                    <span title="This scenario is locked — its steps are read-only"
                      style={{ fontSize: 10, fontWeight: 700, color: '#F59E0B', background: 'rgba(245,158,11,0.12)',
                        border: '1px solid rgba(245,158,11,0.4)', borderRadius: 999, padding: '2px 9px' }}>
                      🔒 LOCKED
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {steps.length} step{steps.length !== 1 ? 's' : ''}
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button className="btn-primary" onClick={() => navigate('run', { profileId, scenarioId: active.id, scenarioName: active.name })}
                      title="Run just this scenario (with its 'Run needs' prerequisite) in a fresh browser"
                      style={{ padding: '5px 12px', fontSize: 12 }}>
                      ▶ Run scenario
                    </button>
                    <button onClick={() => toggleLockScenario(active.id)}
                      title={locked ? 'Unlock — allow editing the steps again' : 'Lock — make these steps read-only so they can’t be changed by accident'}
                      style={{ padding: '5px 10px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                        background: locked ? 'rgba(245,158,11,0.12)' : 'transparent',
                        border: `1px solid ${locked ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`,
                        color: locked ? '#F59E0B' : 'var(--text-muted)' }}>
                      {locked ? '🔓 Unlock' : '🔒 Lock'}
                    </button>
                    {selectedIds.size > 0 && !locked && (
                      <>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedIds.size} selected · drag any one to move them together</span>
                        <button onClick={groupSelected} title="Wrap these steps in a group (then name it / make it repeat)"
                          style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent)', borderRadius: 6,
                          padding: '5px 8px', fontSize: 11, fontWeight: 600, color: 'var(--accent)', cursor: 'pointer' }}>
                          ⊞ Group
                        </button>
                        <CopyStepsToScenarioButton scenarios={scenarios} currentScenarioId={active.id}
                          stepIds={[...selectedIds]} onCopied={clearSelection} />
                        <button onClick={deleteSelected} style={{ background: 'rgba(239,68,68,0.1)',
                          border: '1px solid rgba(239,68,68,0.35)', borderRadius: 6, padding: '5px 8px',
                          fontSize: 11, fontWeight: 600, color: '#EF4444', cursor: 'pointer' }}>
                          🗑 Delete {selectedIds.size}
                        </button>
                        <button onClick={clearSelection} style={{ background: 'none', border: '1px solid var(--border)',
                          borderRadius: 6, padding: '5px 8px', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>Clear</button>
                      </>
                    )}
                    <CopyToProfileButton currentProfileId={profileId} scenarioId={active.id} />
                    {steps.length > 1 && (
                      <>
                        {!locked && (
                          <button onClick={selectedIds.size === steps.length ? clearSelection : selectAll}
                            style={{ background: 'none', border: '1px solid var(--border)',
                            borderRadius: 6, padding: '5px 8px', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>
                            {selectedIds.size === steps.length ? 'Deselect all' : 'Select all'}
                          </button>
                        )}
                        <button onClick={expandAll} style={{ background: 'none', border: '1px solid var(--border)',
                          borderRadius: 6, padding: '5px 8px', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>Expand all</button>
                        <button onClick={collapseAll} style={{ background: 'none', border: '1px solid var(--border)',
                          borderRadius: 6, padding: '5px 8px', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>Collapse all</button>
                      </>
                    )}
                  </div>
                </div>

                {/* Prerequisite: run another scenario (e.g. Login) first */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                    ▶ Run needs
                  </span>
                  <select value={active.prerequisite_id || ''} onChange={e => setPrerequisite(e.target.value)}
                    disabled={locked}
                    style={{ fontSize: 12, padding: '4px 8px', maxWidth: 240, opacity: locked ? 0.6 : 1 }}>
                    <option value="">— Nothing —</option>
                    {scenarios.filter(s => s.id !== active.id).map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {active.prerequisite_id
                      ? '↳ runs first when you ▶ Run this scenario alone (Run All ignores it — order handles setup)'
                      : 'setup to run before this scenario when run on its own'}
                  </span>
                </div>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                {/* When locked, the cards become non-interactive (read-only) while the
                    scroll container above stays scrollable. */}
                <div style={{ pointerEvents: locked ? 'none' : 'auto', opacity: locked ? 0.9 : 1 }}>
                {steps.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: 36, marginBottom: 10 }}>←</div>
                    <p>{locked ? 'This scenario is locked and has no steps.' : 'Click any action from the Step Library to add it here.'}</p>
                  </div>
                ) : (
                  (() => {
                    let depth = 0
                    let hideDepth = null      // depth to return to before un-hiding (nest-aware)
                    const out = []
                    steps.forEach((step, i) => {
                      const start = isGroupStart(step.action), end = isGroupEnd(step.action)
                      let indent = depth
                      if (start) depth++
                      else if (end) { depth = Math.max(0, depth - 1); indent = depth }

                      // Inside a collapsed group: hide everything (incl. nested) until its end
                      // marker brings depth back to where the collapse began.
                      if (hideDepth !== null) {
                        if (end && depth === hideDepth) hideDepth = null
                        return
                      }
                      if (start && collapsedGroups.has(step.id)) hideDepth = depth - 1   // render the start card, hide its body

                      out.push(
                        <CanvasStep key={step.id} step={step} index={i} total={steps.length} indent={indent}
                          onChange={updateStep} onDelete={deleteStep} onMove={moveStep} onRemoveGroupEnd={removeGroupEnd}
                          profile={profile} priorSteps={steps.slice(0, i)} collections={collections}
                          groupCollapsed={collapsedGroups.has(step.id)} onToggleGroup={() => toggleGroupCollapse(step.id)}
                          onUngroup={() => ungroupGroup(step.id)}
                          expanded={expandedIds.has(step.id)} onToggleExpand={() => toggleExpand(step.id)}
                          selected={selectedIds.has(step.id)} onToggleSelect={() => toggleSelect(step.id)}
                          dragId={dragId} overId={overId} active={activeId === step.id}
                          dragGroupActive={!!dragId && selectedIds.has(dragId) && selectedIds.size > 1}
                          onDragStartStep={(id) => { setDragId(id); setActiveId(id) }}
                          onDragOverStep={(id) => setOverId(id)}
                          onDropStep={(id) => onDropBefore(id)}
                          onDragEndStep={() => { setDragId(null); setOverId(null) }}
                          onActivate={(id) => setActiveId(id)} />
                      )
                    })
                    // Trailing drop zone — drop here to move a step/group to the very end.
                    out.push(
                      <div key="__dropEnd__"
                        onDragOver={dragId ? (e => { e.preventDefault(); setOverId('__end__') }) : undefined}
                        onDrop={dragId ? (() => onDropBefore(null)) : undefined}
                        style={{ height: 24, borderRadius: 6, margin: '2px 0 8px',
                          border: overId === '__end__' ? '2px dashed var(--accent)' : '2px dashed transparent',
                          background: overId === '__end__' ? 'var(--accent-dim)' : 'transparent' }} />
                    )
                    return out
                  })()
                )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {dataModal && active && (
        <CaptureDataModal
          steps={steps}
          collections={collections}
          defaultName={active.name}
          onClose={() => setDataModal(false)}
          onSaved={onDataSaved}
        />
      )}
    </div>
  )
}
