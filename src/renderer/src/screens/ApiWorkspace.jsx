import { useEffect, useMemo, useRef, useState } from 'react'
import { confirmDialog } from '../lib/confirm'
import { TOKEN_GROUPS } from '../lib/tokens'

const ITERATE_GROUPS = [['all', 'All sets'], ['positive', '📗 Positive'], ['negative', '📕 Negative'], ['edge', '📒 Edge']]

// Detect a request's INPUT fields from its body so a Test Data collection can be auto-built.
// SOAP: the leaf elements under the Body's request wrapper (e.g. getUserRequest → userName,
// userRole, …). JSON: the top-level keys. Returns { fields, wrapper, kind }.
function detectRequestFields(body, bodyType) {
  const t = (body || '').trim()
  if (bodyType === 'soap' || bodyType === 'xml' || t.startsWith('<')) {
    try {
      const doc = new DOMParser().parseFromString(t, 'application/xml')
      if (doc.getElementsByTagName('parsererror').length || !doc.documentElement) return { fields: [], wrapper: null, kind: 'soap' }
      const bodyEl = Array.from(doc.getElementsByTagName('*')).find(e => e.localName === 'Body')
      const wrapper = bodyEl && Array.from(bodyEl.children)[0]
      if (!wrapper) return { fields: [], wrapper: null, kind: 'soap' }
      const fields = []
      const walk = (el) => {
        const kids = Array.from(el.children)
        if (!kids.length) { if (el !== wrapper) fields.push(el.localName) }
        else kids.forEach(walk)
      }
      walk(wrapper)
      return { fields: [...new Set(fields)], wrapper: wrapper.localName, kind: 'soap' }
    } catch { return { fields: [], wrapper: null, kind: 'soap' } }
  }
  try {
    const o = JSON.parse(t)
    if (o && typeof o === 'object' && !Array.isArray(o)) return { fields: Object.keys(o), wrapper: null, kind: 'json' }
  } catch { /* not JSON */ }
  return { fields: [], wrapper: null, kind: 'json' }
}

