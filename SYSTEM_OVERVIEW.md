# PDR-AUTOMATION — System Overview

> **What it is:** A desktop QA automation tool that lets **non-technical QA testers** build and run
> Playwright browser tests visually — no code. Built with Electron + React.

---

## 1. Mind Map (at a glance)

```
PDR-AUTOMATION (Electron desktop app)
│
├── RENDERER (React UI — what the QA tester sees)
│   ├── Dashboard            → a card per profile: scenario count, last-run status/time,
│   │                          "X/Y scenarios passed" breakdown, recent-runs streak;
│   │                          most-recently-run profile floats to top; search; per-card
│   │                          ⬆ Share a profile / ⬇ Import a shared profile bundle
│   ├── ProfileConfig        → define a "site under test" (base URL, browser, headless, timeout);
│   │                          Web vs 🔌 API profile type chooser
│   ├── ApiWorkspace (beta)   → for type='api' profiles: Postman/SoapUI-style request collection —
│   │                          requests (SOAP/REST), {{var}} store, click-to-extract response tree,
│   │                          auth/token policy, WSDL import, run collection
│   ├── ScenarioBuilder      → THE CORE: build a test visually (forks to ApiWorkspace when type='api')
│   │     ├── Step Library (left)   — 30+ actions in 8 categories (Flow: group/loop + If/Else;
│   │     │                           Variables: Capture Value + Custom Code)
│   │     ├── Scenario list (left)  — drag (⠿) to reorder; ⋯ menu = rename / duplicate / delete;
│   │     │                           filter box when there are many
│   │     ├── Canvas (right)        — collapsible step cards; drag (⠿) to reorder / into groups
│   │     ├── 🎯 Pick               — click a real element, get a selector
│   │     ├── ⊙ Test                — test a selector after replaying steps above it
│   │     ├── ● Record              — record clicks/typing (Pause/Resume + ✓ Assert mode)
│   │     ├── ⊞ Group / 🔁 loop      — group steps (nestable); flip "repeat for each data set"
│   │     │                           (the ONLY data-driven path — no top-level shortcut)
│   │     ├── 🔀 If / ⎇ Else          — conditional block: run its steps only when a live
│   │     │                           condition holds (binary — 1/0, never a third branch)
│   │     ├── 🧪 Run-against picker    — pick which data set a run uses (independent per
│   │     │                           Run All / Run scenario button); Auto = first positive
│   │     ├── ✎ Edit data inline      — edit a {{Collection.field}} token's value across all
│   │     │                           its sets in a popover, no trip to Test Data
│   │     ├── ☑ Select              — group-aware: ticking a group selects its whole block
│   │     ├── ⧉ Copy to scenario    — append selected steps into another scenario
│   │     ├── 💾 Capture / { } token — make test data from steps; insert {{Collection.field}}
│   │     ├── "Runs first"          — prerequisite for isolated single-scenario runs
│   │     └── ⧉ Duplicate / Copy    — replicate profile or scenarios to another env
│   ├── TestData             → Test Data Library: collections (form shape) + data sets
│   │                          (positive/negative/edge) + tokens; import (CSV) / export (json,csv)
│   ├── ActiveRun            → live log streaming while a test runs
│   ├── Results              → pass/fail per step, screenshots, export
│   ├── History              → past runs, status, duration, re-export
│   ├── HealthCheck          → is Node.js + Playwright browsers installed?
│   ├── ParallelRun          → fire several profiles AT ONCE, a live card per profile
│   └── Settings             → global defaults (browser, retention, screenshots,
│                              calm-playback settle toggle + settle cap)
│
├── PRELOAD (secure bridge)
│   └── window.api.*  → whitelisted IPC calls only (no direct Node in renderer)
│
└── MAIN (Node.js backend — the engine)
    ├── core/
    │   ├── db.js              → SQLite via sql.js (WASM, no native build)
    │   ├── scriptGenerator.js → turns scenarios → ONE Playwright JS script (in memory);
    │   │                        emits runtime if/else for If-blocks + self-healing locators,
    │   │                        plus __vars/__sub() so {{var.x}} resolves at RUN time
    │   ├── healChain.js       → self-healing selector chain: primary + manual Alt + auto-captured
    │   │                        fallbacks, OR'd at run time so a drifted selector still resolves
    │   ├── webRunner.js       → spawns system Node to run the generated script
    │   ├── stepReplay.js      → replays steps against a live page (picker/recorder/tester)
    │   ├── tokenResolver.js   → resolve {{Collection.field}}/{{faker.*}}/{{unique.*}} at gen-time
    │   ├── windowFocus.js     → re-assert keyboard focus after headful browser / native dialogs
    │   ├── injectedScripts.js → in-page selector generator + picker/recorder listeners
    │   ├── portability.js     → serialize/deserialize a profile bundle (scenarios + steps +
    │   │                        referenced collections); remaps ids/names/prereqs on import
    │   ├── apiEngine.js (beta)→ in-process HTTP (Node http/https, insecure TLS); {{var}} substitution,
    │   │                        JSON/XML/header/status extraction, assertions, token refetch+retry
    │   └── wsdlImport.js (beta)→ follows wsdl/xsd imports → one SOAP request per operation
    │                            (envelope + SOAPAction + ServiceHeader, recursive type expansion)
    └── ipc/
        ├── runner.js          → orchestrates runs (continuous, isolated, data-driven); expands
        │                         group/loop blocks; saves history
        ├── apiRunner.js (beta)→ api:send (interactive), api:runCollection (sequential → history),
        │                         api:importWsdl; shares the runner:log/complete stream
        ├── storage.js         → CRUD + duplicateProfile/copyScenarios + duplicate/reorder/rename
        │                         Scenarios + copySteps (append selected steps to another scenario)
        ├── dataLibrary.js     → Test Data Library CRUD + collection export/import (json/csv)
        ├── transfer.js        → share a whole profile: export/import a self-contained .json bundle
        ├── reporter.js        → export HTML / CSV / Word (.docx) w/ screenshots
        ├── health.js          → verify Node + browser install
        ├── selectorTester.js  → check selector match (optionally after replaying steps)
        ├── elementPicker.js   → headful browser, click an element → robust selector
        └── recorder.js        → headful browser, stream recorded actions → step cards
```

