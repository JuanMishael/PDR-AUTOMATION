// wsdlImport.js — turn a WCF/SOAP service's ...svc?wsdl into a ready-to-run request collection.
//
// WCF splits its contract across many documents: the main ?wsdl holds service/binding, which
// <wsdl:import>s the portTypes/messages, which <xsd:import> the data schemas (?xsd=xsd0…). This
// module follows ALL of those, merges them, then for each operation:
//   • recurses the request element's type into nested child placeholders (with SoapUI-style
//     <!--Optional:--> hints for minOccurs=0), and
//   • emits the <soapenv:Header> block for any <soap:header> (WCF MessageContract headers like
//     ServiceHeader/token).
// Pure-JS (fast-xml-parser); no native deps. KNOWN LIMITS: assumes one target namespace for the
// tns prefix; WS-Security policy/MTOM not expanded; recursion capped at depth 8 (cyclic types).
import { XMLParser } from 'fast-xml-parser'
import { sendRequest } from './apiEngine'

const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: false, attributeNamePrefix: '@_' })
const toArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x])
const localName = (s) => { const v = String(s || ''); return v.includes(':') ? v.split(':').pop() : v }

const XSD_PRIMITIVES = new Set(['string', 'int', 'integer', 'long', 'short', 'byte', 'decimal', 'float',
  'double', 'boolean', 'dateTime', 'date', 'time', 'base64Binary', 'hexBinary', 'anyURI', 'QName',
  'duration', 'unsignedInt', 'unsignedLong', 'unsignedShort', 'unsignedByte', 'guid', 'char', 'anyType'])

async function fetchText(url) {
  const res = await sendRequest({ method: 'GET', url }, {}, { timeout: 20000 })
  if (res.error) throw new Error(res.error)
  return res.body || ''
}

// Recursively fetch the main WSDL + every imported WSDL/XSD, accumulating all messages, portTypes,
// bindings, services and schemas into one merged set.
async function collectDocs(url, seen, acc) {
  if (seen.has(url) || seen.size > 60) return
  seen.add(url)
  let text
  try { text = await fetchText(url) } catch { return }
  if (!text || !text.includes('<')) return
  let doc
  try { doc = parser.parse(text) } catch { return }

  const def = doc.definitions || doc.description
  if (def) {
    if (!acc.targetNs && def['@_targetNamespace']) acc.targetNs = def['@_targetNamespace']
    acc.messages.push(...toArray(def.message))
    acc.portTypes.push(...toArray(def.portType))
    acc.bindings.push(...toArray(def.binding))
    acc.services.push(...toArray(def.service))
    for (const types of toArray(def.types))
      for (const schema of toArray(types.schema)) await addSchema(schema, url, seen, acc)
    for (const imp of toArray(def.import)) {
      const loc = imp['@_location']
      if (loc) await collectDocs(resolveUrl(url, loc), seen, acc)
    }
  } else if (doc.schema) {
    await addSchema(doc.schema, url, seen, acc)
  }
}

async function addSchema(schema, base, seen, acc) {
  acc.schemas.push(schema)
  for (const imp of [...toArray(schema.import), ...toArray(schema.include)]) {
    const loc = imp['@_schemaLocation']
    if (loc) await collectDocs(resolveUrl(base, loc), seen, acc)
  }
}

function resolveUrl(base, loc) {
  try { return new URL(loc, base).toString() } catch { return loc }
}

// Build name→node registries across every merged schema.
function buildRegistry(schemas) {
  const elements = {}, types = {}
  for (const schema of schemas) {
    for (const el of toArray(schema.element)) if (el['@_name']) elements[el['@_name']] = el
    for (const ct of toArray(schema.complexType)) if (ct['@_name']) types[ct['@_name']] = ct
  }
  return { elements, types }
}

// ── recursive placeholder expansion ──────────────────────────────────────────
function expandElement(el, reg, ctx) {
  const name = el['@_name']
  if (!name) return []
  const lines = []
  if (el['@_minOccurs'] === '0') lines.push(`${ctx.pad}<!--Optional:-->`)
  if (/unbounded/.test(el['@_maxOccurs'] || '')) lines.push(`${ctx.pad}<!--Zero or more repetitions:-->`)

  const typeLocal = localName(el['@_type'])
  let complex = el.complexType || (typeLocal && reg.types[typeLocal]) || null
  const typeKey = typeLocal || name

  if (complex && ctx.depth < 8 && !ctx.seen.has(typeKey)) {
    const child = expandComplex(complex, reg, { ...ctx, pad: ctx.pad + '   ', depth: ctx.depth + 1, seen: new Set([...ctx.seen, typeKey]) })
    if (child.length) {
      lines.push(`${ctx.pad}<${ctx.prefix}:${name}>`)
      lines.push(...child)
      lines.push(`${ctx.pad}</${ctx.prefix}:${name}>`)
    } else {
      lines.push(`${ctx.pad}<${ctx.prefix}:${name}/>`)
    }
  } else {
    lines.push(`${ctx.pad}<${ctx.prefix}:${name}>?</${ctx.prefix}:${name}>`)
  }
  return lines
}

