import { useRef, useState, useEffect, useMemo } from 'react'
import { Icon } from '../components/SketchDefs'
import { ACTION_CATEGORIES, ACTIONS_BY_CATEGORY } from '../components/actionDefs'
import { TOKEN_GROUPS } from '../lib/tokens'

// In-app user manual. Everything a (non-technical) QA needs to know about the
// app lives here: what it is, the workflow, every feature, the step catalog,
// tokens, use cases, and troubleshooting. Pure content — no app state touched.

const SECTIONS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'quickstart',  label: 'Quick Start' },
  { id: 'concepts',    label: 'Core Concepts' },
  { id: 'profiles',    label: 'Profiles' },
  { id: 'api',         label: 'API Profiles ·β' },
  { id: 'scenarios',   label: 'Scenarios & Steps' },
  { id: 'recorder',    label: 'Recorder & Picker' },
  { id: 'uploads',     label: 'File Uploads' },
  { id: 'testdata',    label: 'Test Data' },
  { id: 'tokens',      label: 'Tokens' },
  { id: 'running',     label: 'Running & Results' },
  { id: 'sharing',     label: 'Sharing' },
  { id: 'actions',     label: 'Step Reference' },
  { id: 'usecases',    label: 'Use Cases' },
  { id: 'faqs',        label: 'FAQ' },
  { id: 'faq',         label: 'Troubleshooting' },
  { id: 'settings',    label: 'Settings' }
]

// Small inline helpers so the prose stays readable below.
const Code = ({ children }) => <code style={{ fontSize: 12 }}>{children}</code>
const Kbd = ({ children }) => (
  <span style={{
    fontFamily: 'var(--font-mono)', fontSize: 11, padding: '1px 6px', borderRadius: 5,
    background: 'var(--surface-2)', border: '1.5px solid var(--line-soft)', color: 'var(--ink-soft)'
  }}>{children}</span>
)

const Beta = () => (
  <span className="badge badge-warn" style={{ fontSize: 10, marginLeft: 8, verticalAlign: 'middle' }}>BETA</span>
)

function Section({ id, title, subtitle, refMap, children }) {
  return (
    <section ref={el => { refMap.current[id] = el }} style={{ scrollMarginTop: 12, marginBottom: 30 }}>
      <h2 style={{ fontFamily: 'var(--font-hand)', fontSize: 23, color: 'var(--ink)', marginBottom: subtitle ? 2 : 12 }}>
        {title}
      </h2>
      {subtitle && <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '0 0 14px' }}>{subtitle}</p>}
      {children}
    </section>
  )
}

// A labelled definition row used across several sections.
function Define({ term, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 12, marginBottom: 10 }}>
      <div style={{ fontFamily: 'var(--font-hand)', fontSize: 16, color: 'var(--ink)' }}>{term}</div>
      <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.55 }}>{children}</div>
    </div>
  )
}

// A question + answer block for the FAQ section.
function Faq({ q, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontFamily: 'var(--font-hand)', fontSize: 16, color: 'var(--accent-ink)', flexShrink: 0 }}>Q</span>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{q}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'var(--font-hand)', fontSize: 16, color: 'var(--ink-faint)', flexShrink: 0 }}>A</span>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>{children}</div>
      </div>
    </div>
  )
}

function Step({ n, title, children }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
      <div style={{
        width: 26, height: 26, flexShrink: 0, borderRadius: '50%',
        background: 'var(--accent-soft)', border: '2px solid var(--accent)', color: 'var(--accent-ink)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-hand)', fontSize: 15
      }}>{n}</div>
      <div style={{ paddingTop: 2 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.55 }}>{children}</div>
      </div>
    </div>
  )
}

