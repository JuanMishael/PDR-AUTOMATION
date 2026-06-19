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
│   ├── ProfileConfig        → define a "site under test" (base URL, browser, headless, timeout)
│   ├── ScenarioBuilder      → THE CORE: build a test visually
│   │     ├── Step Library (left)   — 30+ actions in 7 categories (incl. Flow: group/loop)
│   │     ├── Scenario list (left)  — drag (⠿) to reorder; ⋯ menu = rename / duplicate / delete;
│   │     │                           filter box when there are many
│   │     ├── Canvas (right)        — collapsible step cards; drag (⠿) to reorder / into groups
│   │     ├── 🎯 Pick               — click a real element, get a selector
│   │     ├── ⊙ Test                — test a selector after replaying steps above it
│   │     ├── ● Record              — record clicks/typing (Pause/Resume + ✓ Assert mode)
│   │     ├── ⊞ Group / 🔁 loop      — group steps (nestable); flip "repeat for each data set"
│   │     │                           (the ONLY data-driven path — no top-level shortcut)
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
│   └── Settings             → global defaults (browser, retention, screenshots)
│
├── PRELOAD (secure bridge)
│   └── window.api.*  → whitelisted IPC calls only (no direct Node in renderer)
│
└── MAIN (Node.js backend — the engine)
    ├── core/
    │   ├── db.js              → SQLite via sql.js (WASM, no native build)
    │   ├── scriptGenerator.js → turns scenarios → ONE Playwright JS script (in memory)
    │   ├── webRunner.js       → spawns system Node to run the generated script
    │   ├── stepReplay.js      → replays steps against a live page (picker/recorder/tester)
    │   ├── tokenResolver.js   → resolve {{Collection.field}}/{{faker.*}}/{{unique.*}} at gen-time
    │   ├── windowFocus.js     → re-assert keyboard focus after headful browser / native dialogs
    │   ├── injectedScripts.js → in-page selector generator + picker/recorder listeners
    │   └── portability.js     → serialize/deserialize a profile bundle (scenarios + steps +
    │                            referenced collections); remaps ids/names/prereqs on import
    └── ipc/
        ├── runner.js          → orchestrates runs (continuous, isolated, data-driven); expands
        │                         group/loop blocks; saves history
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
        └── Step  (one action: Navigate, Fill, Click, Assert…)
              └── params (JSON: selector, value, waits, etc.)
                  └── may contain {{Collection.field}} / {{faker.*}} / {{unique.*}} tokens
        └── groupStart…groupEnd  (markers wrapping a step range into a named, nestable group;
              a group can "repeat for each data set" → it becomes a data-driven loop)

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
5. Playwright drives a real browser; per-step + per-scenario logs stream over IPC → ActiveRun
        ↓
6. Results saved to History; screenshots/traces captured on failure
        ↓