---

## 2. Core Concept — the data hierarchy

```
Profile  (a site/app under test: base URL + browser config)
  └── Scenario  (one test case: "Login flow")
        ├── prerequisite_id → another scenario to run first (isolated runs only)
        ├── skipped → excluded from Run All when set (single-scenario run still runs it)
        └── Step  (one action: Navigate, Fill, Click, Assert…)
              └── params (JSON: selector, value, waits, etc.)
                  └── may contain {{Collection.field}} / {{faker.*}} / {{unique.*}} tokens
        └── groupStart…groupEnd  (markers wrapping a step range into a named, nestable group;
              a group can "repeat for each data set" → it becomes a data-driven loop)
        └── ifStart…[elseStart]…ifEnd  (a conditional block: its body runs only when the
              condition holds at run time; an optional Else branch runs otherwise. Binary —
              evaluated live, NOT statically unrolled like a data-set loop)

Test Data Library (separate, global — shared across profiles)
  └── Collection  (a form's shape: "Login")
        ├── Field   (name, type, default_token, selector)   ← {{Login.username}}
        └── Data Set  (a row of values, grouped positive / negative / edge)

History  (a record of each run: overall status, duration, steps passed/failed,
          PER-SCENARIO passed/failed + a scenario_results breakdown, logs)
Custom Steps  (user-defined reusable action templates — extensibility hook)
```

A tester builds **Steps** into a **Scenario** under a **Profile**, then hits Run.
Profiles and scenarios can be **replicated** to another environment (duplicate a whole
profile, or copy scenarios into an existing one) — handy for staging → prebau. Scenarios
can be **renamed inline** (double-click or ✎), and **selected steps copied** into another
scenario (`copySteps`) to reuse a login/setup block without rebuilding it.

Because there's **no central DB**, a whole profile can be **exported to one shareable file** and
imported on another machine (`transfer.js` + `core/portability.js`). The bundle is self-contained:
it carries the Test Data Library collections the profile references (detected via `{{Collection.field}}`
tokens **and** repeating-group `collectionId` params, transitively). On import, names that clash are
suffixed and every reference inside the copied steps is rewritten — collection ids (group bindings),
`{{Name.field}}` tokens, and scenario `prerequisite_id` links — so the imported profile runs as-is.
*Not bundled:* run history (excluded by design) and custom steps (global extensibility hook).