export default function Help() {
  const refMap = useRef({})
  const [active, setActive] = useState('overview')
  const [query, setQuery] = useState('')
  // Lowercased full text of each section, built once after mount so search can
  // match anything on the page (titles, prose, the step catalog) — not just labels.
  const [textIndex, setTextIndex] = useState({})

  const q = query.trim().toLowerCase()

  useEffect(() => {
    const idx = {}
    for (const s of SECTIONS) {
      const el = refMap.current[s.id]
      idx[s.id] = `${s.label} ${el?.textContent || ''}`.toLowerCase()
    }
    setTextIndex(idx)
  }, [])

  const matchedIds = useMemo(() => {
    if (!q) return SECTIONS.map(s => s.id)
    return SECTIONS.filter(s => (textIndex[s.id] || '').includes(q)).map(s => s.id)
  }, [q, textIndex])

  // Show only matching sections while searching. We toggle display directly on the
  // (React-owned) <section> elements: display isn't in their style prop, so React's
  // reconciler leaves our value untouched across re-renders.
  useEffect(() => {
    const keep = new Set(matchedIds)
    for (const s of SECTIONS) {
      const el = refMap.current[s.id]
      if (el) el.style.display = keep.has(s.id) ? '' : 'none'
    }
  }, [matchedIds])

  // Highlight matches without mutating the DOM (safe with React) via the CSS
  // Custom Highlight API. Falls back to plain filtering where it's unavailable.
  useEffect(() => {
    if (typeof CSS === 'undefined' || !CSS.highlights) return
    CSS.highlights.delete('help-search')
    if (!q) return
    const ranges = []
    for (const id of matchedIds) {
      const root = refMap.current[id]
      if (!root) continue
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        const text = node.nodeValue.toLowerCase()
        let i = text.indexOf(q)
        while (i !== -1) {
          const range = new Range()
          range.setStart(node, i)
          range.setEnd(node, i + q.length)
          ranges.push(range)
          i = text.indexOf(q, i + q.length)
        }
      }
    }
    if (ranges.length) CSS.highlights.set('help-search', new Highlight(...ranges))
    return () => { if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.delete('help-search') }
  }, [q, matchedIds, textIndex])

  // Jump to the first match when a search narrows the page.
  useEffect(() => {
    if (q && matchedIds[0]) refMap.current[matchedIds[0]]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  // Highlight the TOC entry whose section is currently nearest the top (idle only).
  useEffect(() => {
    const main = document.querySelector('main')
    if (!main) return
    function onScroll() {
      if (q) return
      let current = SECTIONS[0].id
      for (const s of SECTIONS) {
        const el = refMap.current[s.id]
        if (el && el.getBoundingClientRect().top <= 120) current = s.id
      }
      setActive(current)
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => main.removeEventListener('scroll', onScroll)
  }, [q])

  function go(id) {
    refMap.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const noResults = q && matchedIds.length === 0
  const tocSections = q ? SECTIONS.filter(s => matchedIds.includes(s.id)) : SECTIONS

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1>Help &amp; Documentation</h1>
        <p>Everything about the app — concepts, features, the step catalog, and answers to common questions.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 28, alignItems: 'start' }}>
        {/* Sticky table of contents + search */}
        <nav style={{ position: 'sticky', top: 0, alignSelf: 'start' }}>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setQuery('') }}
              placeholder="🔍 Search help…"
              style={{ width: '100%', fontSize: 13, paddingRight: query ? 26 : undefined }} />
            {query && (
              <button onClick={() => setQuery('')} title="Clear (Esc)"
                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>
                ×
              </button>
            )}
          </div>
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            {q ? `${matchedIds.length} match${matchedIds.length === 1 ? '' : 'es'}` : 'Contents'}
          </div>
          <div style={{ display: 'grid', gap: 2 }}>
            {tocSections.map(s => {
              const on = !q && active === s.id
              return (
                <button key={s.id} onClick={() => go(s.id)}
                  style={{
                    textAlign: 'left', padding: '6px 10px', borderRadius: 8, border: '2px solid transparent',
                    background: on ? 'var(--accent-soft)' : 'transparent',
                    color: on ? 'var(--accent-ink)' : 'var(--ink-soft)',
                    borderColor: on ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'transparent',
                    fontFamily: 'var(--font-hand)', fontSize: 15, cursor: 'pointer'
                  }}>
                  {s.label}
                </button>
              )
            })}
          </div>
        </nav>

        {/* Content */}
        <div style={{ maxWidth: 720 }}>
          {noResults && (
            <div className="card empty-state" style={{ padding: 40 }}>
              <div className="empty-icon"><Icon name="help" size={34} /></div>
              <p style={{ margin: 0 }}>No help topics match “{query.trim()}”.</p>
              <button className="btn-ghost" style={{ marginTop: 14 }} onClick={() => setQuery('')}>Clear search</button>
            </div>
          )}
          <Section id="overview" title="What is this app?" refMap={refMap}
            subtitle="A no-code automated testing tool built for QA.">
            <div className="card" style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.6, margin: 0 }}>
                This app lets you build, run, and share automated browser tests <strong>without writing code</strong>.
                You describe a test as a list of plain-English <strong>steps</strong> ("click Login", "fill Email",
                "assert Welcome is visible"), and the app drives a real browser through them using Playwright —
                the same engine professional test teams rely on.
              </p>
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
              The guiding idea is <em>"demonstrate, don't declare."</em> Instead of describing what should happen
              in a document, you record or build the actual clicks and checks, then replay them any time to prove
              the app still works. Tests are organized under <strong>profiles</strong> (one per app/environment),
              hold reusable <strong>test data</strong>, and produce shareable pass/fail <strong>reports</strong> with
              screenshots and traces on failure.
            </p>
          </Section>

          <Section id="quickstart" title="Quick Start" refMap={refMap}
            subtitle="From zero to your first passing test in five steps.">
            <div className="card">
              <Step n="1" title="Create a Profile">
                Go to <strong>Profiles → New Profile</strong>. Give it a name and the Base URL of the app you're
                testing (e.g. a staging site). Pick a browser. This is your test target.
              </Step>
              <Step n="2" title="Add a Scenario">
                Open <strong>Scenarios</strong> for that profile and create a scenario — one user journey, like
                "Log in" or "Submit a request".
              </Step>
              <Step n="3" title="Build steps (or record them)">
                Add steps from the action palette, or click <strong>Record</strong> to open the app and capture your
                clicks and typing as steps automatically. Use the <strong>🎯 Pick</strong> button to grab a reliable
                selector for any element.
              </Step>
              <Step n="4" title="Run it">
                Hit <strong>Run</strong>. The browser opens and walks through your steps. Green = passed, red = failed.
              </Step>
              <Step n="5" title="Read the report">
                Open <strong>Results</strong> / <strong>History</strong> to see what passed, screenshots of failures,
                and a Playwright trace you can step through.
              </Step>
            </div>
          </Section>

          <Section id="concepts" title="Core Concepts" refMap={refMap}
            subtitle="The four building blocks, top to bottom.">
            <div className="card">
              <Define term="Profile">A test target — one app/environment with its Base URL, browser, and timeout. Everything else lives under a profile.</Define>
              <Define term="Scenario">One test journey under a profile (e.g. "Login", "Create customer"). Contains an ordered list of steps.</Define>
              <Define term="Step">A single action or check — click, fill, navigate, assert, wait, etc. Steps run top to bottom.</Define>
              <Define term="Test Data">Reusable input values (a "collection" of fields + data sets) you reference in steps with tokens, so one scenario can run against many inputs.</Define>
            </div>
          </Section>

          <Section id="profiles" title="Profiles" refMap={refMap}
            subtitle="Profiles → New Profile">
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
              A profile bundles a test target's settings and all its scenarios. Fields:
            </p>
            <div className="card">
              <Define term="Name">A friendly label, shown on the Dashboard (e.g. "PPGIS Staging").</Define>
              <Define term="Base URL">The site under test. Navigate steps can use relative paths (<Code>/login</Code>) that resolve against this.</Define>
              <Define term="Browser">Chromium, Firefox, or WebKit — the engine the test runs in.</Define>
              <Define term="Step Timeout">How long each step waits for an element before failing (ms).</Define>
              <Define term="Headless">Run without a visible browser window (faster; good for re-runs once a test is stable).</Define>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', marginTop: 12 }}>
              Tip: the Dashboard floats your most-recently-run profile to the top and shows a streak of the last few runs.
            </p>
          </Section>

          <Section id="api" title={<>API Profiles <Beta /></>} refMap={refMap}
            subtitle="Test SOAP / REST APIs as a request collection — like Postman or SoapUI, with token automation.">
            <div className="card" style={{ marginBottom: 14, borderColor: 'var(--warn-line)', background: 'var(--warn-bg)' }}>
              <p style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6, margin: 0 }}>
                <strong>API Profiles are in beta.</strong> The core flow — build requests, send, extract values,
                chain a token, import a WSDL, run a collection — works, but it's still being built out and details
                may change. SOAP-fault token auto-refresh and API-shaped report formatting aren't done yet.
              </p>
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
              An <strong>API profile</strong> swaps the browser step-cards for a request workspace. Create one in
              <strong> Profiles → New Profile</strong> and pick <strong>🔌 API</strong> as the type. Then:
            </p>
            <div className="card" style={{ marginBottom: 12 }}>
              <Define term="Requests">Build requests on the left (method + URL + Body/Headers/Params). Hit <strong>▶ Send</strong> to try one and see the response. Both REST (JSON) and SOAP (XML) are supported.</Define>
              <Define term="Variables">A profile-wide store. Reference any variable anywhere with <Code>{'{{name}}'}</Code> (URL, headers, body). Values you extract are saved here and reused by the next request — even across separate Sends.</Define>
              <Define term="Test data">Requests read the shared <strong>Test Data Library</strong>: the body holds <Code>{'{{Collection.field}}'}</Code> placeholders (auto-wired), and the actual values — including <Code>{'{{faker.*}}'}</Code> / <Code>{'{{unique.*}}'}</Code> — go in the data rows on the Data tab, where the <Code>{'{ }'}</Code> picker inserts a token into the selected cell. The body editor is syntax-highlighted. <strong>▶ Send</strong> resolves against the data row you pick (first row by default); <strong>Run collection</strong> runs every row.</Define>
              <Define term="Iterate (data-driven)">On a request's <strong>Data</strong> tab, bind a collection + group (positive / negative / edge) and it runs <strong>once per data set</strong> during Run collection — each row re-resolving its tokens, results labelled by set name. The API analog of a repeating group. You can <strong>add and edit the data rows inline</strong> on the Data tab — no trip to the Test Data page.</Define>
              <Define term="Header boilerplate">For SOAP, the Data tab's <strong>🧩 Auto-fill SOAP header</strong> tokenizes the <Code>ServiceHeader</Code> so you never hand-edit the envelope: timestamps/IDs auto-generate (<Code>{'{{unique.*}}'}</Code>), the auth token uses <Code>{'{{Token}}'}</Code>, and constants like <Code>requestedChannel</Code> become profile <strong>Variables</strong> you set once.</Define>
              <Define term="Auto-create data">The Data tab's <strong>✨ Create collection from request fields</strong> reads the request's own input fields (the SOAP body elements, or JSON keys), builds a matching Test Data collection, wires the body to <Code>{'{{tokens}}'}</Code>, and binds iteration — so you go from an imported request to a data-driven test case in one click. Then just fill the rows.</Define>
              <Define term="Extract">After a Send, the response <strong>Body</strong> shows as a 🌲 <strong>Tree</strong>. Click any value → name it → it's saved into a variable. No need to hand-type a path.</Define>
              <Define term="Auth & token">Designate one request as the token call. The token is injected into the others automatically, and (for REST) silently re-fetched + retried on a <Code>401</Code>.</Define>
              <Define term="Import WSDL">Paste a WCF/SOAP service's <Code>?wsdl</Code> URL. It follows the imported schemas and scaffolds one request per operation — full SOAP envelope, <Code>SOAPAction</Code>, and the <Code>ServiceHeader</Code> block included.</Define>
              <Define term="Run collection">Runs every request in order through the shared variables, streaming pass/fail and saving a run to <strong>History</strong>.</Define>
            </div>
            <div style={{ fontFamily: 'var(--font-hand)', fontSize: 17, color: 'var(--ink)', margin: '4px 0 6px' }}>The token flow, end to end</div>
            <div className="card">
              <Step n="1" title="Get the token request returning a token">
                Build (or WSDL-import) your auth request — e.g. <Code>genToken</Code> — fill any credentials, and Send.
              </Step>
              <Step n="2" title="Extract the token into a variable">
                In the response Tree, click the token value, name it (e.g. <Code>Token</Code>), Add. Send once more and
                watch the <strong>Variables</strong> panel fill in.
              </Step>
              <Step n="3" title="Use it in the other requests">
                Drop <Code>{'{{Token}}'}</Code> wherever the API wants it — an <Code>Authorization</Code> header for REST,
                or inside the SOAP <Code>ServiceHeader/token</Code> element for WCF. Every request now pulls the live token.
              </Step>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', marginTop: 12 }}>
              Note for SOAP: variable names are case-sensitive (<Code>{'{{Token}}'}</Code> ≠ <Code>{'{{token}}'}</Code>),
              and an expired token usually comes back as a SOAP <em>Fault</em> (HTTP 200), so re-send the token request to
              refresh it for now.
            </p>
          </Section>

          <Section id="scenarios" title="Scenarios & Steps" refMap={refMap}
            subtitle="Scenarios — where the test gets built.">
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
              Add steps from the action palette (grouped by category) and reorder them by dragging. Each step has a
              selector (which element) and parameters (what to do). Useful step features:
            </p>
            <div className="card">
              <Define term="Keyword">Each step shows a Given / When / Then keyword for readability. Click it to cycle.</Define>
              <Define term="Skip ⊘">Keep a step but exclude it from runs. Works on whole groups too.</Define>
              <Define term="Screenshot 📷">Force a screenshot after a step, even when it passes.</Define>
              <Define term="Alt selector">A fallback selector — if the primary can't be found, the app tries this one (<Code>.or()</Code>).</Define>
              <Define term="Groups ⊞">Wrap a range of steps in a named, collapsible block. A group can repeat once per data set (see Test Data).</Define>
              <Define term="Comment">A free-text note for human readers. Does nothing at run time.</Define>
              <Define term="Bulk select">Tick multiple steps to move, copy to another scenario, or group them at once.</Define>
              <Define term="Lock 🔒">Make a finished scenario read-only so its steps can't be changed by accident. While locked, you can't add, edit, reorder, delete or record steps — but the scenario still runs normally. Toggle it with the <strong>🔒 Lock / 🔓 Unlock</strong> button in the scenario header, or from a scenario's <strong>⋯</strong> menu.</Define>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', marginTop: 12 }}>
              See the full <button onClick={() => go('actions')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent-ink)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>Step Reference</button> below for every available action.
            </p>
          </Section>

          <Section id="recorder" title="Recorder & Picker" refMap={refMap}
            subtitle="Build tests by doing, not by typing selectors.">
            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ fontFamily: 'var(--font-hand)', fontSize: 18, color: 'var(--ink)', marginBottom: 6 }}>🔴 Recorder</div>
              <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6, margin: 0 }}>
                Click <strong>Record</strong> to open the app in a real browser. Your clicks, typing, and navigation are
                captured as steps automatically. When you pause on a screen that's still loading, the recorder can
                suggest a <strong>smart wait</strong> so the replay isn't flaky. Stop recording and the steps drop
                into your scenario, ready to tidy up.
              </p>
            </div>
            <div className="card">
              <div style={{ fontFamily: 'var(--font-hand)', fontSize: 18, color: 'var(--ink)', marginBottom: 6 }}>🎯 Picker</div>
              <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6, margin: 0 }}>
                On any step (or test-data field), click <strong>🎯 Pick</strong> to open the page and click the element
                you mean. The app captures a robust selector for you — no need to know CSS. You can optionally run the
                preceding steps first so the element you want is actually on screen.
              </p>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', marginTop: 12 }}>
              The picker/recorder browser remembers your login between sessions. Clear it from <strong>Settings → Browser Session</strong>.
            </p>
          </Section>

          <Section id="uploads" title="File Uploads" refMap={refMap}
            subtitle="Automating an Upload / Browse button that opens a file dialog.">
            <div className="card" style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.6, margin: 0 }}>
                Most upload buttons (a <strong>Browse</strong> / <strong>Upload</strong> button next to a read-only
                "Select a file" box) open the <strong>operating system's file dialog</strong>. That dialog lives
                <em> outside</em> the browser, so automation can't click around in it — and the recorder can't capture
                it either. <strong>Don't try to automate the button click.</strong>
              </p>
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
              Good news: the <strong>Upload File</strong> step is smart about this, so you usually don't have to think
              about the hidden input at all. It figures out the right target for you:
            </p>
            <div className="card" style={{ marginBottom: 12 }}>
              <Step n="1" title="Add an Upload File step + set the file path">
                Most of the time that's it. If the page has a single file input (even a hidden one), the step finds and
                uses it automatically — leave the selector blank.
              </Step>
              <Step n="2" title="If the page has several uploads — name the button">
                Put the visible Upload/Browse button in the <strong>Upload button…</strong> field (e.g.
                <Code>#BIMSBUfileUpload</Code>). The step clicks it and catches the file dialog it opens — you can even
                🎯 Pick that button since it's visible.
              </Step>
              <Step n="3" title="(Advanced) Point straight at the file input">
                If you know it, put the hidden <Code>{'<input type="file">'}</Code>'s selector (e.g.
                <Code>#BIMSBUuploadhidden</Code>) in <strong>File input selector</strong>. The file is set directly.
              </Step>
              <Step n="4" title="(Optional) Assert it registered">
                Add an <strong>Assert Input Value</strong> on the read-only display box (e.g. <Code>#BIMSBUfileDisplay</Code>)
                to confirm the filename appears, then a Click on the submit button (e.g. <strong>BULK UPLOAD</strong>).
              </Step>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-faint)' }}>
              One thing to avoid: don't rely on the read-only display box (<Code>{'<input type="text" readonly>'}</Code>)
              as the target by itself — it isn't a file input. The step will still try to recover (it falls back to the
              page's lone file input), but naming the Upload button is the reliable choice when several uploads exist.
            </p>
          </Section>

          <Section id="testdata" title="Test Data" refMap={refMap}
            subtitle="Define a form once; run it against many inputs.">
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
              A <strong>collection</strong> describes a form or entity as a set of <strong>fields</strong> (name, type,
              optional default, and a selector for where it fills). <strong>Data sets</strong> are rows of values for
              those fields, grouped by intent:
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              <span className="badge badge-ok"><span className="dot" />📗 Positive — valid, happy-path inputs</span>
              <span className="badge badge-bad"><span className="dot" />📕 Negative — invalid inputs that should be rejected</span>
              <span className="badge badge-warn"><span className="dot" />📒 Edge — boundary / unusual inputs</span>
            </div>
            <div className="card">
              <Define term="Reference">Use a value in any step with <Code>{'{{Collection.field}}'}</Code> — e.g. <Code>{'{{Customer.email}}'}</Code>.</Define>
              <Define term="Fill form ▦">If fields have selectors, drop the whole form into a scenario in one click.</Define>
              <Define term="Repeat group">Point a repeating group at a collection + group to run its steps once per data set.</Define>
              <Define term="Import">Paste comma/tab-separated rows straight from Excel or Sheets — add an <Code>intent</Code> column to tag rows.</Define>
              <Define term="Export">Share a full collection (.json) or just the data rows (.csv).</Define>
            </div>
          </Section>

          <Section id="tokens" title="Tokens" refMap={refMap}
            subtitle="Dynamic values you can drop into any step or default.">
            <div className="card">
              <Define term={<Code>{'{{Collection.field}}'}</Code>}>A value from a test-data set, e.g. <Code>{'{{Login.username}}'}</Code>.</Define>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 14, marginBottom: 8 }}>
              You don't have to memorize any of these — click the <Kbd>{'{ }'}</Kbd> button beside any value box
              (in a step or in Test Data) to search and insert one. The full menu:
            </p>
            {TOKEN_GROUPS.map(g => (
              <div key={g.name} className="card" style={{ marginBottom: 10 }}>
                <div style={{ fontFamily: 'var(--font-hand)', fontSize: 17, color: 'var(--ink)' }}>{g.name}</div>
                {g.hint && <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 8 }}>{g.hint}</div>}
                {g.tokens.map(t => (
                  <Define key={t.token} term={<Code>{t.token}</Code>}>{t.desc}</Define>
                ))}
              </div>
            ))}
            <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', marginTop: 4 }}>
              <strong>faker</strong> gives realistic random data; <strong>unique</strong> guarantees a value won't
              collide between runs. Any other <Code>{'{{faker.*}}'}</Code> path from the
              {' '}<a href="https://fakerjs.dev/api/" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-ink)' }}>Faker catalog</a> also works.
            </p>
          </Section>

          <Section id="running" title="Running & Results" refMap={refMap}
            subtitle="Run one scenario or the whole suite, then read the report.">
            <div className="card">
              <Define term="Run one">Run a single scenario in a fresh browser (its "Run needs" prerequisite runs first).</Define>
              <Define term="Run All">Run every scenario in order in one continuous browser session — state (like login) carries over.</Define>
              <Define term="Live view">Watch the active run step through, with pass/fail marked as it goes.</Define>
              <Define term="Results">Per-step outcomes, error messages, screenshots on failure, and a Playwright trace.</Define>
              <Define term="History">Every past run, newest first. Click any run to reopen its full report.</Define>
              <Define term="Retention">Old runs are pruned after the History Retention window set in Settings.</Define>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', marginTop: 12 }}>
              Failure screenshots and traces are controlled per app in <strong>Settings</strong>. The trace opens in
              Playwright's Trace Viewer — a step-by-step timeline of the run.
            </p>
          </Section>

          <Section id="sharing" title="Sharing" refMap={refMap}
            subtitle="Hand a complete test to another QA.">
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
              Use <strong>Share / Export</strong> on a profile to save a <Code>.json</Code> file containing the profile,
              all its scenarios and steps, and the test data they reference. Another tester imports it from the
              <strong> Dashboard → Import Profile</strong> and has an identical, runnable test — no setup. Collections
              can be exported and imported on their own the same way.
            </p>
          </Section>

          <Section id="actions" title="Step Reference" refMap={refMap}
            subtitle="Every action available in the palette, by category.">
            {ACTION_CATEGORIES.map(cat => {
              const actions = ACTIONS_BY_CATEGORY[cat] || []
              if (!actions.length) return null
              return (
                <div key={cat} className="card" style={{ marginBottom: 12 }}>
                  <div className="eyebrow" style={{ marginBottom: 10 }}>{cat}</div>
                  <div style={{ display: 'grid', gap: 7 }}>
                    {actions.map(a => (
                      <div key={a.key} style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12, alignItems: 'baseline' }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{a.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontFamily: 'var(--font-mono)' }}>
                          {a.params.length ? a.params.map(p => p.label).join(' · ') : 'no parameters'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </Section>

          <Section id="usecases" title="Use Cases" refMap={refMap}
            subtitle="A few ways teams use the app day to day.">
            <div className="card">
              <Define term="Smoke tests">A handful of scenarios that prove the critical paths (login, search, submit) still work after every deploy.</Define>
              <Define term="Regression">Build up a suite over time so old bugs can't quietly come back. Run All before each release.</Define>
              <Define term="Data-driven">One scenario + many data sets (positive/negative/edge) covers dozens of input combinations via a repeating group.</Define>
              <Define term="Multi-environment">Clone a profile for staging vs. pre-prod; same scenarios, different Base URL.</Define>
              <Define term="Bug repro">Record the exact clicks that trigger a bug and hand the profile to a developer to replay.</Define>
            </div>
          </Section>

          <Section id="faqs" title="FAQ" refMap={refMap}
            subtitle="Quick answers to the questions testers ask most.">
            <div className="card">
              <Faq q="How do I automate a file upload?">
                Don't click the Browse/Upload button — it opens an OS dialog automation can't drive. Use the
                <strong> Upload File</strong> step pointed at the hidden file input instead. Full walkthrough in{' '}
                <button onClick={() => go('uploads')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent-ink)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>File Uploads</button>.
              </Faq>
              <Faq q="Can one test cover many different inputs?">
                Yes — that's what <strong>Test Data</strong> is for. Define the form once, add data sets
                (positive / negative / edge), and wrap the steps in a <strong>repeating group</strong> pointed at that
                collection. The group runs once per data set, each with its own values.
              </Faq>
              <Faq q="How do I loop through a whole collection of test data?">
                Use a <strong>repeating group</strong>. There's no separate "loop" step — a group set to repeat
                <em> is</em> the loop. To set one up:
                <ol style={{ margin: '8px 0 4px', paddingLeft: 18, display: 'grid', gap: 5 }}>
                  <li>In <strong>Test Data</strong>, build a collection with your fields and add the data sets you want to run through (tag them positive / negative / edge).</li>
                  <li>In the scenario, write the steps once using tokens for the values — e.g. fill <Code>{'{{Login.username}}'}</Code> and <Code>{'{{Login.password}}'}</Code>, then click submit.</li>
                  <li>Select those steps and click <strong>⊞ Group</strong> to wrap them.</li>
                  <li>On the group, turn on <strong>Repeat for each data set</strong>, then pick the <strong>Collection</strong> and which <strong>group</strong> of sets to use (positive, negative, edge, or <Code>all</Code>).</li>
                </ol>
                When you run it, the group's steps repeat once per data set — each pass re-resolving the
                <Code>{'{{...}}'}</Code> tokens to that set's values. So 5 data sets = the form submitted 5 times,
                each with different inputs. Combine with <Code>{'{{unique.*}}'}</Code> tokens for fields that must be
                unique every pass. See <button onClick={() => go('testdata')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent-ink)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>Test Data</button>.
              </Faq>
              <Faq q="The app changed and my selector broke — what do I do?">
                Re-grab it with the <strong>🎯 Pick</strong> button on the step, or add an <strong>Alt selector</strong>
                as a fallback. If a whole flow shifted, the recorder can re-capture the affected steps.
              </Faq>
              <Faq q="Can I send a complete test to another tester?">
                Yes. <strong>Share / Export</strong> a profile to a <Code>.json</Code> file that bundles the profile,
                every scenario and step, and the test data they use. They import it from the Dashboard and have an
                identical, runnable test — no setup. See <button onClick={() => go('sharing')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent-ink)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>Sharing</button>.
              </Faq>
              <Faq q="Will running a test create real data in the app?">
                Yes — it drives the real site, so a "create" scenario makes a real record. Use a staging/test
                environment, and lean on <Code>{'{{unique.*}}'}</Code> tokens so repeated runs don't collide.
              </Faq>
              <Faq q="Why does my test pass sometimes and fail other times?">
                Usually timing — a step runs before the page finishes loading. Add a <strong>Wait for Element</strong>
                or <strong>Network Idle</strong> where content loads; the recorder suggests these smart waits when you
                pause. More fixes in <button onClick={() => go('faq')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent-ink)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>Troubleshooting</button>.
              </Faq>
              <Faq q="Can I run without the browser window popping up?">
                Yes — turn on <strong>Headless</strong> on the profile (or as the app default in Settings). It's faster
                and good for re-running stable tests; keep it off while you're still building so you can watch.
              </Faq>
            </div>
          </Section>

          <Section id="faq" title="Troubleshooting" refMap={refMap}
            subtitle="Common snags and how to clear them.">
            <div className="card">
              <Define term="Step times out">The element wasn't found in time. Re-pick the selector, add an Alt selector, or insert a Wait for Element before it. Increase the profile's Step Timeout if the app is just slow.</Define>
              <Define term="Flaky on replay">Add a smart wait (Wait for Element / Network Idle) where the page loads content. The recorder suggests these automatically when you pause.</Define>
              <Define term="Click does nothing">Try <strong>Force click</strong> or <strong>Dispatch DOM event</strong> on the step for stubborn JS toggles or hidden menus.</Define>
              <Define term="Asked to log in again">The saved browser session was cleared, or expired. Just sign in once during the next pick/record — it'll be remembered again.</Define>
              <Define term="Browser missing">Run the <strong>Health Check</strong> page to verify Playwright and its browsers are installed.</Define>
              <Define term="Upload won't record">The Browse/Upload button opens the OS file dialog, which can't be recorded. Use the <strong>Upload File</strong> step pointed at the hidden file input instead — see <button onClick={() => go('uploads')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent-ink)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>File Uploads</button>.</Define>
            </div>
          </Section>

          <Section id="settings" title="Settings Reference" refMap={refMap}
            subtitle="App-wide defaults — found just above this page.">
            <div className="card">
              <Define term="App Name">The wordmark shown in the sidebar.</Define>
              <Define term="Default Browser">Used when a profile doesn't specify one.</Define>
              <Define term="Default Timeout">Fallback step timeout (ms) for new profiles.</Define>
              <Define term="History Retention">How many days of run history to keep before pruning.</Define>
              <Define term="Run headless">Whether new runs default to no visible window.</Define>
              <Define term="Screenshot on fail">Capture a screenshot whenever a step fails.</Define>
              <Define term="Trace on fail">Record a Playwright trace on failure for the Trace Viewer.</Define>
              <Define term="Browser Session">Clear it to log the picker/recorder browser out or switch users.</Define>
            </div>
          </Section>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-faint)', fontSize: 12, marginTop: 8 }}>
            <Icon name="health" size={16} /> Pacific Data Resources — still stuck? Run a Health Check, then reach out to your QA lead.
          </div>
        </div>
      </div>
    </div>
  )
}
