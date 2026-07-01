// Group-block expansion, shared by the run path (ipc/runner) and the replay path
// (record/pick/test via ipc handlers). A groupStart..groupEnd block is inlined; a REPEATING
// group (loopStart, or a group flagged repeat) runs its body once per data set in the chosen
// collection+group, resolving each set's {{tokens}}. Groups nest (bodies expand recursively).
//
// opts.firstSetOnly: replay is a single pass to POSITION the browser, not a data-driven run —
// it can't type five rows into one field. So replay expands a repeating group's body ONCE,
// against the group's FIRST selected set, so real (positive/negative/pinned) values are used
// instead of bare field defaults. The run leaves it false and iterates every set.

import { buildDataContext, resolveParams } from './tokenResolver'

function parseParams(p) {
  if (typeof p !== 'string') return p || {}
  try { return JSON.parse(p) } catch { return {} }
}

const isGroupStart = a => a === 'groupStart' || a === 'loopStart'
const isGroupEnd = a => a === 'groupEnd' || a === 'loopEnd'

async function expandGroupsInner(db, steps, opts = {}) {
  const out = []
  let i = 0
  while (i < steps.length) {
    const s = steps[i]
    if (isGroupStart(s.action)) {
      // Find the matching end by tracking nesting depth.
      let depth = 1, j = i + 1
      const body = []
      while (j < steps.length && depth > 0) {
        if (isGroupStart(steps[j].action)) depth++
        else if (isGroupEnd(steps[j].action)) { depth--; if (depth === 0) break }
        body.push(steps[j]); j++
      }
      const p = parseParams(s.params)
      if (p._skip) { i = j + 1; continue }   // skipped group — drop the whole block
      const repeat = s.action === 'loopStart' || !!p.repeat
      const expandedBody = await expandGroupsInner(db, body, opts)   // resolve any nested groups first

      if (repeat && p.collectionId) {
        // Sets to iterate, all scoped to THIS group's collection — that scoping matters because the
        // body's {{Collection.field}} tokens key off this collection's NAME (see tokenResolver). A
        // set from another collection would build the context under the wrong name and resolve every
        // token to its empty default.
        const byGroup = () => p.group && p.group !== 'all'
          ? db.prepare('SELECT * FROM data_sets WHERE collection_id = ? AND group_type = ? ORDER BY sort_order').all(p.collectionId, p.group)
          : db.prepare('SELECT * FROM data_sets WHERE collection_id = ? ORDER BY sort_order').all(p.collectionId)

        let sets
        if (p.dataSetId) {
          // A pinned dataSetId runs the body ONCE with just that set — but only if it actually
          // belongs to this group's collection. A stale pin (collection swapped/duplicated after
          // pinning) is self-healed: re-pin to the same-named set here, else fall back to this
          // collection's sets, so the data still loads instead of silently filling blanks.
          sets = db.prepare('SELECT * FROM data_sets WHERE id = ? AND collection_id = ?').all(p.dataSetId, p.collectionId)
          if (!sets.length) {
            const pinned = db.prepare('SELECT name FROM data_sets WHERE id = ?').get(p.dataSetId)
            sets = pinned
              ? db.prepare('SELECT * FROM data_sets WHERE collection_id = ? AND name = ? ORDER BY sort_order').all(p.collectionId, pinned.name)
              : []
            if (!sets.length) sets = byGroup()
          }
        } else {
          sets = byGroup()
        }
        // Replay: one representative pass — the group's first selected set (see opts.firstSetOnly).
        if (opts.firstSetOnly) sets = sets.slice(0, 1)
        for (const set of sets) {
          const ctx = await buildDataContext(db, set.id)
          for (const b of expandedBody) {
            out.push({ id: b.id, action: b.action, label: `[${set.name}] ${b.label || b.action}`, params: resolveParams(parseParams(b.params), ctx) })
          }
        }
      } else {
        for (const b of expandedBody) out.push(b)   // organizational group — inline once
      }
      i = j + 1   // skip the matching end marker
    } else if (isGroupEnd(s.action)) {
      i++   // stray end — ignore
    } else {
      const sp = parseParams(s.params)
      if (!sp._skip) out.push({ id: s.id, action: s.action, label: s.label, params: sp })   // skip disabled steps
      i++   // ← advance past this regular step (omitting this spun forever → heap OOM)
    }
  }
  return out
}

export async function expandGroups(db, steps, opts = {}) {
  const out = await expandGroupsInner(db, steps, opts)
  out.forEach((s, idx) => { s.sort_order = idx })
  return out
}
