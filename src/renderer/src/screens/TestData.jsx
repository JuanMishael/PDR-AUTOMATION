import { useEffect, useState } from 'react'
import { Icon } from '../components/SketchDefs'
import { confirmDialog } from '../lib/confirm'
import TokenField from '../components/TokenField'

// Fixed intent groups (Phase 1). Each data set is tagged into exactly one.
const GROUPS = [
  { key: 'positive', label: 'Positive', emoji: '📗' },
  { key: 'negative', label: 'Negative', emoji: '📕' },
  { key: 'edge',     label: 'Edge',     emoji: '📒' }
]
const FIELD_TYPES = ['text', 'email', 'number', 'date', 'select', 'phone']
const exportItem = { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, width: '100%',
  textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--text, var(--ink))',
  fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const exportHint = { fontSize: 10, fontWeight: 400, color: 'var(--ink-soft, #888)', fontFamily: 'var(--font-mono)' }

export default function TestData() {
  const [collections, setCollections] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  // Electron's renderer has no window.prompt(), so collection create/rename use inline inputs.
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => { load() }, [])

  async function load(keepId) {
    const cols = await window.api.getCollections()
    setCollections(cols)
    setSelectedId(prev => {
      const want = keepId ?? prev
      if (want && cols.some(c => c.id === want)) return want
      return cols[0]?.id || null
    })
  }

  const selected = collections.find(c => c.id === selectedId) || null

  // --- Collections ---
  function startCreate() { setNewName(''); setCreating(true) }
  function cancelCreate() { setCreating(false); setNewName('') }
  async function commitCreate() {
    const name = newName.trim()
    if (!name) { cancelCreate(); return }
    const { id } = await window.api.saveCollection({ name })
    setCreating(false); setNewName('')
    await load(id)
  }

  async function renameCollection(c, name) {
    const next = (name || '').trim()
    if (!next || next === c.name) return
    await window.api.saveCollection({ id: c.id, name: next, description: c.description })
    await load(c.id)
  }

  async function importCollection() {
    const res = await window.api.importCollection()
    if (res?.ok) await load(res.id)
    else if (res?.error) alert(res.error)
  }

  async function deleteCollection(c) {
    if (!(await confirmDialog(`Delete collection "${c.name}" and all its fields & data sets?`, { confirmText: 'Delete' }))) return
    await window.api.deleteCollection(c.id)
    await load()
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1>Test Data</h1>
        <p>Define a form once as a <strong>collection</strong>, then store reusable <strong>data sets</strong> grouped by intent. Reference values in steps with <code>{'{{Collection.field}}'}</code>.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20, alignItems: 'start' }}>
        {/* Collections list */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 className="eyebrow" style={{ margin: 0 }}>Collections</h2>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-sm" onClick={importCollection} title="Import a collection shared by another QA (.json)">⬆ Import</button>
              <button className="btn btn-sm" onClick={startCreate}><Icon name="plus" size={14} /> New</button>
            </div>
          </div>
          {creating && (
            <div className="sketch" style={{ padding: '8px 10px', marginBottom: 6 }}>
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Collection name (e.g. Customer)…"
                onKeyDown={e => { if (e.key === 'Enter') commitCreate(); if (e.key === 'Escape') cancelCreate() }}
                onBlur={commitCreate}
                style={{ width: '100%', fontFamily: 'var(--font-hand)', fontSize: 16 }} />
              <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 4 }}>Enter to create · Esc to cancel</div>
            </div>
          )}
          {collections.length > 4 && (
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Filter collections…" style={{ width: '100%', fontSize: 12, marginBottom: 8 }} />
          )}
          {collections.length === 0 && !creating ? (
            <div className="card empty-state" style={{ padding: 24 }}>
              <div className="empty-icon"><Icon name="data" size={30} /></div>
              <p style={{ margin: 0, fontSize: 13 }}>No collections yet.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {(() => {
                const q = search.trim().toLowerCase()
                const visible = q ? collections.filter(c => c.name.toLowerCase().includes(q)) : collections
                if (collections.length > 0 && visible.length === 0) {
                  return <p style={{ fontSize: 12, color: 'var(--ink-soft)', textAlign: 'center', padding: '8px 0' }}>No matches</p>
                }
                return visible.map(c => {
                const active = c.id === selectedId
                return (
                  <div key={c.id} className={active ? 'card' : 'sketch'}
                    onClick={() => setSelectedId(c.id)}
                    style={{
                      padding: '10px 13px', cursor: 'pointer',
                      borderColor: active ? 'var(--accent)' : undefined,
                      background: active ? 'var(--accent-soft)' : undefined
                    }}>
                    <div style={{ fontFamily: 'var(--font-hand)', fontSize: 17, color: 'var(--ink)' }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>
                      {c.fields.length} field{c.fields.length !== 1 ? 's' : ''} · {c.sets.length} set{c.sets.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                )
              })
              })()}
            </div>
          )}
        </div>

        {/* Editor */}
        {selected ? (
          <CollectionEditor
            key={selected.id}
            collection={selected}
            onRename={name => renameCollection(selected, name)}
            onDelete={() => deleteCollection(selected)}
            reload={() => load(selected.id)}
          />
        ) : (
          <div className="card empty-state" style={{ padding: 48 }}>
            <div className="empty-icon"><Icon name="data" size={40} /></div>
            <p>Create a collection to start building test data.</p>
            <button className="btn-primary" onClick={startCreate}>+ New Collection</button>
          </div>
        )}
      </div>
    </div>
  )
}

