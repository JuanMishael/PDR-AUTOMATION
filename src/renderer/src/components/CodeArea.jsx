import { useMemo, useRef } from 'react'

/**
 * Shared code editor: a transparent <textarea> layered over a highlighted <pre>. Both share
 * identical type metrics and scroll together, so you type plain text and see it colored.
 *
 * ponytail: regex tinting, no parser and no highlighter dependency. It can mis-color pathological
 * input (a `/*` inside a string), which costs nothing but a wrong color — swap in a real lexer
 * only if that ever matters.
 */

// One alternation pass per language so an inserted <span> can't be re-matched by a later rule
// (a keyword inside a string stays a string). Escaping runs first, and only touches & < >, so
// quotes and backticks are still literal here.
const JS_RE = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)|\b(await|async|const|let|var|function|return|if|else|for|while|do|new|try|catch|finally|throw|typeof|instanceof|delete|of|in|true|false|null|undefined|this)\b|\b(\d+(?:\.\d+)?)\b/g

export function highlightCode(code, kind) {
  let h = String(code).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  if (kind === 'js') {
    h = h.replace(JS_RE, (m, com, str, kw, num) =>
      com ? `<span class="tk-com">${com}</span>`
      : str ? `<span class="tk-str">${str}</span>`
      : kw  ? `<span class="tk-kw">${kw}</span>`
      :       `<span class="tk-num">${num}</span>`)
  } else if (kind === 'json') {
    h = h.replace(/("(?:\\.|[^"\\])*")/g, '<span class="tk-str">$1</span>')
      .replace(/\b(true|false|null)\b/g, '<span class="tk-kw">$1</span>')
  } else {
    h = h.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tk-com">$1</span>')
      .replace(/(&lt;\/?(?!!--)[\s\S]*?&gt;)/g, '<span class="tk-tag">$1</span>')
  }
  // {{tokens}} last, so they stay visible even inside a string.
  return h.replace(/(\{\{[^{}]+?\}\})/g, '<span class="tk-tok">$1</span>')
}

export default function CodeArea({ value, onChange, kind = 'xml', placeholder, height = 240, taRef, children }) {
  const innerRef = useRef(null)
  const ta = taRef || innerRef
  const preRef = useRef(null)
  const html = useMemo(() => highlightCode(value || '', kind) + '\n', [value, kind])
  const shared = {
    margin: 0, padding: 10, border: 'none', fontFamily: 'var(--font-mono)', fontSize: 12,
    lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', boxSizing: 'border-box',
    position: 'absolute', inset: 0, overflow: 'auto'
  }
  const sync = () => {
    if (preRef.current && ta.current) {
      preRef.current.scrollTop = ta.current.scrollTop
      preRef.current.scrollLeft = ta.current.scrollLeft
    }
  }
  return (
    <div className="sketch" style={{ position: 'relative', height, background: 'var(--surface)' }}>
      <pre ref={preRef} aria-hidden style={{ ...shared, pointerEvents: 'none', color: 'var(--ink)' }}
        dangerouslySetInnerHTML={{ __html: html }} />
      <textarea ref={ta} value={value} placeholder={placeholder} spellCheck={false}
        onChange={e => onChange(e.target.value)} onScroll={sync}
        style={{ ...shared, color: 'transparent', background: 'transparent', caretColor: 'var(--ink)', resize: 'none' }} />
      {children}
    </div>
  )
}
