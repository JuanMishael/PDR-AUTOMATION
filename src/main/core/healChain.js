/**
 * Self-healing selector fallbacks.
 *
 * A step stores one primary `selector`. Sites drift (a class renamed, an id changed,
 * a wrapper div added) and that one selector stops matching even though the element is
 * still there. `selectorChain` is a list of extra, validated ways to re-find the SAME
 * element — captured automatically by the picker from the candidates it already ranks.
 * At run time we `.or()` the primary with the manual Alt Selector and the auto chain, so
 * if the primary rots one of the alternatives keeps the step green.
 *
 * Returns the fallback selectors (manual selector2 first, then the auto chain), trimmed,
 * deduped, and with the primary excluded. Empty array = no healing, caller uses the bare
 * primary locator.
 */
export function healAlts(p) {
  const out = []
  const seen = new Set([(p.selector || '').trim()])
  const push = (s) => {
    s = (s || '').trim()
    if (s && !seen.has(s)) { seen.add(s); out.push(s) }
  }
  push(p.selector2)
  const chain = Array.isArray(p.selectorChain) ? p.selectorChain : []
  for (const s of chain) push(s)
  return out
}

// demo: run with `node src/main/core/healChain.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b) || (() => { throw new Error(`FAIL: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`) })()
  eq(healAlts({ selector: '#a' }), [])
  eq(healAlts({ selector: '#a', selector2: '.b' }), ['.b'])
  eq(healAlts({ selector: '#a', selector2: '.b', selectorChain: ['.b', '#c', '#a', ' '] }), ['.b', '#c']) // dedup + drop primary + blank
  eq(healAlts({ selector: '#a', selectorChain: ['#c', '#d'] }), ['#c', '#d'])
  console.log('healChain ok')
}