function CollectionEditor({ collection, onRename, onDelete, reload }) {
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(collection.name)
  const [importing, setImporting] = useState(false)
  const [exportMenu, setExportMenu] = useState(false)

  function commitRename() {
    setRenaming(false)
    if (nameDraft.trim() && nameDraft.trim() !== collection.name) onRename(nameDraft)
    else setNameDraft(collection.name)
  }

  async function doExport(format) {
    setExportMenu(false)
    const res = await window.api.exportCollection(collection.id, format)
    if (res?.error) alert(res.error)
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          {renaming ? (
            <input autoFocus value={nameDraft} onChange={e => setNameDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setRenaming(false); setNameDraft(collection.name) } }}
              onBlur={commitRename}
              style={{ fontFamily: 'var(--font-hand)', fontSize: 26, color: 'var(--ink)', width: '100%' }} />
          ) : (
            <div style={{ fontFamily: 'var(--font-hand)', fontSize: 26, color: 'var(--ink)' }}>{collection.name}</div>
          )}
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Token prefix: <code>{'{{' + collection.name + '.field}}'}</code></div>
        </div>
        <button className="btn btn-sm" onClick={() => setImporting(true)}>⬇ Import rows</button>
        <div style={{ position: 'relative' }}>
          <button className="btn btn-sm" onClick={() => setExportMenu(o => !o)}
            title="Export this collection to share with other QA">⬆ Export ▾</button>
          {exportMenu && (
            <>
              <div onClick={() => setExportMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 19 }} />
              <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 20, marginTop: 4, minWidth: 200,
                background: 'var(--surface, #fff)', border: '1px solid var(--border)', borderRadius: 8,
                boxShadow: '0 6px 20px rgba(0,0,0,.18)', overflow: 'hidden' }}>
                <button onClick={() => doExport('json')} style={exportItem}>
                  Full collection <span style={exportHint}>.json — fields + selectors + all sets</span>
                </button>
                <button onClick={() => doExport('csv')} style={{ ...exportItem, borderTop: '1px solid var(--border)' }}>
                  Data rows only <span style={exportHint}>.csv — re-importable via paste</span>
                </button>
              </div>
            </>
          )}
        </div>
        <button className="btn btn-sm" onClick={() => { setNameDraft(collection.name); setRenaming(true) }}>Rename</button>
        <button className="btn-danger btn-sm" onClick={onDelete}>Delete</button>
      </div>

      {importing && <ImportRowsModal collection={collection} onClose={() => setImporting(false)} onDone={reload} />}

      <FieldsSection collection={collection} reload={reload} />
      <SetsSection collection={collection} reload={reload} />
    </div>
  )
}

