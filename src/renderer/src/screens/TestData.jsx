import { useEffect, useState } from 'react'
import { Icon } from '../components/SketchDefs'

// Fixed intent groups (Phase 1). Each data set is tagged into exactly one.
const GROUPS = [
  { key: 'positive', label: 'Positive', emoji: '📗' },
  { key: 'negative', label: 'Negative', emoji: '📕' },
  { key: 'edge',     label: 'Edge',     emoji: '📒' }
]
const FIELD_TYPES = ['text', 'email', 'number', 'date', 'select', 'phone']

export default function TestData() {
  const [collections, setCollections] = useState([])
  const [selectedId, setSelectedId] = useState(null)

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
  async function addCollection() {
    const name = prompt('New collection name (e.g. Customer, Invoice):')
    if (!name || !name.trim()) return
    const { id } = await window.api.saveCollection({ name: name.trim() })
    await load(id)
  }

  async function renameCollection(c) {
    const name = prompt('Rename collection:', c.name)
    if (!name || !name.trim() || name.trim() === c.name) return
    await window.api.saveCollection({ id: c.id, name: name.trim(), description: c.description })
    await load(c.id)
  }

  async function deleteCollection(c) {
    if (!confirm(`Delete collection "${c.name}" and all its fields & data sets?`)) return
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
            <button className="btn btn-sm" onClick={addCollection}><Icon name="plus" size={14} /> New</button>
          </div>
          {collections.length === 0 ? (
            <div className="card empty-state" style={{ padding: 24 }}>
              <div className="empty-icon"><Icon name="data" size={30} /></div>
              <p style={{ margin: 0, fontSize: 13 }}>No collections yet.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {collections.map(c => {
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
              })}
            </div>
          )}
        </div>

        {/* Editor */}
        {selected ? (
          <CollectionEditor
            key={selected.id}
            collection={selected}
            onRename={() => renameCollection(selected)}
            onDelete={() => deleteCollection(selected)}
            reload={() => load(selected.id)}
          />
        ) : (
          <div className="card empty-state" style={{ padding: 48 }}>
            <div className="empty-icon"><Icon name="data" size={40} /></div>
            <p>Create a collection to start building test data.</p>
            <button className="btn-primary" onClick={addCollection}>+ New Collection</button>
          </div>
        )}
      </div>
    </div>
  )
}

function CollectionEditor({ collection, onRename, onDelete, reload }) {
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-hand)', fontSize: 26, color: 'var(--ink)' }}>{collection.name}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Token prefix: <code>{'{{' + collection.name + '.field}}'}</code></div>
        </div>
        <button className="btn btn-sm" onClick={onRename}>Rename</button>
        <button className="btn-danger btn-sm" onClick={onDelete}>Delete</button>
      </div>

      <FieldsSection collection={collection} reload={reload} />
      <SetsSection collection={collection} reload={reload} />
    </div>
  )
}

// --- The "form builder": fields define the shape once ---
function FieldsSection({ collection, reload }) {
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

      {collection.fields.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: 0 }}>
          No fields yet. Add the fields this form/entity contains (e.g. firstName, email, region).
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.9fr 1.6fr 32px', gap: 8, fontSize: 11,
            color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
            <span>Name</span><span>Type</span><span>Default (token or literal)</span><span />
          </div>
          {collection.fields.map(f => <FieldRow key={f.id} field={f} reload={reload} />)}
        </div>
      )}
      <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 12, marginBottom: 0 }}>
        Default fills in when a data set leaves the field blank. Tokens: <code>{'{{faker.internet.email}}'}</code>, <code>{'{{faker.person.firstName}}'}</code>, <code>{'{{unique.email}}'}</code>, <code>{'{{unique.ref}}'}</code>
      </p>
    </div>
  )
}

function FieldRow({ field, reload }) {
  const [draft, setDraft] = useState(field)
  const changed = draft.name !== field.name || draft.type !== field.type || draft.default_token !== field.default_token

  async function persist() {
    if (!changed) return
    await window.api.saveField({ ...draft, collection_id: field.collection_id })
    await reload()
  }
  async function remove() {
    if (!confirm(`Delete field "${field.name}"?`)) return
    await window.api.deleteField(field.id)
    await reload()
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.9fr 1.6fr 32px', gap: 8, alignItems: 'center' }}>
      <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} onBlur={persist}
        style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
      <select value={draft.type} onChange={e => setDraft(d => ({ ...d, type: e.target.value }))} onBlur={persist}>
        {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <input value={draft.default_token} placeholder="(optional)"
        onChange={e => setDraft(d => ({ ...d, default_token: e.target.value }))} onBlur={persist}
        style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
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
    if (!confirm(`Delete data set "${set.name}"?`)) return
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
            <input value={values[f.name] ?? ''} placeholder={f.default_token || '(default)'}
              onChange={e => setVal(f.name, e.target.value)} onBlur={() => persist()}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
          </div>
        ))}
      </div>
    </div>
  )
}