// Replace each detected field's placeholder value with a {{Collection.field}} token.
function rewireBody(body, bodyType, fields, collName, kind) {
  if (kind === 'json') {
    try { const o = JSON.parse(body); for (const f of fields) if (f in o) o[f] = `{{${collName}.${f}}}`; return JSON.stringify(o, null, 2) } catch { return body }
  }
  let out = body
  for (const f of fields) {
    const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(<([\\w.-]+:)?${esc}>)[^<]*(</([\\w.-]+:)?${esc}>)`, 'g')
    out = out.replace(re, `$1{{${collName}.${f}}}$3`)
  }
  return out
}

function uniqueCollName(base, collections) {
  const taken = new Set((collections || []).map(c => c.name.toLowerCase()))
  let name = base || 'Request', i = 2
  while (taken.has(name.toLowerCase())) name = `${base} ${i++}`
  return name
}

// Detect the SOAP <Header> leaf fields (e.g. ServiceHeader → timeStamp/correlationId/token).
function detectHeaderFields(body) {
  const t = (body || '').trim()
  if (!t.startsWith('<')) return []
  try {
    const doc = new DOMParser().parseFromString(t, 'application/xml')
    if (doc.getElementsByTagName('parsererror').length) return []
    const headerEl = Array.from(doc.getElementsByTagName('*')).find(e => e.localName === 'Header')
    if (!headerEl) return []
    const fields = []
    const walk = (el) => { const k = Array.from(el.children); if (!k.length) fields.push(el.localName); else k.forEach(walk) }
    Array.from(headerEl.children).forEach(walk)
    return [...new Set(fields)]
  } catch { return [] }
}

// Map a header field to a sensible token. Timestamps/IDs auto-generate; the auth token uses the
// {{Token}} variable; everything else becomes a one-time profile variable (boilerplate constant).
function headerTokenFor(name) {
  const n = name.toLowerCase()
  if (n === 'token' || n.endsWith('token')) return { token: '{{Token}}', variable: 'Token' }
  if (n.includes('timestamp') || n === 'time') return { token: '{{unique.timestamp}}' }
  if (n.includes('correlation') || n.includes('messageid') || n.includes('requestid') || n.includes('guid') || n.includes('uuid')) return { token: '{{unique.uuid}}' }
  return { token: `{{${name}}}`, variable: name }
}

function parseSets(sets) {
  return (sets || []).map(s => {
    let values = {}
    try { values = typeof s.field_values === 'string' ? JSON.parse(s.field_values || '{}') : (s.field_values || {}) } catch { values = {} }
    return { id: s.id, name: s.name, group_type: s.group_type, values, sort_order: s.sort_order }
  })
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const BODY_TYPES = [['none', 'None'], ['json', 'JSON'], ['xml', 'XML'], ['soap', 'SOAP'], ['form', 'Form'], ['raw', 'Raw']]
const EXTRACT_FROM = [['json', 'JSON body'], ['xml', 'XML body'], ['header', 'Header'], ['status', 'Status code']]

const methodColor = (m) => ({
  GET: 'var(--busy)', POST: 'var(--ok)', PUT: 'var(--warn)', PATCH: 'var(--warn)', DELETE: 'var(--bad)'
}[m] || 'var(--ink-soft)')

// Pretty-print a response body when it's JSON; otherwise return as-is.
function pretty(body) {
  if (!body) return ''
  const t = body.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.stringify(JSON.parse(t), null, 2) } catch { /* fall through */ }
  }
  return body
}

// Lightweight syntax tint for the body editor (no deps): escape, then color tags/strings/
// keywords/comments and {{tokens}}. Inserted spans use real <>, so the regexes (which match
// the escaped &lt;/&quot;) never re-match them.
function highlightCode(code, kind) {
  let h = String(code).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  if (kind === 'json') {
    h = h.replace(/("(?:\\.|[^"\\])*")/g, '<span class="tk-str">$1</span>')
      .replace(/\b(true|false|null)\b/g, '<span class="tk-kw">$1</span>')
  } else {
    h = h.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tk-com">$1</span>')
      .replace(/(&lt;\/?(?!!--)[\s\S]*?&gt;)/g, '<span class="tk-tag">$1</span>')
  }
  return h.replace(/(\{\{[^{}]+?\}\})/g, '<span class="tk-tok">$1</span>')
}

// A transparent <textarea> layered over a highlighted <pre> — both share identical type metrics
// and scroll together, so you type plain text and see it colored.
function CodeArea({ value, onChange, bodyType, placeholder, height = 240 }) {
  const taRef = useRef(null), preRef = useRef(null)
  const kind = bodyType === 'json' ? 'json' : 'xml'
  const html = useMemo(() => highlightCode(value || '', kind) + '\n', [value, kind])
  const shared = { margin: 0, padding: 10, border: 'none', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', boxSizing: 'border-box', position: 'absolute', inset: 0, overflow: 'auto' }
  const sync = () => { if (preRef.current && taRef.current) { preRef.current.scrollTop = taRef.current.scrollTop; preRef.current.scrollLeft = taRef.current.scrollLeft } }
  return (
    <div className="sketch" style={{ position: 'relative', height, background: 'var(--surface)' }}>
      <pre ref={preRef} aria-hidden style={{ ...shared, pointerEvents: 'none', color: 'var(--ink)' }} dangerouslySetInnerHTML={{ __html: html }} />
      <textarea ref={taRef} value={value} placeholder={placeholder} spellCheck={false} onChange={e => onChange(e.target.value)} onScroll={sync}
        style={{ ...shared, color: 'transparent', background: 'transparent', caretColor: 'var(--ink)', resize: 'none' }} />
    </div>
  )
}

// Editable key/value/enabled rows (headers & query params).
function KeyValueEditor({ rows, onChange, placeholder = ['key', 'value'] }) {
  const list = Array.isArray(rows) ? rows : []
  const set = (i, patch) => onChange(list.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  const add = () => onChange([...list, { key: '', value: '', enabled: true }])
  const del = (i) => onChange(list.filter((_, idx) => idx !== i))
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {list.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={r.enabled !== false} style={{ width: 'auto' }}
            onChange={e => set(i, { enabled: e.target.checked })} />
          <input value={r.key} placeholder={placeholder[0]} style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            onChange={e => set(i, { key: e.target.value })} />
          <input value={r.value} placeholder={placeholder[1]} style={{ flex: 2, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            onChange={e => set(i, { value: e.target.value })} />
          <button className="btn-ghost" style={{ padding: '2px 8px' }} onClick={() => del(i)}>✕</button>
        </div>
      ))}
      <button className="btn-ghost" style={{ alignSelf: 'start', padding: '4px 10px', fontSize: 11 }} onClick={add}>+ Add</button>
    </div>
  )
}

export default function ApiWorkspace({ profile, profileName, navigate }) {
  const [requests, setRequests] = useState([])
  const [collections, setCollections] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [draft, setDraft] = useState(null)         // editable copy of the active request
  const [variables, setVariables] = useState([])
  const [auth, setAuth] = useState({ type: 'none', token_request_id: '', token_var: 'token', token_path: '', header_name: 'Authorization', header_prefix: 'Bearer ', refetch_on: '401' })
  const [tab, setTab] = useState('body')           // body | headers | params | extract
  const [response, setResponse] = useState(null)
  const [sending, setSending] = useState(false)
  const [respTab, setRespTab] = useState('body')   // body | headers | assertions
  const [savedFlash, setSavedFlash] = useState(false)
  const [sendRowId, setSendRowId] = useState(null) // which data row ▶ Send resolves against
  const [run, setRun] = useState(null)             // { logs:[], summary }
  const [wsdl, setWsdl] = useState(null)           // { url, busy, msg } when the import modal is open
  const saveTimer = useRef(null)

  useEffect(() => { loadAll() }, [profile.id])

  async function loadAll() {
    const [reqs, vars, a, cols] = await Promise.all([
      window.api.getApiRequests(profile.id),
      window.api.getApiVariables(profile.id),
      window.api.getApiAuth(profile.id),
      window.api.getCollections().catch(() => [])
    ])
    setRequests(reqs)
    setVariables(vars)
    setCollections(cols || [])
    if (a) setAuth({ ...a, token_request_id: a.token_request_id || '' })
    if (reqs.length && !activeId) select(reqs[0])
  }

  // ── Request selection / drafting ──────────────────────────────────────────
  function parseReq(r) {
    const arr = (v, d = []) => { try { return Array.isArray(v) ? v : JSON.parse(v || JSON.stringify(d)) } catch { return d } }
    return { ...r, headers: arr(r.headers), query: arr(r.query), extract: arr(r.extract), assertions: arr(r.assertions) }
  }

  function select(r) {
    flushSave()
    setActiveId(r.id)
    setDraft(parseReq(r))
    setResponse(null)
  }

  function patch(p) {
    setDraft(d => {
      const next = { ...d, ...p }
      scheduleSave(next)
      return next
    })
  }

  function scheduleSave(next) {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveDraft(next), 500)
  }
  function flushSave() {
    clearTimeout(saveTimer.current)
    if (draft) saveDraft(draft)
  }
  async function saveDraft(d) {
    if (!d?.id) return
    await window.api.saveApiRequest(d)
    setRequests(rs => rs.map(r => r.id === d.id ? { ...r, ...d, headers: JSON.stringify(d.headers), query: JSON.stringify(d.query) } : r))
    setSavedFlash(true); setTimeout(() => setSavedFlash(false), 800)
  }

  async function newRequest() {
    const res = await window.api.saveApiRequest({
      profile_id: profile.id, name: 'New request', method: 'GET',
      url: profile.base_url || '', sort_order: requests.length
    })
    const reqs = await window.api.getApiRequests(profile.id)
    setRequests(reqs)
    const created = reqs.find(r => r.id === res.id)
    if (created) select(created)
  }

  async function deleteRequest(id) {
    if (!(await confirmDialog('Delete this request?', { confirmText: 'Delete' }))) return
    await window.api.deleteApiRequest(id)
    const reqs = await window.api.getApiRequests(profile.id)
    setRequests(reqs)
    if (activeId === id) { setActiveId(null); setDraft(null); if (reqs[0]) select(reqs[0]) }
  }

  // Rows of the bound collection that ▶ Send can use (filtered by the request's iterate group).
  const boundCol = collections.find(c => c.id === draft?.iterate_collection_id)
  const sendRows = boundCol
    ? parseSets(boundCol.sets).filter(r => (draft?.iterate_group || 'all') === 'all' || r.group_type === draft.iterate_group)
    : []
  const effectiveRowId = sendRows.find(r => r.id === sendRowId)?.id || sendRows[0]?.id || null

  // ── Send / Run ─────────────────────────────────────────────────────────────
  async function send() {
    if (!draft) return
    flushSave()
    setSending(true); setResponse(null)
    try {
      const res = await window.api.sendApiRequest(draft.id, effectiveRowId)
      setResponse(res)
      setRespTab(res.assertions?.length ? 'assertions' : 'body')
      if (res.variables) await refreshVars()
    } catch (e) {
      setResponse({ response: { error: e?.message || 'Send failed', status: 0, timeMs: 0 } })
    } finally { setSending(false) }
  }

  async function refreshVars() {
    setVariables(await window.api.getApiVariables(profile.id))
  }
  const reloadCollections = async () => setCollections(await window.api.getCollections().catch(() => []))

  // Auto-build a Test Data collection from this request's input fields, wire the body to
  // {{Collection.field}} tokens, and bind the request to iterate over it.
  const [dataMsg, setDataMsg] = useState(null)
  async function createCollectionFromRequest() {
    if (!draft) return
    const { fields, wrapper, kind } = detectRequestFields(draft.body, draft.body_type)
    if (!fields.length) { setDataMsg('✗ No input fields found in the body — add a body first (or import a WSDL).'); return }
    const base = (wrapper ? wrapper.replace(/Request$/i, '') : draft.name) || 'Request'
    const name = uniqueCollName(base, collections)
    const { id } = await window.api.saveCollection({ name })
    for (let i = 0; i < fields.length; i++) await window.api.saveField({ collection_id: id, name: fields[i], type: 'text', sort_order: i })
    await window.api.saveDataSet({ collection_id: id, name: 'Row 1', group_type: 'positive', values: {} })
    const body = rewireBody(draft.body, draft.body_type, fields, name, kind)
    patch({ body, iterate_collection_id: id, iterate_group: 'all' })
    setCollections(await window.api.getCollections())
    setDataMsg(`✓ Created “${name}” with ${fields.length} field${fields.length === 1 ? '' : 's'}; body wired to {{${name}.*}}. Fill rows in Test Data.`)
  }

  // Tokenize the SOAP header boilerplate so it's no longer hand-edited in the raw envelope:
  // timestamps/IDs auto-generate, the token uses {{Token}}, constants become profile variables.
  async function fillHeaderBoilerplate() {
    if (!draft) return
    const headerFields = detectHeaderFields(draft.body)
    if (!headerFields.length) { setDataMsg('✗ No SOAP header fields found in the body.'); return }
    let body = draft.body
    const wanted = []
    for (const f of headerFields) {
      const { token, variable } = headerTokenFor(f)
      const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`(<([\\w.-]+:)?${esc}>)[^<]*(</([\\w.-]+:)?${esc}>)`, 'g')
      body = body.replace(re, `$1${token}$3`)
      if (variable) wanted.push(variable)
    }
    const existing = new Set(variables.map(v => v.name))
    const created = [...new Set(wanted)].filter(n => !existing.has(n))
    for (const name of created) await window.api.saveApiVariable({ profile_id: profile.id, name, value: '' })
    patch({ body })
    await refreshVars()
    setDataMsg(`✓ Header wired to tokens. ${created.length ? `Set ${created.join(', ')} once in the Variables panel.` : 'Timestamps/IDs auto-generate.'}`)
  }

  // Add an extraction rule from a clicked response field, then jump to the Extract tab.
  function addExtraction(rule) {
    if (!draft) return
    const list = draft.extract || []
    const exists = list.some(e => e.var === rule.var && e.path === rule.path && e.from === rule.from)
    if (!exists) patch({ extract: [...list, rule] })
    setTab('extract')
  }

  async function runCollection() {
    flushSave()
    setRun({ logs: [], summary: null })
    window.api.onRunLog(d => {
      if (d.type === 'step' || d.type === 'info' || d.type === 'error')
        setRun(r => r ? { ...r, logs: [...r.logs, d] } : r)
    })
    window.api.onRunComplete(summary => {
      setRun(r => r ? { ...r, summary } : r)
      window.api.offRunLog(); window.api.offRunComplete()
      refreshVars()
    })
    const res = await window.api.runApiCollection(profile.id)
    if (res?.error) {
      setRun(r => ({ ...r, logs: [...(r?.logs || []), { type: 'error', text: res.error }], summary: { status: 'failed' } }))
      window.api.offRunLog(); window.api.offRunComplete()
    }
  }

  // ── Variables ───────────────────────────────────────────────────────────────
  async function saveVar(v) { await window.api.saveApiVariable({ ...v, profile_id: profile.id }); refreshVars() }
  async function addVar() { await window.api.saveApiVariable({ profile_id: profile.id, name: 'newVar', value: '', sort_order: variables.length }); refreshVars() }
  async function delVar(id) { await window.api.deleteApiVariable(id); refreshVars() }

  // ── Auth ─────────────────────────────────────────────────────────────────────
  function patchAuth(p) {
    const next = { ...auth, ...p }
    setAuth(next)
    window.api.saveApiAuth({ ...next, profile_id: profile.id })
  }

  // ── WSDL import ───────────────────────────────────────────────────────────
  async function importWsdl() {
    const url = (wsdl.url || '').trim()
    if (!url) return
    setWsdl(w => ({ ...w, busy: true, msg: null }))
    const res = await window.api.importWsdl(profile.id, url)
    if (res?.error) {
      setWsdl(w => ({ ...w, busy: false, msg: `✗ ${res.error}` }))
      return
    }
    const reqs = await window.api.getApiRequests(profile.id)
    setRequests(reqs)
    setWsdl({ url, busy: false, msg: `✓ Imported ${res.count} operation${res.count === 1 ? '' : 's'} from ${res.endpoint || 'service'}` })
    // Jump to the first newly-imported request.
    const created = reqs.find(r => r.name === res.operations?.[0])
    if (created) select(created)
  }

  useEffect(() => () => { window.api.offRunLog?.(); window.api.offRunComplete?.() }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800 }}>
            API Workspace <span className="badge badge-warn" style={{ fontSize: 10, verticalAlign: 'middle' }}>BETA</span>
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
            Profile: <strong>{profileName || profile.name}</strong> · still in progress — see Help → API Profiles
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn-ghost" title="Generate a collection from a WCF/SOAP service's ?wsdl URL"
            onClick={() => setWsdl({ url: '', busy: false, msg: null })}>⬇ Import WSDL</button>
          <button className="btn-primary" onClick={runCollection} disabled={!requests.length}>▶ Run collection</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, flex: 1, minHeight: 0 }}>
        {/* ── Left: collection + variables + auth ── */}
        <div style={{ width: 270, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <span className="eyebrow">Requests</span>
              <button className="btn-ghost" style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: 11 }} onClick={newRequest}>＋ New</button>
            </div>
            {requests.length === 0
              ? <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: 0 }}>No requests yet.</p>
              : <div style={{ display: 'grid', gap: 4 }}>
                  {requests.map(r => (
                    <div key={r.id} onClick={() => select(r)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
                        background: r.id === activeId ? 'var(--accent-soft)' : 'transparent' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 800, color: methodColor(r.method), width: 38, flexShrink: 0 }}>{r.method}</span>
                      <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                      <button className="btn-ghost" style={{ padding: '0 6px' }} onClick={e => { e.stopPropagation(); deleteRequest(r.id) }}>✕</button>
                    </div>
                  ))}
                </div>}
          </div>

          {/* Variables — the shared store */}
          <div className="card" style={{ padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <span className="eyebrow">Variables</span>
              <button className="btn-ghost" style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: 11 }} onClick={addVar}>＋</button>
            </div>
            {variables.length === 0
              ? <p style={{ color: 'var(--text-muted)', fontSize: 11, margin: 0 }}>Extracted values (e.g. token) land here and feed <code>{'{{name}}'}</code>.</p>
              : <div style={{ display: 'grid', gap: 6 }}>
                  {variables.map(v => (
                    <div key={v.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input value={v.name} style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11 }}
                        onChange={e => setVariables(vs => vs.map(x => x.id === v.id ? { ...x, name: e.target.value } : x))}
                        onBlur={e => saveVar({ ...v, name: e.target.value })} />
                      <input value={v.value} placeholder="—" style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11 }}
                        onChange={e => setVariables(vs => vs.map(x => x.id === v.id ? { ...x, value: e.target.value } : x))}
                        onBlur={e => saveVar({ ...v, value: e.target.value })} />
                      <button className="btn-ghost" style={{ padding: '0 6px' }} onClick={() => delVar(v.id)}>✕</button>
                    </div>
                  ))}
                </div>}
          </div>

          {/* Auth / token policy */}
          <div className="card" style={{ padding: 12 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Auth & token</div>
            <label style={{ fontSize: 11 }}>Type</label>
            <select value={auth.type} onChange={e => patchAuth({ type: e.target.value })} style={{ fontSize: 12, marginBottom: 8 }}>
              <option value="none">None</option>
              <option value="bearer">Bearer / token</option>
            </select>
            {auth.type !== 'none' && (
              <div style={{ display: 'grid', gap: 6 }}>
                <label style={{ fontSize: 11 }}>Token request (mints the token)</label>
                <select value={auth.token_request_id} onChange={e => patchAuth({ token_request_id: e.target.value })} style={{ fontSize: 12 }}>
                  <option value="">— none —</option>
                  {requests.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <label style={{ fontSize: 11 }}>Store token in variable</label>
                <input value={auth.token_var} onChange={e => patchAuth({ token_var: e.target.value })}
                  style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }} placeholder="token" />
                <label style={{ fontSize: 11 }}>Header</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input value={auth.header_name} onChange={e => patchAuth({ header_name: e.target.value })}
                    style={{ flex: 1, fontSize: 11, fontFamily: 'var(--font-mono)' }} />
                  <input value={auth.header_prefix} onChange={e => patchAuth({ header_prefix: e.target.value })}
                    style={{ flex: 1, fontSize: 11, fontFamily: 'var(--font-mono)' }} placeholder="Bearer " />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, textTransform: 'none', letterSpacing: 'normal' }}>
                  <input type="checkbox" checked={auth.refetch_on === '401'} style={{ width: 'auto' }}
                    onChange={e => patchAuth({ refetch_on: e.target.checked ? '401' : 'manual' })} />
                  Auto re-fetch token on 401 & retry
                </label>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>
                  On the token request, add an Extract rule into <code>{auth.token_var}</code>. Other requests inject <code>{auth.header_name}: {auth.header_prefix}{'{{'}{auth.token_var}{'}}'}</code> automatically.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Center: request editor + response ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
          {!draft ? (
            <div className="card empty-state" style={{ padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 28 }}>🔌</div>
              <p style={{ margin: 0, color: 'var(--text-muted)' }}>Pick a request, or create one with ＋ New.</p>
            </div>
          ) : (
            <>
              <div className="card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <input value={draft.name} onChange={e => patch({ name: e.target.value })}
                    style={{ fontWeight: 700, fontSize: 14, flex: 1 }} placeholder="Request name" />
                  <span style={{ fontSize: 11, color: savedFlash ? 'var(--ok)' : 'var(--text-muted)' }}>{savedFlash ? '✓ Saved' : ''}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <select value={draft.method} onChange={e => patch({ method: e.target.value })}
                    style={{ width: 110, fontFamily: 'var(--font-mono)', fontWeight: 700, color: methodColor(draft.method) }}>
                    {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <input value={draft.url} onChange={e => patch({ url: e.target.value })}
                    placeholder="https://api.example.com/path  ·  use {{var}} tokens"
                    style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }} />
                  <button className="btn-primary" onClick={send} disabled={sending} style={{ minWidth: 90 }}>
                    {sending ? '…' : '▶ Send'}
                  </button>
                </div>
                {sendRows.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                    <span>▶ Send uses data row:</span>
                    <select value={effectiveRowId || ''} onChange={e => setSendRowId(e.target.value)} style={{ fontSize: 11, width: 'auto' }}>
                      {sendRows.map(r => <option key={r.id} value={r.id}>{r.name} · {r.group_type}</option>)}
                    </select>
                    <span style={{ color: 'var(--ink-faint)' }}>(Run collection runs every row)</span>
                  </div>
                )}

                {/* tabs */}
                <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid var(--line-soft)', marginBottom: 10 }}>
                  {[['body', 'Body'], ['headers', 'Headers'], ['params', 'Params'], ['extract', `Extract${draft.extract?.length ? ` (${draft.extract.length})` : ''}`], ['data', draft.iterate_collection_id ? 'Data 🔁' : 'Data']].map(([id, lbl]) => (
                    <button key={id} className="btn-ghost" onClick={() => setTab(id)}
                      style={{ padding: '4px 12px', fontSize: 12, borderRadius: '6px 6px 0 0',
                        borderBottom: tab === id ? '2px solid var(--accent)' : '2px solid transparent',
                        color: tab === id ? 'var(--accent)' : 'var(--ink-soft)', fontWeight: tab === id ? 700 : 500 }}>{lbl}</button>
                  ))}
                </div>

                {tab === 'body' && (
                  <div>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                      {BODY_TYPES.map(([v, l]) => (
                        <button key={v} className={draft.body_type === v ? 'btn-primary' : 'btn-ghost'}
                          style={{ padding: '2px 10px', fontSize: 11 }} onClick={() => patch({ body_type: v })}>{l}</button>
                      ))}
                    </div>
                    {draft.body_type === 'soap' && (
                      <input value={draft.soap_action || ''} onChange={e => patch({ soap_action: e.target.value })}
                        placeholder="SOAPAction (e.g. http://tempuri.org/Add)"
                        style={{ fontFamily: 'var(--font-mono)', fontSize: 11, marginBottom: 8 }} />
                    )}
                    {draft.body_type === 'none'
                      ? <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>No request body.</p>
                      : <CodeArea value={draft.body} onChange={v => patch({ body: v })} bodyType={draft.body_type} height={280}
                          placeholder={draft.body_type === 'json' ? '{\n  "key": "value"\n}' : draft.body_type === 'soap' ? '<soap:Envelope>…</soap:Envelope>' : ''} />}
                  </div>
                )}
                {tab === 'headers' && <KeyValueEditor rows={draft.headers} onChange={v => patch({ headers: v })} placeholder={['Header', 'Value']} />}
                {tab === 'params' && <KeyValueEditor rows={draft.query} onChange={v => patch({ query: v })} placeholder={['Param', 'Value']} />}
                {tab === 'extract' && (
                  <ExtractEditor rows={draft.extract} onChange={v => patch({ extract: v })} />
                )}
                {tab === 'data' && (
                  <DataIterateTab draft={draft} collections={collections} patch={patch} navigate={navigate}
                    onAutoCreate={createCollectionFromRequest} autoMsg={dataMsg} onReload={reloadCollections}
                    onFillHeader={fillHeaderBoilerplate} />
                )}
              </div>

              {/* Response panel */}
              {response && (
                <div className="card" style={{ padding: 14 }}>
                  <ResponseView response={response} respTab={respTab} setRespTab={setRespTab} onPick={addExtraction} />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Run drawer */}
      {run && (
        <RunDrawer run={run} onClose={() => setRun(null)} navigate={navigate} />
      )}

      {/* WSDL import modal */}
      {wsdl && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(43,43,43,.35)', zIndex: 60,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => !wsdl.busy && setWsdl(null)}>
          <div className="card" style={{ width: 520, padding: 20 }} onClick={e => e.stopPropagation()}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Import from WSDL</div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>
              Paste a WCF/SOAP service's WSDL URL (usually ends in <code>?wsdl</code>). One request per operation
              is scaffolded with a skeleton SOAP envelope you can fill in.
            </p>
            <input value={wsdl.url} autoFocus disabled={wsdl.busy}
              onChange={e => setWsdl(w => ({ ...w, url: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && importWsdl()}
              placeholder="https://service.example.com/Service.svc?wsdl"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12, marginBottom: 10 }} />
            {wsdl.msg && (
              <p style={{ fontSize: 12, margin: '0 0 10px', color: wsdl.msg.startsWith('✓') ? 'var(--ok)' : 'var(--bad)' }}>{wsdl.msg}</p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={() => setWsdl(null)} disabled={wsdl.busy}>
                {wsdl.msg?.startsWith('✓') ? 'Close' : 'Cancel'}
              </button>
              <button className="btn-primary" onClick={importWsdl} disabled={wsdl.busy || !wsdl.url.trim()}>
                {wsdl.busy ? 'Importing…' : '⬇ Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Bind a request to a Test Data collection+group so it runs once per data set (during Run
// collection) — the API analog of a repeating group. Each row resolves its own {{tokens}}.
function DataIterateTab({ draft, collections, patch, navigate, onAutoCreate, autoMsg, onReload, onFillHeader }) {
  const colId = draft.iterate_collection_id || ''
  const col = collections.find(c => c.id === colId)
  const group = draft.iterate_group || 'all'
  const setCount = col
    ? (group === 'all' ? (col.sets || []).length : (col.sets || []).filter(s => s.group_type === group).length)
    : 0
  const detected = detectRequestFields(draft.body, draft.body_type).fields
  const headerFields = detectHeaderFields(draft.body)

  // Auto-build action — the fast path to a test-case collection from the request's own fields.
  const autoCreate = (
    <div className="sketch" style={{ padding: '10px 12px', background: 'var(--accent-soft)', display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 12 }}>✨ Auto-create test data</strong>
        {detected.length > 0 && <span className="badge badge-busy" style={{ fontSize: 10 }}>{detected.length} field{detected.length === 1 ? '' : 's'} detected</span>}
        <button className="btn-primary" style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 11 }}
          onClick={onAutoCreate} disabled={!detected.length}>Create collection from request fields</button>
      </div>
      <p style={{ fontSize: 11, color: 'var(--ink-soft)', margin: 0 }}>
        {detected.length
          ? <>Builds a collection (<code>{detected.slice(0, 4).join(', ')}{detected.length > 4 ? '…' : ''}</code>), wires the body to <code>{'{{tokens}}'}</code>, and binds iteration. Then fill rows in Test Data.</>
          : <>Add a request body (or import a WSDL) — the input fields are detected from it.</>}
      </p>
      {autoMsg && <p style={{ fontSize: 11, margin: 0, color: autoMsg.startsWith('✓') ? 'var(--ok)' : 'var(--bad)' }}>{autoMsg}</p>}
    </div>
  )

  // SOAP header boilerplate — tokenize it out of the raw envelope in one click.
  const headerBoilerplate = headerFields.length > 0 && (
    <div className="sketch" style={{ padding: '10px 12px', display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 12 }}>🧩 SOAP header boilerplate</strong>
        <span className="badge badge-busy" style={{ fontSize: 10 }}>{headerFields.length} field{headerFields.length === 1 ? '' : 's'}</span>
        <button className="btn-ghost" style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 11 }} onClick={onFillHeader}>Auto-fill header</button>
      </div>
      <p style={{ fontSize: 11, color: 'var(--ink-soft)', margin: 0 }}>
        Wires <code>{headerFields.join(', ')}</code> so you stop editing the raw envelope: timestamps/IDs auto-generate,
        the auth token uses <code>{'{{Token}}'}</code>, and constants (e.g. requestedChannel) become profile
        <strong> Variables</strong> you set once.
      </p>
    </div>
  )

  if (!collections.length) {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        {autoCreate}
        {headerBoilerplate}
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          No Test Data collections yet. Use ✨ above, or define one by hand and reference its values
          with <code>{'{{Collection.field}}'}</code> tokens.
        </p>
        <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px', justifySelf: 'start' }} onClick={() => navigate('testdata')}>Open Test Data →</button>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {autoCreate}
      {headerBoilerplate}
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
        Run this request <strong>once per data set</strong> in a collection (applied during <strong>▶ Run collection</strong>).
        Insert a value with the <code>{'{ }'}</code> picker on the Body — e.g. <code>{'{{' + (col?.name || 'Collection') + '.field}}'}</code>.
        Each row re-resolves its tokens; results are labelled by set name.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={colId} onChange={e => patch({ iterate_collection_id: e.target.value || null })} style={{ fontSize: 12, minWidth: 180 }}>
          <option value="">— don't iterate —</option>
          {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {colId && (
          <select value={group} onChange={e => patch({ iterate_group: e.target.value })} style={{ fontSize: 12 }}>
            {ITERATE_GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
        {colId && <span className="badge badge-busy" style={{ fontSize: 10 }}>{setCount} run{setCount === 1 ? '' : 's'}</span>}
        {colId && <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => navigate('testdata')}>Edit rows →</button>}
      </div>
      {col && <InlineDataEditor collection={col} group={group} onReload={onReload} />}
    </div>
  )
}

// Token picker menu rendered position:fixed at (x,y) so it's never clipped by a scroll container.
function CellTokenMenu({ x, y, onPick, onClose }) {
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const n = q.trim().toLowerCase()
    if (!n) return TOKEN_GROUPS
    return TOKEN_GROUPS.map(g => ({ ...g, tokens: g.tokens.filter(t => (t.token + t.label + t.desc).toLowerCase().includes(n)) })).filter(g => g.tokens.length)
  }, [q])
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
      <div style={{ position: 'fixed', left: x, top: y, zIndex: 61, width: 320, maxHeight: 320, display: 'flex', flexDirection: 'column',
        background: 'var(--surface)', border: '2px solid var(--line)', borderRadius: 8, boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        <div style={{ padding: 8, borderBottom: '1px solid var(--line-soft)' }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Search tokens — email, uuid, word…" style={{ width: '100%', fontSize: 12 }} />
        </div>
        <div style={{ overflow: 'auto', padding: '4px 0' }}>
          {groups.map(g => (
            <div key={g.name}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-soft)', padding: '8px 12px 4px' }}>{g.name}</div>
              {g.tokens.map(t => (
                <button key={t.token} type="button" onClick={() => onPick(t.token)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-soft)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-ink)' }}>{t.token}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{t.label} — {t.desc}</div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// Edit a collection's data sets (rows + values) inline — no trip to the Test Data page.
// ONE { } button inserts a token into whichever value cell was last focused.
function InlineDataEditor({ collection, group, onReload }) {
  const fields = collection.fields || []
  const [rows, setRows] = useState(() => parseSets(collection.sets))
  const [newField, setNewField] = useState('')
  const [menu, setMenu] = useState(null)
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const focusRef = useRef(null)              // { rowId, field, caret } of the last-focused cell
  const cellEls = useRef({})                 // "rowId|field" -> input element
  const tokBtn = useRef(null)
  // Reset local rows only when the bound collection itself changes (not on every parent reload),
  // so in-progress cell edits aren't clobbered by a count refresh.
  useEffect(() => { setRows(parseSets(collection.sets)) }, [collection.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = rows.filter(r => group === 'all' || r.group_type === group)

  // Autosave: edits mark a row dirty + debounce a save; we also refresh the parent's collections
  // so returning to this tab (which remounts the editor) reads the saved values, not stale ones.
  const dirty = useRef(new Set())
  const saveTimer = useRef(null)
  const reloadTimer = useRef(null)
  const persist = (id, override = {}) => {
    const r = rowsRef.current.find(x => x.id === id)
    if (r) window.api.saveDataSet({ id: r.id, collection_id: collection.id, name: r.name, group_type: r.group_type, values: r.values, sort_order: r.sort_order, ...override })
    clearTimeout(reloadTimer.current); reloadTimer.current = setTimeout(() => onReload?.(), 300)
  }
  const flush = () => {
    clearTimeout(saveTimer.current)
    dirty.current.forEach(id => persist(id))
    dirty.current.clear()
  }
  const touch = (id) => { dirty.current.add(id); clearTimeout(saveTimer.current); saveTimer.current = setTimeout(flush, 400) }
  // Save anything pending when the editor unmounts (e.g. switching request tabs mid-edit).
  useEffect(() => () => flush(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const setMeta = (id, p) => { setRows(rs => rs.map(r => r.id === id ? { ...r, ...p } : r)); touch(id) }
  const setCell = (id, f, v) => { setRows(rs => rs.map(r => r.id === id ? { ...r, values: { ...r.values, [f]: v } } : r)); touch(id) }
  const noteFocus = (rowId, field, el) => { focusRef.current = { rowId, field, caret: el.selectionStart ?? (el.value || '').length } }

  async function addRow() {
    const gt = group === 'all' ? 'positive' : group
    const { id } = await window.api.saveDataSet({ collection_id: collection.id, name: `Row ${rows.length + 1}`, group_type: gt, values: {}, sort_order: rows.length })
    setRows(rs => [...rs, { id, name: `Row ${rs.length + 1}`, group_type: gt, values: {}, sort_order: rs.length }])
    onReload?.()
  }
  async function delRow(id) { await window.api.deleteDataSet(id); setRows(rs => rs.filter(r => r.id !== id)); onReload?.() }
  async function addField() {
    const name = newField.trim(); if (!name) return
    await window.api.saveField({ collection_id: collection.id, name, type: 'text', sort_order: fields.length })
    setNewField(''); onReload?.()
  }

  // Open the single token menu, flipping up / clamping so it stays on screen.
  function openTokenMenu() {
    if (menu) return setMenu(null)
    const tgt = focusRef.current || (visible[0] && fields[0] && { rowId: visible[0].id, field: fields[0].name, caret: 0 })
    if (!tgt) return
    focusRef.current = tgt
    const r = tokBtn.current.getBoundingClientRect()
    const W = 320, H = 320
    const x = Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8))
    const y = (window.innerHeight - r.bottom > H + 12) ? r.bottom + 4 : Math.max(8, r.top - H - 4)
    setMenu({ x, y })
  }
  function insertToken(token) {
    const t = focusRef.current
    setMenu(null)
    if (!t) return
    const cur = (rowsRef.current.find(x => x.id === t.rowId)?.values[t.field]) ?? ''
    const caret = Math.min(t.caret ?? cur.length, cur.length)
    const next = cur.slice(0, caret) + token + cur.slice(caret)
    setCell(t.rowId, t.field, next)
    setTimeout(() => persist(t.rowId), 0)
    const el = cellEls.current[`${t.rowId}|${t.field}`]
    requestAnimationFrame(() => { if (el) { el.focus(); const p = caret + token.length; try { el.setSelectionRange(p, p) } catch { /* */ } } })
  }

  const th = { textAlign: 'left', padding: '2px 6px', borderBottom: '2px solid var(--line-soft)', color: 'var(--ink-soft)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', fontSize: 11 }
  const td = { padding: '2px 4px', verticalAlign: 'middle' }
  const cell = (w) => ({ width: w, fontFamily: 'var(--font-mono)', fontSize: 11 })

  return (
    <div className="sketch" style={{ padding: '10px 12px', display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="eyebrow">Rows — {collection.name}</span>
        <button ref={tokBtn} type="button" className="btn-ghost" title="Insert a token into the selected cell"
          style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: 11, fontFamily: 'var(--font-mono)' }} onClick={openTokenMenu}>{'{ }'}</button>
        <button className="btn-ghost" style={{ padding: '2px 10px', fontSize: 11 }} onClick={addRow}>＋ Add row</button>
      </div>
      {fields.length === 0
        ? <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>No fields yet — add one below to start.</p>
        : <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>
                <th style={th}>Set</th><th style={th}>Group</th>
                {fields.map(f => <th key={f.id} style={th}>{f.name}</th>)}
                <th style={th}></th>
              </tr></thead>
              <tbody>
                {visible.length === 0 && (
                  <tr><td colSpan={fields.length + 3} style={{ ...td, color: 'var(--text-muted)', fontSize: 11, padding: 8 }}>No rows in this group — ＋ Add row.</td></tr>
                )}
                {visible.map(r => (
                  <tr key={r.id}>
                    <td style={td}><input value={r.name} onChange={e => setMeta(r.id, { name: e.target.value })} onBlur={flush} style={cell(80)} /></td>
                    <td style={td}>
                      <select value={r.group_type} onChange={e => { setMeta(r.id, { group_type: e.target.value }); persist(r.id, { group_type: e.target.value }) }} style={{ fontSize: 11 }}>
                        {['positive', 'negative', 'edge'].map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </td>
                    {fields.map(f => (
                      <td key={f.id} style={td}>
                        <input value={r.values[f.name] ?? ''} placeholder="—"
                          ref={el => { if (el) cellEls.current[`${r.id}|${f.name}`] = el }}
                          onChange={e => { setCell(r.id, f.name, e.target.value); noteFocus(r.id, f.name, e.target) }}
                          onFocus={e => noteFocus(r.id, f.name, e.target)}
                          onSelect={e => noteFocus(r.id, f.name, e.target)}
                          onBlur={flush} style={cell(120)} />
                      </td>
                    ))}
                    <td style={td}><button className="btn-ghost" style={{ padding: '0 6px' }} onClick={() => delRow(r.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input value={newField} onChange={e => setNewField(e.target.value)} placeholder="new field name"
          onKeyDown={e => e.key === 'Enter' && addField()} style={{ fontSize: 11, width: 150, fontFamily: 'var(--font-mono)' }} />
        <button className="btn-ghost" style={{ padding: '2px 10px', fontSize: 11 }} onClick={addField} disabled={!newField.trim()}>＋ Add field</button>
        <button className="btn-ghost" style={{ padding: '2px 10px', fontSize: 11, marginLeft: 'auto' }} onClick={() => onReload?.()} title="Refresh from Test Data">↻</button>
      </div>
      {menu && <CellTokenMenu x={menu.x} y={menu.y} onPick={insertToken} onClose={() => setMenu(null)} />}
    </div>
  )
}

function ExtractEditor({ rows, onChange }) {
  const list = Array.isArray(rows) ? rows : []
  const set = (i, p) => onChange(list.map((r, idx) => idx === i ? { ...r, ...p } : r))
  const add = () => onChange([...list, { var: '', from: 'json', path: '' }])
  const del = (i) => onChange(list.filter((_, idx) => idx !== i))
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 4px' }}>
        Pull a value out of the response into a variable (e.g. <code>access_token</code> → <code>token</code>). JSON/XML use a dot path like <code>data.access_token</code>.
      </p>
      {list.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input value={r.var} placeholder="variable" style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            onChange={e => set(i, { var: e.target.value })} />
          <span style={{ color: 'var(--text-muted)' }}>←</span>
          <select value={r.from} onChange={e => set(i, { from: e.target.value })} style={{ width: 110, fontSize: 11 }}>
            {EXTRACT_FROM.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input value={r.path} placeholder={r.from === 'header' ? 'Header name' : r.from === 'status' ? '(n/a)' : 'data.token'}
            disabled={r.from === 'status'} style={{ flex: 2, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            onChange={e => set(i, { path: e.target.value })} />
          <button className="btn-ghost" style={{ padding: '2px 8px' }} onClick={() => del(i)}>✕</button>
        </div>
      ))}
      <button className="btn-ghost" style={{ alignSelf: 'start', padding: '4px 10px', fontSize: 11 }} onClick={add}>+ Add extraction</button>
    </div>
  )
}

function ResponseView({ response, respTab, setRespTab, onPick }) {
  const r = response.response || {}
  const ok = r.status >= 200 && r.status < 400
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        {r.error
          ? <span className="badge badge-bad">ERROR</span>
          : <span className={`badge ${ok ? 'badge-ok' : 'badge-bad'}`}>{r.status} {r.statusText}</span>}
        {!r.error && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.timeMs} ms</span>}
        {response.refetched && <span className="tag" style={{ fontSize: 9 }}>🔑 token re-fetched</span>}
        {response.status && <span className={`badge ${response.status === 'passed' ? 'badge-ok' : 'badge-bad'}`} style={{ marginLeft: 'auto' }}>{response.status}</span>}
      </div>
      {r.error
        ? <pre style={{ color: 'var(--bad)', fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'pre-wrap' }}>{r.error}</pre>
        : <>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {[['body', 'Body'], ['headers', 'Headers'], ['assertions', `Assertions${response.assertions?.length ? ` (${response.assertions.length})` : ''}`]].map(([id, lbl]) => (
                <button key={id} className="btn-ghost" onClick={() => setRespTab(id)}
                  style={{ padding: '3px 10px', fontSize: 11, color: respTab === id ? 'var(--accent)' : 'var(--ink-soft)', fontWeight: respTab === id ? 700 : 500 }}>{lbl}</button>
              ))}
            </div>
            {respTab === 'body' && (
              <ResponseBody body={r.body} onPick={onPick} />
            )}
            {respTab === 'headers' && (
              <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'pre-wrap', margin: 0 }}>
                {Object.entries(r.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n')}
              </pre>
            )}
            {respTab === 'assertions' && (
              (response.assertions?.length
                ? <div style={{ display: 'grid', gap: 4 }}>
                    {response.assertions.map((a, i) => (
                      <div key={i} style={{ fontSize: 12 }}>
                        <span className={`badge ${a.passed ? 'badge-ok' : 'badge-bad'}`} style={{ marginRight: 8 }}>{a.passed ? 'PASS' : 'FAIL'}</span>
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{a.type} = {a.expected}{!a.passed && a.type !== 'bodyContains' ? ` (got ${a.actual})` : ''}</span>
                      </div>
                    ))}
                  </div>
                : <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: 0 }}>No assertions on this request.</p>)
            )}
          </>}
    </div>
  )
}

// ── Response body: switch between a click-to-extract tree and raw text ────────
function ResponseBody({ body, onPick }) {
  const tree = useMemo(() => buildResponseTree(body), [body])
  const [mode, setMode] = useState('tree')
  const [picking, setPicking] = useState(null)   // { path, from, suggested } awaiting a var name

  const view = tree ? mode : 'raw'
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        {tree && (
          <div style={{ display: 'flex', gap: 4 }}>
            {[['tree', '🌲 Tree'], ['raw', 'Raw']].map(([id, lbl]) => (
              <button key={id} className="btn-ghost" onClick={() => setMode(id)}
                style={{ padding: '2px 10px', fontSize: 11, color: view === id ? 'var(--accent)' : 'var(--ink-soft)', fontWeight: view === id ? 700 : 500 }}>{lbl}</button>
            ))}
          </div>
        )}
        {tree && view === 'tree' && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Click any value to save it into a variable.</span>}
      </div>

      {picking && (
        <div className="sketch" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 8, background: 'var(--accent-soft)' }}>
          <span style={{ fontSize: 12 }}>Save as</span>
          <input autoFocus value={picking.suggested} onChange={e => setPicking(p => ({ ...p, suggested: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') { onPick({ var: picking.suggested.trim() || 'value', from: picking.from, path: picking.path }); setPicking(null) } }}
            style={{ width: 160, fontFamily: 'var(--font-mono)', fontSize: 12 }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>← {picking.path}</span>
          <button className="btn-primary" style={{ padding: '2px 10px', fontSize: 11, marginLeft: 'auto' }}
            onClick={() => { onPick({ var: picking.suggested.trim() || 'value', from: picking.from, path: picking.path }); setPicking(null) }}>Add</button>
          <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setPicking(null)}>✕</button>
        </div>
      )}

      {view === 'tree'
        ? <div style={{ maxHeight: 320, overflow: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            <TreeNode node={tree.root} from={tree.from}
              onLeaf={(path, suggested) => setPicking({ path, from: tree.from, suggested })} />
          </div>
        : <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflow: 'auto', margin: 0 }}>{pretty(body)}</pre>}
    </div>
  )
}

function TreeNode({ node, from, onLeaf, depth = 0 }) {
  const pad = { paddingLeft: depth * 14 }
  if (node.leaf) {
    return (
      <div style={{ ...pad, padding: '1px 0 1px ' + (depth * 14) + 'px' }}>
        <span style={{ color: 'var(--ink-soft)' }}>{node.label}: </span>
        <span onClick={() => onLeaf(node.path, node.label)} title={`Save ${node.path} → variable`}
          style={{ color: 'var(--accent-ink)', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
          {String(node.value).length > 80 ? String(node.value).slice(0, 80) + '…' : String(node.value || '∅')}
        </span>
      </div>
    )
  }
  return (
    <div>
      <div style={{ ...pad, color: 'var(--ink-soft)' }}>{node.label}</div>
      {node.children.map((c, i) => <TreeNode key={i} node={c} from={from} onLeaf={onLeaf} depth={depth + 1} />)}
    </div>
  )
}

// Parse a response body into a normalized tree whose paths match the engine's resolver
// (fast-xml-parser removeNSPrefix for XML; dot/bracket for JSON).
function buildResponseTree(body) {
  if (!body) return null
  const t = body.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return { from: 'json', root: jsonNode(JSON.parse(t), '', 'response') } } catch { /* fall through */ }
  }
  if (t.startsWith('<')) {
    try {
      const doc = new DOMParser().parseFromString(t, 'application/xml')
      if (doc.getElementsByTagName('parsererror').length === 0 && doc.documentElement) {
        return { from: 'xml', root: xmlNode(doc.documentElement, doc.documentElement.localName) }
      }
    } catch { /* fall through */ }
  }
  return null
}

function jsonNode(value, path, label) {
  if (Array.isArray(value)) {
    return { label, path, children: value.map((v, i) => jsonNode(v, `${path}[${i}]`, `[${i}]`)) }
  }
  if (value && typeof value === 'object') {
    return { label, path, children: Object.entries(value).map(([k, v]) => jsonNode(v, path ? `${path}.${k}` : k, k)) }
  }
  return { label, path, leaf: true, value }
}

function xmlNode(el, path) {
  const kids = Array.from(el.children)
  if (kids.length === 0) return { label: el.localName, path, leaf: true, value: el.textContent }
  const counts = {}
  kids.forEach(k => { counts[k.localName] = (counts[k.localName] || 0) + 1 })
  const idx = {}
  const children = kids.map(k => {
    const ln = k.localName
    let seg = ln
    if (counts[ln] > 1) { const i = idx[ln] || 0; idx[ln] = i + 1; seg = `${ln}[${i}]` }
    return xmlNode(k, path ? `${path}.${seg}` : seg)
  })
  return { label: el.localName, path, children }
}

function RunDrawer({ run, onClose, navigate }) {
  return (
    <div style={{ position: 'fixed', right: 18, bottom: 18, width: 380, maxHeight: '60vh', zIndex: 50,
      display: 'flex', flexDirection: 'column' }} className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '2px solid var(--line-soft)' }}>
        <span className="eyebrow">Collection run</span>
        {run.summary && <span className={`badge ${run.summary.status === 'passed' ? 'badge-ok' : 'badge-bad'}`}>{run.summary.status}</span>}
        <button className="btn-ghost" style={{ marginLeft: 'auto', padding: '2px 8px' }} onClick={onClose}>✕</button>
      </div>
      <div style={{ padding: '10px 12px', overflowY: 'auto', flex: 1 }}>
        {run.logs.map((l, i) => (
          <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, marginBottom: 3,
            color: l.status === 'failed' || l.type === 'error' ? 'var(--bad)' : l.status === 'passed' ? 'var(--ok)' : 'var(--ink-soft)' }}>
            {l.text}
          </div>
        ))}
        {run.summary && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '2px solid var(--line-soft)', fontSize: 12 }}>
            <strong>{run.summary.passed}/{run.summary.passed + run.summary.failed}</strong> passed · {run.summary.durationMs} ms
            <button className="btn-ghost" style={{ marginLeft: 8, padding: '2px 10px', fontSize: 11 }}
              onClick={() => navigate('results', { runId: run.summary.runId })}>View report →</button>
          </div>
        )}
      </div>
    </div>
  )
}
