import { useEffect, useState, useRef } from 'react'
import { ACTION_DEFS, ACTION_CATEGORIES, ACTIONS_BY_CATEGORY } from '../components/actionDefs'

// Default keyword per action category
const CATEGORY_KEYWORD = {
  Navigation: 'Given',
  Interaction: 'When',
  Mouse: 'When',
  Assertions: 'Then',
  Waits: 'When',
  Util: 'When'
}

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

function CanvasStep({ step, index, total, onChange, onDelete, onMove, profile, priorSteps = [], expanded = true, onToggleExpand }) {
  const params = typeof step.params === 'string' ? JSON.parse(step.params) : (step.params || {})
  const def = ACTION_DEFS[step.action] || { label: step.action, params: [], category: 'Interaction' }

  const keyword = params._keyword || CATEGORY_KEYWORD[def.category] || 'When'
  const screenshot = !!params._screenshot

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

  const borderColor = KEYWORD_COLOR[keyword] || KEYWORD_COLOR.When

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${borderColor}`,
      borderRadius: 8,
      marginBottom: 8,
      background: 'var(--bg)'
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
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
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', flexShrink: 0 }}>{def.label}</span>
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
                <textarea rows={2} value={params[p.key] || ''} placeholder={p.placeholder || ''}
                  onChange={e => updateParam(p.key, e.target.value)} style={{ fontSize: 12 }} />
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
                <input type={p.type || 'text'} value={params[p.key] || ''} placeholder={p.placeholder || ''}
                  onChange={e => updateParam(p.key, e.target.value)} style={{ fontSize: 12 }} />
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

// ─── Main ScenarioBuilder ─────────────────────────────────────────────────────

export default function ScenarioBuilder({ navigate, ctx }) {
  const [profileId, setProfileId]     = useState(ctx?.profileId || null)
  const [profileName, setProfileName] = useState(ctx?.profileName || '')
  const [profile, setProfile]         = useState(null)
  const [scenarios, setScenarios]     = useState([])
  const [active, setActive]           = useState(null)   // active scenario
  const [steps, setSteps]             = useState([])
  const [newName, setNewName]         = useState('')
  const [search, setSearch]           = useState('')
  const [exporting, setExporting]     = useState(false)
  const [recording, setRecording]     = useState(false)
  const [expandedIds, setExpandedIds] = useState(() => new Set())

  function toggleExpand(id) {
    setExpandedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const expandAll   = () => setExpandedIds(new Set(steps.map(s => s.id)))
  const collapseAll = () => setExpandedIds(new Set())

  useEffect(() => {
    if (profileId) {
      loadScenarios()
      window.api.getProfiles().then(list => {
        const p = list.find(x => x.id === profileId)
        if (p) setProfile(p)
      })
    }
  }, [profileId])

  async function loadScenarios() {
    const data = await window.api.getScenarios(profileId)
    setScenarios(data)
    if (data.length && !active) selectScenario(data[0])
  }

  async function selectScenario(scenario) {
    setActive(scenario)
    setExpandedIds(new Set())   // collapse for a clean overview on switch
    const s = await window.api.getSteps(scenario.id)
    setSteps(s)
  }

  async function setPrerequisite(preId) {
    if (!active) return
    const updated = { ...active, prerequisite_id: preId || null }
    await window.api.saveScenario(updated)
    setActive(updated)
    setScenarios(await window.api.getScenarios(profileId))
  }

  async function duplicateProfile() {
    const res = await window.api.duplicateProfile(profileId)
    if (res?.id) alert(`Profile duplicated as "${profileName} (copy)".\nOpen it from the Dashboard or the profile picker, then change its Base URL.`)
    else alert(res?.error || 'Could not duplicate profile')
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
    if (!confirm('Delete this scenario and all its steps?')) return
    await window.api.deleteScenario(id)
    if (active?.id === id) { setActive(null); setSteps([]) }
    const data = await window.api.getScenarios(profileId)
    setScenarios(data)
    if (data.length) selectScenario(data[0])
  }

  async function addStep(actionKey) {
    if (!active) return
    const def = ACTION_DEFS[actionKey]
    const keyword = CATEGORY_KEYWORD[def?.category] || 'When'
    const res = await window.api.saveStep({
      scenario_id: active.id,
      action: actionKey,
      params: { _keyword: keyword },
      label: '',
      sort_order: steps.length
    })
    const updated = await window.api.getSteps(active.id)
    setSteps(updated)
    if (res?.id) setExpandedIds(prev => new Set(prev).add(res.id))   // open the new step for editing
  }

  async function updateStep(step) {
    await window.api.saveStep(step)
    setSteps(prev => prev.map(s => s.id === step.id ? step : s))
  }

  async function deleteStep(id) {
    await window.api.deleteStep(id)
    setSteps(prev => prev.filter(s => s.id !== id))
  }

  async function moveStep(id, direction) {
    const idx = steps.findIndex(s => s.id === id)
    const next = [...steps]
    const swap = direction === 'up' ? idx - 1 : idx + 1
    if (swap < 0 || swap >= next.length) return
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    setSteps(next)
    await window.api.reorderSteps(active.id, next.map(s => s.id))
  }

  async function record() {
    if (!active || !profile) return
    if (!profile.base_url?.trim()) { alert('Set a Base URL in this profile before recording.'); return }
    setRecording(true)

    // A runnable scenario must start by opening the app. If empty, add that first
    // so the recorded steps below it actually have a page to run against.
    let current = steps
    if (current.length === 0) {
      await window.api.saveStep({
        scenario_id: active.id, action: 'navigate',
        params: { _keyword: 'Given', url: '' }, label: 'Open the app', sort_order: 0
      })
      current = await window.api.getSteps(active.id)
      setSteps(current)
    }

    // Serialize live saves so rapid actions keep their order on the canvas.
    let order = current.length
    let chain = Promise.resolve()
    const onStep = (payload) => {
      chain = chain.then(async () => {
        await window.api.saveStep({
          scenario_id: active.id,
          action: payload.action,
          params: buildRecordedParams(payload),
          label: payload.label || '',
          sort_order: order++
        })
        setSteps(await window.api.getSteps(active.id))
      })
    }
    window.api.onRecorderStep(onStep)

    try {
      const res = await window.api.startRecording({
        url: profile.base_url,
        baseUrl: profile.base_url,
        browser: profile.browser || 'chromium',
        steps: current,
        runSteps: true
      })
      await chain
      setSteps(await window.api.getSteps(active.id))
      if (res && !res.ok && res.error) alert('Recorder: ' + res.error)
    } catch (e) {
      alert('Recorder error: ' + (e?.message || 'unknown'))
    } finally {
      window.api.offRecorderStep()
      setRecording(false)
    }
  }

  async function exportTestCase() {
    if (!active || !steps.length) return
    setExporting(true)
    try { await window.api.exportSteps(profileId, active.id) }
    finally { setExporting(false) }
  }

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
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={duplicateProfile} title="Clone this profile and all its scenarios (e.g. staging → prebau)" style={{
            padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
            background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer'
          }}>
            ⧉ Duplicate Profile
          </button>
          {active && (
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
              <div style={{ maxHeight: 130, overflowY: 'auto' }}>
                {scenarios.length === 0 && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>No scenarios yet</p>
                )}
                {scenarios.map(s => (
                  <div key={s.id} onClick={() => selectScenario(s)} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 8px', borderRadius: 6, cursor: 'pointer', marginBottom: 2,
                    background: active?.id === s.id ? 'var(--accent-dim)' : 'transparent',
                    border: active?.id === s.id ? '1px solid rgba(108,99,255,0.2)' : '1px solid transparent',
                    color: active?.id === s.id ? 'var(--accent)' : 'var(--text)',
                    fontWeight: active?.id === s.id ? 700 : 400, fontSize: 13
                  }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {s.name}
                    </span>
                    <button onClick={e => { e.stopPropagation(); navigate('run', { profileId, scenarioId: s.id, scenarioName: s.name }) }}
                      title="Run just this scenario (with its prerequisite) in a fresh browser"
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '0 3px', fontSize: 11, flexShrink: 0, cursor: 'pointer' }}>▶</button>
                    <button onClick={e => { e.stopPropagation(); deleteScenario(s.id) }}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: '0 2px', fontSize: 14, flexShrink: 0 }}>×</button>
                  </div>
                ))}
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
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
              {!active ? (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 8px' }}>
                  Select a scenario first
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
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {steps.length} step{steps.length !== 1 ? 's' : ''}
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CopyToProfileButton currentProfileId={profileId} scenarioId={active.id} />
                    {steps.length > 1 && (
                      <>
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
                    style={{ fontSize: 12, padding: '4px 8px', maxWidth: 240 }}>
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
                {steps.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: 36, marginBottom: 10 }}>←</div>
                    <p>Click any action from the Step Library to add it here.</p>
                  </div>
                ) : (
                  steps.map((step, i) => (
                    <CanvasStep key={step.id} step={step} index={i} total={steps.length}
                      onChange={updateStep} onDelete={deleteStep} onMove={moveStep}
                      profile={profile} priorSteps={steps.slice(0, i)}
                      expanded={expandedIds.has(step.id)} onToggleExpand={() => toggleExpand(step.id)} />
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