---

## 3. How a test actually runs (the key flow)

```
1. User clicks "Run All" on a Profile (Dashboard / ScenarioBuilder)
        ↓
2. runner.js loads ALL scenarios + steps from SQLite, in order
        ↓
3. scriptGenerator.js converts every scenario → ONE Playwright script IN MEMORY
   (a single browser session; scenarios run back-to-back, state carries over)
        ↓
4. webRunner.js finds SYSTEM Node.js (via `where node`) and spawns it ONCE
   running the generated script   ← NOT Electron's own binary (that crashes)
        ↓
5. Playwright drives a real browser; per-step + per-scenario logs stream over IPC → ActiveRun.
   Before each step the script `_settle()`s for the prior step's network to quiet ("calm
   playback", bounded, per-step `_noSettle` opt-out), and can capture that step's requests/
   responses (per-step **network trace**)
        ↓
6. Results saved to History; screenshots/traces captured on failure; network log via View Network Log
        ↓
7. User exports a report (HTML / CSV / Word) from Results or History
```

**Run modes:**

- **Run All (continuous)** — every scenario in the profile runs in ORDER in ONE browser.
  Login in scenario 1 → scenario 2 is already logged in. Created records persist.
  Prerequisites are ignored here (scenario order *is* the setup).
- **Per-scenario ▶ Run (isolated)** — runs one scenario in a fresh browser, first replaying
  its **prerequisite** chain (e.g. Login) if set. For debugging a single scenario.