7. User exports a report (HTML / CSV / Word) from Results or History
```

**Run modes:**

- **Run All (continuous)** — every scenario in the profile runs in ORDER in ONE browser.
  Login in scenario 1 → scenario 2 is already logged in. Created records persist.
  Prerequisites are ignored here (scenario order *is* the setup).
- **Per-scenario ▶ Run (isolated)** — runs one scenario in a fresh browser, first replaying
  its **prerequisite** chain (e.g. Login) if set. For debugging a single scenario.
- **Data-driven** — a **repeating group** repeats its step range once per data set in a
  collection+group, resolving each row's tokens. Per-iteration results are labeled by set name.
  Logout goes *inside* the loop body as the reset. This is now the **only** data-driven entry
  point — the old top-level "🔁 Run across" scenario shortcut and its `runner:runDataDriven`
  IPC path were removed entirely.

**Test data & tokens:** steps reference values with `{{Collection.field}}` (from the active/chosen
data set, falling back to the field default), `{{faker.*}}` (generated), or `{{unique.*}}`
(fresh-per-run, stable within a run). Tokens resolve in the MAIN process at generate-time
(`tokenResolver.js`), so the emitted Playwright script stays plain JS with no runtime data dep.
Group/loop blocks are expanded (`runner.js` → `expandGroups`) *before* generation: a repeating
group unrolls its body once per set with that set's tokens; non-repeating groups just inline.

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
| **Flow** | Group start / Group end (wrap a range; optional "repeat for each data set" = loop) |
| **Util** | Take Screenshot, Execute JS |

Each step card also has: **Gherkin keyword badge** (Given/When/Then), a **⠿ drag grip**,
↑↓ move, screenshot toggle, a **{ }** token-insert button on value fields, **Notes**, and
**Expected Result** fields — so non-technical users read it like a test spec.

---

## 5. Key Technical Decisions (and *why*)

| Decision | Why |
|---|---|
| **sql.js (WASM), not better-sqlite3** | Zero native compilation — no Python/MSVC pain on Windows |
| **Step-card list, not n8n-style node graph** | Sequential UX is cleaner for non-technical QA; a test is a straight line |
| **In-memory script generation** | No script files litter the disk; built fresh from step data each run |
| **One browser per RUN, not per scenario** | Scenarios form a module journey — state (login, created records) must carry over |
| **Continue past a failing scenario; verdict PER scenario** | A run reports which scenarios passed/failed, not just one overall result — far more actionable on the dashboard. Within a scenario it still stops at the first failed step |
| **Picker/recorder over typing selectors** | "Demonstrate, don't declare" — clicking the real element beats hand-writing CSS |
| **One shared in-page selector generator** | `injectedScripts.js` keeps picker + recorder selector logic identical |
| **Own lightweight recorder, not `playwright codegen`** | Codegen emits code; we need step-card data. Parsing generated code is brittle |
| **Spawn SYSTEM Node, not `process.execPath`** | Electron's binary as the runner crashes the main process |
| **`ignoreHTTPSErrors: true` everywhere** | Target sites may use self-signed SSL certs (common in internal/QA environments) |
| **Alt Selector fallback** (`.or()`) on clicks | Handles flaky element matching in one step, no extra waits |
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
- Continuous run model — Run All shares one browser session across scenarios
- **Per-scenario pass/fail** — Run All continues past a failing scenario; each scenario gets
  its own verdict (`scenarios_total/passed/failed` in history)
- Per-scenario isolated run + prerequisite link
- Replicate: duplicate profile / copy scenarios; reorder + duplicate + **inline-rename** scenarios
- **Copy selected steps into another scenario** (append, order preserved, independent copies)
- **Group-aware selection** — ticking a group selects its whole block (inner + nested groups)
- **Share a profile** — export/import a self-contained `.botchi-profile.json` (scenarios + steps +
  referenced test data); import remaps collection ids/names + prereqs so it runs on any machine
- Collapsible step cards + drag-and-drop reordering for an at-a-glance, rearrangeable scenario

**Test data & data-driven (done):**
- 🗂 Test Data Library — collections (form shape) + data sets (positive/negative/edge) + tokens
  (`{{Collection.field}}` / `{{faker.*}}` / `{{unique.*}}`), resolved at generate-time
- Capture data from a scenario's fill steps; { } token insert; ▦ Fill form from a collection
- Import rows (CSV/Excel paste); export/import a collection (json/csv) to share with other QA
- 🔁 Step groups — named, collapsible, **nestable**; flip "repeat for each data set" → loop
  (runs a step range once per row, e.g. login→logout per credential)

**Setup gotcha:** `npx playwright install chromium` must be run once per machine.

**Phase 2 (future):** Mobile/Appium runner, tag filtering, negative/"expected-to-fail"
data-driven testing, self-healing selector fallbacks, "blocked" scenario marking (skip/flag
scenarios that depend on an already-failed one via `prerequisite_id`).

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
- Scaling: running many profiles/scenarios in parallel vs. the current sequential model.
```
