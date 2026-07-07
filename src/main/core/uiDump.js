// Pure parser for an Android `uiautomator dump` XML → a flat list of pickable elements.
// Kept side-effect-free (no electron/adb) so it's unit-testable; the IPC layer (ipc/nativePicker)
// handles adb and calls this.
import { XMLParser } from 'fast-xml-parser'

// Best locator for a node: resource-id > content-desc > visible text. null = nothing to target.
export function bestLocator(a) {
  if (a.id)   return { strategy: 'id', locator: a.id }
  if (a.desc) return { strategy: 'accessibility id', locator: a.desc }
  if (a.text) return { strategy: 'text', locator: a.text }
  return null
}

// Walk the tree (fast-xml-parser gives single child = object, repeated = array), collecting
// elements worth targeting (interactive or labelled) with their best strategy+locator.
function collect(node, out) {
  if (!node) return
  for (const n of (Array.isArray(node) ? node : [node])) {
    const a = {
      id: (n['@_resource-id'] || '').trim(),
      desc: (n['@_content-desc'] || '').trim(),
      text: (n['@_text'] || '').trim(),
      cls: (n['@_class'] || '').trim(),
      clickable: n['@_clickable'] === 'true',
      editable: (n['@_class'] || '').includes('EditText')
    }
    const loc = bestLocator(a)
    if (loc && (a.clickable || a.editable || a.text || a.desc)) {
      const clsShort = a.cls.split('.').pop() || a.cls
      out.push({
        label: a.text || a.desc || (a.id.split('/').pop() || clsShort),
        cls: clsShort,
        clickable: a.clickable,
        editable: a.editable,
        ...loc
      })
    }
    if (n.node) collect(n.node, out)
  }
}

export function parseUiDump(xml) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
  const tree = parser.parse(xml)
  const out = []
  collect(tree?.hierarchy?.node, out)
  return out
}