- **⚡ Parallel Run** — several **profiles** run at the same time, each a fully independent Run All
  (own Playwright process + browser + temp dir). The shared `runner:started/log/complete` streams
  are demuxed by `profileId` (`ParallelRun.jsx`). Faster across environments; **no** shared state
  *between* profiles (within each, it's still a normal state-carrying Run All).
- **Data-driven** — a **repeating group** repeats its step range once per data set in a
  collection+group, resolving each row's tokens. Per-iteration results are labeled by set name.
  Logout goes *inside* the loop body as the reset. This is now the **only** data-driven entry
  point — the old top-level "🔁 Run across" scenario shortcut and its `runner:runDataDriven`
  IPC path were removed entirely.

**Test data & tokens:** steps reference values with `{{Collection.field}}`, `{{faker.*}}` (generated),
or `{{unique.*}}` (fresh-per-run, stable within a run). Tokens resolve in the MAIN process at
generate-time (`tokenResolver.js`), so the emitted Playwright script stays plain JS with no runtime
data dep. Group/loop blocks are expanded (`runner.js` → `expandGroups`) *before* generation: a
repeating group unrolls its body once per set with that set's tokens; non-repeating groups just
inline.

**How a plain `{{Collection.field}}` resolves** (`buildDataContext`): each collection is seeded with its
**representative set** — its first *positive* set, else its first — so a plain fill step types the value
the tester actually entered, not an empty field default (the old behaviour, which read as "the field
didn't fill"). A field no set defines keeps its `default_token` (e.g. a `{{faker.*}}` default survives).
When a run **binds a specific set** (see picker below, or a repeating group's per-iteration set) that set
*owns* its collection — including fields it leaves blank, so negative-testing an empty field works — while
every *other* collection the scenario touches keeps its representative set. Repeating groups still bind a
specific set per iteration, independent of the run pick.

**🧪 Run-against data-set picker:** each Run button (Run All, Run scenario) has its **own** picker,
scoped to the collections that scenario actually references, defaulting to **Auto** (first positive).
Pick `Login-SauceDemo · negative · negative set 1` and that run binds that set — a quick negative pass
without wrapping anything in a repeating group. The two pickers are independent (choosing one doesn't
change the other).

**⚠ Unresolved-token warning:** before the browser opens, the runner scans the scenarios for
`{{Collection.field}}` tokens pointing at a **missing** collection/field (a rename or typo) and logs a
warning naming each — because an unresolved token is otherwise typed into the page *literally*
(`{{Login.usernam}}`), which reads to a tester as "the field didn't fill." Generator namespaces
(`faker`/`unique`/`now`) always resolve, so they're never flagged.

**Pass/fail is PER SCENARIO** (`scriptGenerator.js` wraps each scenario in its own try/catch):

- Within a scenario, the first failed step stops that scenario (its remaining steps are skipped)
  and marks it **failed**.
- Between scenarios, the run **continues** — a failing scenario does not abort the rest; each
  gets its own verdict. `webRunner.js` attributes every step to the in-progress scenario and
  rolls up `scenario_results`; `runner.js` stores `scenarios_total/passed/failed`.
- Overall run status is **passed** only if every scenario passed.
- *Shared-state caveat:* one browser session means scenarios depend on each other — a failed
  Login can cascade into several red scenarios (intentional, honest signal). A future refinement
  may mark dependents as "blocked" via `prerequisite_id`.

**Demonstrate-don't-declare tooling** (all share `stepReplay.js` + `injectedScripts.js`):

> **Replay mirrors a real run.** The pre-interaction replay these tools use now behaves like the
> generated run, so you land where a run would instead of stranded on a login page:
> it replays the scenario's **prerequisite (Login) chain** first — **best-effort** (the persistent
> profile may already be logged in, so a failed re-login is tolerated); resolves `{{Collection.field}}`
> `/{{faker.*}}/{{unique.*}}` **tokens** (types real values, not literal `{{tokens}}`); expands a
> **repeating group** to a single pass against its **first selected set** (`groupExpand.js`,
> `firstSetOnly`); and its **Navigate** honors *Wait until* (default `domcontentloaded`) + *Nav timeout*
> and tolerates `ERR_ABORTED` / redirect-to-self (heavy map/GIS pages never fire `load`). Record
> prepends the prereq chain to its own replay; Pick/Test take it as a best-effort `setupSteps` prefix
> while their same-scenario prior steps stay strict.

- **🎯 Picker** — opens a headful browser (replaying steps above so you can pick mid-flow
  elements, e.g. inside a modal), you click the element, a robust selector is generated.
- **● Recorder** — headful browser with a Pause/Resume + Stop bar; captures
  click/fill/select/keypress and streams each as a step card live. Survives same-tab
  navigations via `sessionStorage`. **Pause** lets you navigate/log in without recording;
  **✓ Assert** turns the next click into an `assertVisible` "Then" step.
- **⊙ Selector tester** — counts matches for a selector, optionally after replaying the steps
  above it so mid-flow elements actually exist.
- **🗂 Test Data Library** — define a form once (collection + fields), store reusable data sets
  (positive/negative/edge); **Capture** values straight from a scenario's fill steps,
  **import** CSV/Excel rows, **export** a collection to share. Drive runs with `{{tokens}}`.

---

## 4. The actions (step library)

| Category | Actions |
|---|---|
| **Navigation** | Navigate, Reload, Go Back, Go Forward, Wait for URL |
| **Interaction** | Click, Double Click, Right Click, Hover, Focus, Select Option, Fill, Type (delay), Clear, Press Key, Upload File, Drag & Drop |
| **Mouse** | Click at Position, Drag by Offset, Zoom / Scroll Wheel (for maps/canvas) |
| **Assertions** | Assert Visible, Hidden, Text, Input Value, URL, Title, Enabled/Disabled, Checked |
| **Waits** | Wait for Element, Wait (ms), Wait for Network Idle |
| **Flow** | Group start / Group end (wrap a range; optional "repeat for each data set" = loop); **If / Else / End If** (conditional block — run a range only when a live condition holds) |
| **Util** | Take Screenshot, Execute JS |

Each step card also has: **Gherkin keyword badge** (Given/When/Then), a **⠿ drag grip**,
↑↓ move, screenshot toggle, a **⊘ skip toggle** (disable the step/group without deleting — it's
dropped from the generated script), a **{ }** token-insert button on value fields, a **Skip
calm-playback wait** toggle (`_noSettle`, for polling/streaming screens or to catch a transient
toast), **Notes**, and **Expected Result** fields — so non-technical users read it like a test
spec. **Assert Text** also has a **Max wait (ms)** field to poll longer for slow/transient content.

**Skip / disable:** a step or group flips `params._skip`; a scenario flips its `skipped` column
(via the ⋯ menu). The runner drops `_skip` steps/groups in `expandGroups`, and Run All excludes
`skipped` scenarios (an explicit single-scenario ▶ run still runs them).

---

## 5. Key Technical Decisions (and *why*)

| Decision | Why |
|---|---|
| **sql.js (WASM), not better-sqlite3** | Zero native compilation — no Python/MSVC pain on Windows |
| **Step-card list, not n8n-style node graph** | Sequential UX is cleaner for non-technical QA; a test is a straight line. Conditionals were added as **If/Else block step types** (on the existing group machinery), *not* a visual canvas — keeps the straight-line model |
| **In-memory script generation** | No script files litter the disk; built fresh from step data each run |
| **One browser per RUN, not per scenario** | Scenarios form a module journey — state (login, created records) must carry over |
| **Continue past a failing scenario; verdict PER scenario** | A run reports which scenarios passed/failed, not just one overall result — far more actionable on the dashboard. Within a scenario it still stops at the first failed step |
| **Picker/recorder over typing selectors** | "Demonstrate, don't declare" — clicking the real element beats hand-writing CSS |
| **One shared in-page selector generator** | `injectedScripts.js` keeps picker + recorder selector logic identical |
| **Own lightweight recorder, not `playwright codegen`** | Codegen emits code; we need step-card data. Parsing generated code is brittle |
| **Spawn SYSTEM Node, not `process.execPath`** | Electron's binary as the runner crashes the main process |
| **`ignoreHTTPSErrors: true` everywhere** | Target sites may use self-signed SSL certs (common in internal/QA environments) |
| **Self-healing selector chain** (`healChain.js`) | The picker auto-captures a few *validated* alternative selectors (`selectorChain`); at run time the primary is `.or()`'d with the manual Alt Selector + that chain, on clicks **and** fill/type/select — so a drifted selector still re-finds the element. Zero AI; generalises the old one-level Alt Selector |
| **Run-scoped variables, not a persisted store** | `{{var.x}}` lives for one run only. The API side persists (`api_variables`) because a token outlives a request; a UI-scraped value doesn't — a stale one would make a broken test pass |
| **Custom Code inlined, not `eval`'d** | The tester's code goes straight into the generated script so a stack trace points at *their* line. Trade-off: a syntax error breaks the whole script (fatal) instead of failing one step |
| **One shared code editor** (`components/CodeArea.jsx`) | The API body editor's transparent-textarea-over-highlighted-`<pre>` trick, with a `js` mode added, reused for Custom Code / JS expressions. Regex tinting, no highlighter dependency |
| **"Wait before click (ms)"** | For modal animations and slow UI transitions |
| **Pluggable runner layer** | WebRunner (Playwright) live; MobileRunner (Appium) slot reserved for Phase 2 |

---

## 6. Tech Stack

- **Shell:** Electron 31 + electron-vite
- **UI:** React 18 (plain, no router lib — screen state in App.jsx)
- **Automation:** Playwright 1.45 (Chromium primary)
- **Storage:** sql.js 1.12 (SQLite WASM) → `.db` file in Electron `userData`
- **Reports:** `docx` 8.5 for Word export; HTML/CSV hand-rolled
- **Packaging:** electron-builder → Windows NSIS installer

---

## 7. Common quirks to be aware of

- Internal/QA sites may use self-signed SSL → `ignoreHTTPSErrors: true` is on by default on every browser context
- Login pages with warning modals → use text/attribute selectors (e.g. `button:has-text("OK")`) + a wait for animations; avoid generic class selectors that match multiple elements
- Internal URLs may only be reachable on a specific network / VPN
- **Map/GIS/SPA pages never go network-idle** (tile streaming, polling) → keep **Navigate**'s *Wait until* on `domcontentloaded`, not `load`/`networkidle`, or `goto` hangs. A `navigate` to the page you're already on (e.g. a post-login redirect already took you there) can raise `net::ERR_ABORTED` — both the run and the replay tolerate it, so no need to work around it
- **Persistent login profile:** picker/recorder/selector-test share one on-disk browser profile, so a login done once carries across them. Switch users / log out via **session:clear** (wipes the profile). Closing the app now reaps any open run/tool browsers instead of orphaning them

---

## 8. Status

**Phase 1 (done):** All screens built, full backend, end-to-end flow confirmed
(navigate → fill → click modal → assert).

**UI (done):** Hand-drawn **"Sketchbook"** theme (warm paper, ink borders, offset shadows,
hand fonts) — friendlier for non-technical QA. See [docs/DESIGN.md](docs/DESIGN.md) before any
UI change. Dashboard rebuilt as profile cards (scenario count, last run, per-scenario
breakdown, recent-runs streak).

**"Demonstrate, don't declare" layer (done):**
- 🎯 Element picker — click the real element, get a robust selector
- ● Recorder — record clicks/typing into step cards live (survives navigations); Pause/Resume
  + ✓ Assert mode (record a visibility check)
- ⊙ Selector tester "from the top" — replay steps above before testing a selector
- **Replay parity** — pick/test/record replay now matches a run: prereq (Login) chain first
  (best-effort), `{{tokens}}` resolved, repeating groups expanded to their first set, and
  Navigate honors *Wait until*/*Nav timeout* + tolerates `ERR_ABORTED`
- Continuous run model — Run All shares one browser session across scenarios
- **Per-scenario pass/fail** — Run All continues past a failing scenario; each scenario gets
  its own verdict (`scenarios_total/passed/failed` in history)
- Per-scenario isolated run + prerequisite link
- Replicate: duplicate profile / copy scenarios; reorder + duplicate + **inline-rename** scenarios
- **Copy selected steps into another scenario** (append, order preserved, independent copies)
- **Group-aware selection** — ticking a group selects its whole block (inner + nested groups)
- **Share a profile** — export/import a self-contained `.automation-profile.json` (scenarios + steps +
  referenced test data); import remaps collection ids/names + prereqs so it runs on any machine
- Collapsible step cards + drag-and-drop reordering for an at-a-glance, rearrangeable scenario

**Run robustness & speed (done):**
- 🐢 **Calm playback** — each step waits for the prior step's network to quiet before acting
  (bounded, never fails the step); global toggle + settle cap in Settings, per-step `_noSettle` opt-out
- 🌐 **Per-step network trace** — capture a step's requests/responses; review via View Network Log in Results
- ⚡ **Parallel runs** — fire several profiles at once, each an independent browser process (ParallelRun)
- ⏱ **Assert Text Max wait** — per-step poll window above the 5s default, for slow/transient content
- 🧹 **History retention enforced** — on startup, run rows older than `history_retention_days`
  (Settings) are pruned, so the full-serialize sql.js saves + startup reads stay bounded
- 🧯 **Clean shutdown** — app quit / Stop reaps in-flight run *and* interactive-tool browsers
  (Windows tree-kill), so nothing is orphaned in the background

**Test data & data-driven (done):**
- 🗂 Test Data Library — collections (form shape) + data sets (positive/negative/edge) + tokens
  (`{{Collection.field}}` / `{{faker.*}}` / `{{unique.*}}`), resolved at generate-time
- Capture data from a scenario's fill steps; { } token insert; ▦ Fill form from a collection
- Import rows (CSV/Excel paste); export/import a collection (json/csv) to share with other QA
- 🔁 Step groups — named, collapsible, **nestable**; flip "repeat for each data set" → loop
  (runs a step range once per row, e.g. login→logout per credential)
- **Representative-set resolution** — a plain `{{Collection.field}}` step fills the collection's
  first positive set (not an empty default); a bound set owns its collection, others keep their rep set
- 🧪 **Run-against picker** — pick a data set per Run button (independent), scoped to the scenario's
  collections; Auto = first positive. Negative pass without a repeating group
- ✎ **Inline data editing** — edit a token's value across all its sets in a popover, no trip to Test Data
- ⚠ **Unresolved-token warning** — a `{{token}}` with no matching collection/field is named in the run
  log before the browser opens (it would otherwise type in literally)

**Control flow (done):**
- 🔀 **If / Else conditional blocks** — a step range that runs only when a live condition holds (binary,
  never a third branch). Condition types: visible/hidden/exists/enabled/checked/text/value/url/title, with
  NOT + contains/equals + optional wait-for. Real runtime `if/else` in the generated script (a missing
  element = false, not an error) and mirrored in record/pick/test replay
- 🩹 **Self-healing selectors** — the picker stores validated fallback selectors; a drifted primary heals
  via the chain at run time, on clicks and fill/type/select alike (`healChain.js`)

**Variables (done):**
- 📌 **Capture Value** — reads element text / input value / an attribute / the URL / a JS expression into
  `{{var.name}}` (trimmed), logged in the run as `📌 {{var.orderId}} = …`. Every later step, If-condition
  and assertion can use it
- ⚡ **Custom Code (advanced)** — the tester's own Playwright code, inlined verbatim into the generated
  script with `page`/`context`/`expect`/`vars` in scope. Distinct from **Execute JS**, which is sandboxed
  to the *page*; this runs in the **runner**, so downloads / extra tabs / `context.request` are reachable
- **Why the plumbing looks the way it does:** all other tokens resolve at *generate* time, before the
  script string exists — a captured value doesn't exist yet. So the script carries `__vars` + `__sub()`,
  and `wrapVars()` rewrites only the emitted string literals that contain a var token into `__sub()`
  calls. One pass covers every action (and If-conditions, since `__cond` receives an object *literal*)
  instead of touching ~40 emit sites. `var` is an explicit namespace in `tokenResolver` (so a collection
  named "var" can't shadow it) and is exempt from the unresolved-token warning
- **Run-scoped, never persisted** — the API profile's `api_variables` store is a DB table on purpose
  (a token outlives one request); a value scraped off the UI is only true for this run, and keeping it
  would let a stale value make a broken test look green
- Both steps are **REPLAYABLE**, so record/pick/test lands where a real run would: replay mirrors the
  capture and runs custom code through `AsyncFunction` against its live page (`subVars` = replay's `__sub`)

**API profiles (beta, in progress):**
- A second profile type (`profiles.type='api'`) renders the **ApiWorkspace** instead of step-cards —
  a Postman/SoapUI-style **request collection** for **SOAP & REST** APIs.
- New tables: `api_requests`, `api_variables` (profile-wide shared store), `api_auth`.
- `apiEngine.js` runs requests **in-process** (Node `http`/`https`, insecure TLS — the API mirror of
  `ignoreHTTPSErrors`), substitutes `{{var}}`, extracts JSON/XML/header/status values into the store,
  and runs a **token policy** (inject auth header + proactive mint + 401 re-fetch-and-retry).
- **Click-to-extract**: the response renders as a tree; clicking a value saves it into a variable.
- **WSDL import** (`wsdlImport.js`) follows `wsdl:import`/`xsd:import` chains and scaffolds one SOAP
  request per operation (full envelope, `SOAPAction`, and the `ServiceHeader` block).
- A collection run streams over the existing `runner:log`/`complete` and saves to **History**.
- *Remaining:* SOAP-fault-based token refresh (WCF returns a Fault on expiry, not 401) and
  API-shaped report formatting (HTML/CSV/Word currently render the browser/screenshot shape).
- New dep: **fast-xml-parser** (pure JS, no native build — consistent with the sql.js choice).

**Setup gotcha:** `npx playwright install chromium` must be run once per machine.

**Phase 2 (future):** Mobile/Appium runner (beta landed for native Android), tag filtering,
negative/"expected-to-fail" data-driven testing, retries + flaky-test surfacing, teardown/cleanup
hooks, and "blocked" scenario marking (skip/flag scenarios that depend on an already-failed one via
`prerequisite_id`).

**Known follow-ups:** If-block conditions referencing `{{tokens}}` aren't yet scanned by profile
export (`params.cond` is nested; portability walks flat params only) — a shared condition that uses
test data won't bundle/rewrite its collection. Fix when a real case needs it. A **syntax error in a
Custom Code step is fatal to the whole run** (it breaks the generated script), not a single red step —
wrappable, at the cost of the stack trace pointing at the tester's own line.

> **Known notes:** in a continuous Run All, a scenario that starts with its own *Navigate*
> step will reload the page (you stay logged in via cookies, but in-memory SPA state resets) —
> for a smooth journey, let the first scenario navigate and have later ones continue.
> The Electron renderer has no `window.prompt()`, so create/rename use inline inputs and an
> in-app confirm dialog (`lib/confirm.jsx`); "Duplicate Profile" auto-names the copy.

---

## 9. Good discussion prompts for Claude chat

- How to make the selector-building experience even more foolproof for non-coders?
- Record & playback architecture (Phase 2) — feasible inside this Electron+Playwright setup?
- Should custom steps evolve into reusable "sub-scenarios" / composable building blocks?
- Reporting: what would make exports more useful for QA sign-off / audit trails?
- Scaling: profile-level **Parallel Run** ships today — is scenario-level parallelism worth it,
  given Run All deliberately shares one browser session for state carry-over?
```