// --- The "form builder": fields define the shape once ---
const FIELD_GRID = '1.1fr 0.8fr 1.4fr 1.5fr 32px'

function FieldsSection({ collection, reload }) {
  // Where the form lives, so the 🎯 Pick button can open it. Per-session (not persisted) —
  // the tester opens the page once and picks each field's selector against it.
  const [formUrl, setFormUrl] = useState('')

  async function addField() {
    const order = collection.fields.length
    await window.api.saveField({ collection_id: collection.id, name: `field${order + 1}`, type: 'text', sort_order: order })
    await reload()
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 className="eyebrow" style={{ margin: 0 }}>Fields</h2>
        <button className="btn btn-sm" onClick={addField}><Icon name="plus" size={14} /> Add Field</button>
      </div>

      {/* Form page URL — used by the per-field 🎯 Pick button to open the right page. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>Form page URL</label>
        <input value={formUrl} onChange={e => setFormUrl(e.target.value)}
          placeholder="https://app.example.com/customers/new — open this to 🎯 pick fields"
          style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }} />
      </div>

      {collection.fields.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: 0 }}>
          No fields yet. Add the fields this form/entity contains (e.g. firstName, email, region).
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: FIELD_GRID, gap: 8, fontSize: 11,
            color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
            <span>Name</span><span>Type</span><span>Default (token or literal)</span><span>Selector (where it fills)</span><span />
          </div>
          {collection.fields.map(f => <FieldRow key={f.id} field={f} formUrl={formUrl} reload={reload} />)}
        </div>
      )}
      <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 12, marginBottom: 0 }}>
        Default fills in when a data set leaves the field blank. Click the <code>{'{ }'}</code> button in any value box to insert a token — random names, emails, sentences, dates and more.
        Give a field a <strong>selector</strong> and you can drop the whole form into a scenario in one click (▦ Fill form).
      </p>
    </div>
  )
}

function FieldRow({ field, formUrl, reload }) {
  const [draft, setDraft] = useState(field)
  const [picking, setPicking] = useState(false)
  const [pickMsg, setPickMsg] = useState(null)
  const changed = draft.name !== field.name || draft.type !== field.type ||
    draft.default_token !== field.default_token || draft.selector !== field.selector

  async function persist(next = draft) {
    await window.api.saveField({ ...next, collection_id: field.collection_id })
    await reload()
  }
  async function remove() {
    if (!(await confirmDialog(`Delete field "${field.name}"?`, { confirmText: 'Delete' }))) return
    await window.api.deleteField(field.id)
    await reload()
  }
  async function pick() {
    if (!formUrl.trim()) { setPickMsg('Set the Form page URL above first'); setTimeout(() => setPickMsg(null), 3000); return }
    setPicking(true); setPickMsg(null)
    try {
      const res = await window.api.pickElement({ url: formUrl, baseUrl: formUrl, browser: 'chromium', steps: [], runSteps: false })
      if (res?.ok && res.selector) {
        const next = { ...draft, selector: res.selector }
        setDraft(next); await persist(next)
      } else if (!res?.cancelled) {
        setPickMsg(res?.error || 'Could not capture element'); setTimeout(() => setPickMsg(null), 4000)
      }
    } catch (e) {
      setPickMsg(e?.message || 'Picker error'); setTimeout(() => setPickMsg(null), 4000)
    } finally { setPicking(false) }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: FIELD_GRID, gap: 8, alignItems: 'center' }}>
      <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} onBlur={() => changed && persist()}
        style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
      <select value={draft.type} onChange={e => setDraft(d => ({ ...d, type: e.target.value }))} onBlur={() => changed && persist()}>
        {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <TokenField value={draft.default_token || ''} placeholder="(optional)"
        onChange={v => setDraft(d => ({ ...d, default_token: v }))} onBlur={() => changed && persist()} />
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input value={draft.selector || ''} placeholder={pickMsg || '#email or 🎯 Pick'} title={pickMsg || ''}
          onChange={e => setDraft(d => ({ ...d, selector: e.target.value }))} onBlur={() => changed && persist()}
          style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 12,
            borderColor: pickMsg ? 'var(--danger, #EF4444)' : undefined }} />
        <button className="btn btn-sm" title="Pick this field on the form page" disabled={picking}
          style={{ padding: '4px 8px', fontSize: 12, flexShrink: 0 }} onClick={pick}>{picking ? '…' : '🎯'}</button>
      </div>
      <button className="btn-danger" title="Delete field"
        style={{ padding: '4px 0', fontSize: 12, width: 32 }} onClick={remove}>✕</button>
    </div>
  )
}

// --- Data sets grouped by intent ---
function SetsSection({ collection, reload }) {
  async function addSet(group) {
    const count = collection.sets.filter(s => s.group_type === group).length
    await window.api.saveDataSet({
      collection_id: collection.id,
      name: `${group} set ${count + 1}`,
      group_type: group,
      values: {},
      sort_order: count
    })
    await reload()
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {GROUPS.map(g => {
        const sets = collection.sets.filter(s => s.group_type === g.key)
        return (
          <div key={g.key} className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: sets.length ? 12 : 0 }}>
              <h2 className="eyebrow" style={{ margin: 0 }}>{g.emoji} {g.label} sets</h2>
              <button className="btn btn-sm" onClick={() => addSet(g.key)}
                disabled={collection.fields.length === 0}
                title={collection.fields.length === 0 ? 'Add fields first' : ''}>
                <Icon name="plus" size={14} /> Add set
              </button>
            </div>
            {sets.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--ink-faint)', margin: '8px 0 0' }}>No {g.label.toLowerCase()} sets.</p>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {sets.map(s => <SetRow key={s.id} set={s} fields={collection.fields} reload={reload} />)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SetRow({ set, fields, reload }) {
  const [name, setName] = useState(set.name)
  const [values, setValues] = useState(() => { try { return JSON.parse(set.field_values || '{}') } catch { return {} } })

  async function persist(nextName = name, nextValues = values) {
    await window.api.saveDataSet({
      id: set.id, collection_id: set.collection_id,
      name: nextName, group_type: set.group_type, values: nextValues, sort_order: set.sort_order
    })
    await reload()
  }
  async function remove() {
    if (!(await confirmDialog(`Delete data set "${set.name}"?`, { confirmText: 'Delete' }))) return
    await window.api.deleteDataSet(set.id)
    await reload()
  }
  function setVal(fieldName, v) { setValues(prev => ({ ...prev, [fieldName]: v })) }

  return (
    <div className="sketch" style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <input value={name} onChange={e => setName(e.target.value)} onBlur={() => name !== set.name && persist()}
          style={{ flex: 1, fontFamily: 'var(--font-hand)', fontSize: 16 }} />
        <button className="btn-danger" style={{ padding: '4px 10px', fontSize: 11 }} onClick={remove}>Delete</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
        {fields.map(f => (
          <div key={f.id}>
            <label style={{ fontSize: 11, color: 'var(--ink-soft)', fontFamily: 'var(--font-mono)' }}>{f.name}</label>
            <TokenField value={values[f.name] ?? ''} placeholder={f.default_token || '(default)'}
              onChange={v => setVal(f.name, v)} onBlur={() => persist()} />
          </div>
        ))}
      </div>
    </div>
  )
}

// --- Import: paste CSV/TSV (e.g. copied from Excel) → fields + one data set per row ---
function parseTable(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '')
  if (lines.length < 2) return null
  const delim = lines[0].includes('\t') ? '\t' : ','
  const cells = l => l.split(delim).map(c => c.trim())
  return { headers: cells(lines[0]), rows: lines.slice(1).map(cells) }
}
const INTENT_COLS = ['intent', 'group', 'group_type', 'type']
const VALID_GROUPS = ['positive', 'negative', 'edge']

function ImportRowsModal({ collection, onClose, onDone }) {
  const [text, setText] = useState('')
  const [group, setGroup] = useState('positive')   // default when no intent column
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const parsed = parseTable(text)
  const intentIdx = parsed ? parsed.headers.findIndex(h => INTENT_COLS.includes(h.toLowerCase())) : -1
  const fieldHeaders = parsed ? parsed.headers.filter((_, i) => i !== intentIdx) : []

  async function doImport() {
    if (!parsed) { setErr('Paste a header row plus at least one data row'); return }
    if (fieldHeaders.length === 0) { setErr('No field columns found'); return }
    setBusy(true); setErr(null)
    try {
      const existing = new Set(collection.fields.map(f => f.name.toLowerCase()))
      let order = collection.fields.length
      for (const h of fieldHeaders) {
        if (h && !existing.has(h.toLowerCase())) {
          await window.api.saveField({ collection_id: collection.id, name: h, type: 'text', sort_order: order++ })
          existing.add(h.toLowerCase())
        }
      }
      const counts = {}
      let i = 0
      for (const row of parsed.rows) {
        const values = {}
        parsed.headers.forEach((h, idx) => { if (idx !== intentIdx && h) values[h] = row[idx] ?? '' })
        let g = intentIdx >= 0 ? (row[intentIdx] || '').toLowerCase() : group
        if (!VALID_GROUPS.includes(g)) g = group
        counts[g] = (counts[g] || 0) + 1
        await window.api.saveDataSet({
          collection_id: collection.id, name: `imported ${g} ${counts[g]}`,
          group_type: g, values, sort_order: 100 + i++
        })
      }
      await onDone()
      onClose()
    } catch (e) { setErr(e?.message || 'Import failed'); setBusy(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div className="card" style={{ width: 620, maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: 12 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-hand)', fontSize: 22, color: 'var(--ink)' }}>Import rows → {collection.name}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: 0 }}>
          Paste comma- or tab-separated rows (copy straight from Excel/Sheets). First row = field names; each later row becomes a data set.
          Add an <code>intent</code> column (positive/negative/edge) to tag rows individually.
        </p>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={9}
          placeholder={'username, password, intent\nt-dmdianzon, pass1, positive\nbaduser, wrong, negative'}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12, width: '100%', resize: 'vertical' }} />
        {parsed && (
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
            Detected <strong>{fieldHeaders.length}</strong> field{fieldHeaders.length !== 1 ? 's' : ''} ({fieldHeaders.join(', ')}),{' '}
            <strong>{parsed.rows.length}</strong> row{parsed.rows.length !== 1 ? 's' : ''}
            {intentIdx >= 0 ? ' · intent column found' : ''}.
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {intentIdx < 0 && (
            <>
              <label style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Group all rows as</label>
              <select value={group} onChange={e => setGroup(e.target.value)} style={{ fontSize: 12 }}>
                {VALID_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </>
          )}
          {err && <span style={{ fontSize: 12, color: 'var(--danger, #EF4444)' }}>{err}</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy || !parsed} style={{ padding: '6px 16px', fontSize: 13 }}
              onClick={doImport}>{busy ? 'Importing…' : `Import ${parsed ? parsed.rows.length : 0} row${parsed && parsed.rows.length !== 1 ? 's' : ''}`}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