function expandComplex(ct, reg, ctx) {
  const lines = []
  // complexContent → extension (inheritance): emit base members then the extension's own.
  const ext = ct.complexContent && ct.complexContent.extension
  if (ext) {
    const baseLocal = localName(ext['@_base'])
    if (baseLocal && reg.types[baseLocal] && !ctx.seen.has(baseLocal))
      lines.push(...expandComplex(reg.types[baseLocal], reg, { ...ctx, seen: new Set([...ctx.seen, baseLocal]) }))
    for (const p of particleElements(ext)) lines.push(...expandElement(p, reg, ctx))
    return lines
  }
  for (const p of particleElements(ct)) lines.push(...expandElement(p, reg, ctx))
  return lines
}

function particleElements(node) {
  const seq = node.sequence || node.all || node.choice
  return seq ? toArray(seq.element) : []
}

// Expand a top-level element by name (the body wrapper or a header element).
function expandNamedElement(elName, reg, ctx) {
  const el = reg.elements[elName]
  if (!el) return [`${ctx.pad}<${ctx.prefix}:${elName}>?</${ctx.prefix}:${elName}>`]
  return expandElement(el, reg, ctx)
}

// ── public: fetch + parse + scaffold ─────────────────────────────────────────
export async function buildWsdlCollection(url) {
  const acc = { targetNs: '', messages: [], portTypes: [], bindings: [], services: [], schemas: [] }
  await collectDocs(url, new Set(), acc)
  if (!acc.portTypes.length && !acc.bindings.length) throw new Error('Not a WSDL document (no portType/binding found).')
  const reg = buildRegistry(acc.schemas)
  const tns = acc.targetNs || 'http://tempuri.org/'

  // message name → { parts: [{ name, element }] }
  const messages = {}
  for (const m of acc.messages) {
    messages[m['@_name']] = toArray(m.part).map(p => ({ name: p['@_name'], element: localName(p['@_element'] || p['@_type'] || '') }))
  }
  // portType operation → input/output message local names
  const ptOps = {}
  for (const pt of acc.portTypes)
    for (const op of toArray(pt.operation))
      if (op['@_name']) ptOps[op['@_name']] = { input: localName(op.input?.['@_message'] || '') }

  // binding operation → { soapAction, headerParts: [{message, part}] }
  const bindOps = {}
  for (const b of acc.bindings)
    for (const op of toArray(b.operation)) {
      const name = op['@_name']; if (!name) continue
      const headerParts = toArray(op.input?.header).map(h => ({ message: localName(h['@_message']), part: h['@_part'] }))
      bindOps[name] = { soapAction: op.operation?.['@_soapAction'], headerParts }
    }

  // endpoint location
  let endpoint = url.replace(/\?.*$/, '')
  outer: for (const svc of acc.services)
    for (const port of toArray(svc.port))
      if (port.address?.['@_location']) { endpoint = port.address['@_location']; break outer }

  const prefix = 'tns'
  const operations = Object.keys(ptOps).map((name) => {
    const inputMsg = ptOps[name].input
    const parts = messages[inputMsg] || []
    const bind = bindOps[name] || {}
    const headerPartNames = new Set((bind.headerParts || []).map(h => h.part))

    // Header elements (e.g. ServiceHeader).
    const headerLines = []
    for (const h of bind.headerParts || []) {
      const hp = (messages[h.message] || []).find(p => p.name === h.part)
      if (hp?.element) headerLines.push(...expandNamedElement(hp.element, reg, { prefix, pad: '      ', depth: 0, seen: new Set() }))
    }
    // Body element = first input part not consumed as a header.
    const bodyPart = parts.find(p => !headerPartNames.has(p.name)) || parts[0]
    const bodyLines = bodyPart?.element
      ? expandNamedElement(bodyPart.element, reg, { prefix, pad: '      ', depth: 0, seen: new Set() })
      : [`      <${prefix}:${name}/>`]

    const action = bind.soapAction != null ? bind.soapAction : `${String(tns).replace(/\/$/, '')}/${name}`
    return { name, soapAction: action, envelope: buildEnvelope(tns, prefix, headerLines, bodyLines) }
  })

  return { endpoint, targetNs: tns, operations }
}

function buildEnvelope(ns, prefix, headerLines, bodyLines) {
  const header = headerLines.length
    ? `\n  <soapenv:Header>\n${headerLines.join('\n')}\n  </soapenv:Header>`
    : ''
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:${prefix}="${ns}">${header}
  <soapenv:Body>
${bodyLines.join('\n')}
  </soapenv:Body>
</soapenv:Envelope>`
}
