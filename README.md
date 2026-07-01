# PDR-AUTOMATION

Visual QA automation runner for non-technical testers, powered by Playwright and Electron.

Build and run browser automation scripts through a point-and-click UI — no coding required.

> **Guiding idea:** *demonstrate, don't declare.* A tester should perform the test once,
> naturally, and the tool handles the techy translation (selectors, waits). The human only
> owns the part they're good at — what counts as "passed."

## Features

- **Profile-based runs** — configure URL, browser, timeout, and headless mode per environment
- **🔌 API profiles (beta)** — a second profile type that swaps the browser step-cards for a Postman/SoapUI-style **request collection** for testing **SOAP & REST** APIs. Send requests, a profile-wide **variable store** (`{{token}}`) shared across requests, **click-to-extract** values from a response tree into variables, a token **auth policy** (inject + auto re-fetch on 401), and **WSDL import** that follows the schema imports and scaffolds one SOAP request per operation (envelope + `SOAPAction` + `ServiceHeader`). *Still in progress — SOAP-fault token refresh and API-shaped reports are pending.*
- **Scenario builder** — assemble test steps from 30+ action types (click, fill, assert, screenshot, etc.) across Navigation, Interaction, Mouse, Assertions, Waits, Flow, and Util, with collapsible step cards for a clean overview
- **🎯 Element picker** — click "Pick", then click the real element in a live browser; a robust selector is generated for you (no CSS knowledge needed)
- **● Recorder** — open the site, hit Start, and just *use it* — your clicks, typing, and dropdowns become step cards live. Recording survives navigations (e.g. a login redirect). **Pause/Resume** to navigate without recording, and an **✓ Assert** mode that turns the next click into a "verify this is visible" check
- **Selector tester (from the top)** — test a selector after replaying the steps above it, so mid-flow elements (modals, post-login content) actually match instead of misreporting "0 found"
- **🗂 Test Data Library** — define a form once as a **collection** (fields + types), then store reusable **data sets** grouped by intent (positive / negative / edge). Reference values in steps with `{{Collection.field}}` tokens, plus `{{faker.*}}` and `{{unique.*}}` for fresh-per-run values. Capture data straight from a scenario's fill steps, **import** rows from CSV/Excel, and **export** a collection (.json/.csv) to share with other QA
- **▦ Fill form / { } token insert** — drop a whole mapped form in as pre-wired fill cards, or insert a `{{token}}` into any value field from a dropdown — no need to remember the syntax
- **🔁 Step groups & loops** — select steps → group them into a named, collapsible (and **nestable**) block; flip a group to **repeat for each data set** and it runs once per credential/row, resolving that row's tokens — login → logout → login again falls out naturally. This repeating group is now the **single** way to drive data-driven runs (the old top-level "Run across" shortcut was removed)
- **☑ Group-aware selection** — ticking a group's checkbox selects the **whole block** — its inner steps and any nested groups — so you can group/copy/delete a unit in one click
- **⧉ Copy steps to scenario** — select steps and append them into **another scenario** (same or different profile), source order preserved, as independent copies — reuse a login or setup block without rebuilding it
- **Reorder & arrange** — move steps and whole groups with ↑↓ (block-aware) or **drag-and-drop** (drop a step *into* a group to make it a member). **Multi-select** several steps (checkboxes) and **drag any one to move the whole selection together**. **Drag scenarios** to reorder them, with a per-scenario **⋯ menu** (rename / duplicate / delete) keeping the list clean; copy scenarios across profiles
- **🔍 Search everywhere** — quick filter boxes for scenarios (in the builder), Test Data collections, and Dashboard profiles, so big suites stay navigable. The Dashboard also floats the **most-recently-run** profile to the top
- **⊘ Skip / disable** — temporarily turn off a **step**, a whole **group**, or a **scenario** without deleting it (dimmed + struck-through). Skipped steps/groups are dropped from the generated script; skipped scenarios are excluded from **Run All** (an explicit single-scenario ▶ run still runs them) — handy for isolating or parking a flaky case
- **Continuous runs** — "Run All" runs every scenario in order in **one browser session**; state carries over (stay logged in, keep created records). A failing scenario doesn't stop the rest — each gets its **own pass/fail** (see [How a run works](#how-a-run-works))
- **Per-scenario isolated run** — run a single scenario in a fresh browser, optionally re-running a prerequisite (e.g. Login) first, for debugging
- **⚡ Parallel runs** — kick off several **profiles at once**, each as an independent run (own Playwright process + browser + temp dir), with a live card per profile. For getting through many environments/suites faster — unlike "Run All", these don't share a browser session, so they're independent, not state-carrying
- **🐢 Calm playback** — before each step the runner waits for the page's network to go quiet (bounded best-effort, never fails the step) so actions don't fire mid-load. Toggle it (and the settle cap) in **Settings**. Opt a **single step** out with **"Skip calm-playback wait"** (`_noSettle`) — for polling/streaming screens, or to start an assertion polling *immediately* so it catches a transient toast before it auto-dismisses (pair it with **Assert Text → Max wait** to span a slow async chain; see [docs/SELECTOR-RECIPES.md](docs/SELECTOR-RECIPES.md))
- **🌐 Network trace** — capture each step's requests/responses and review them in the results via **View Network Log**. Lets you confirm an API actually returned the right status/body, instead of trusting a UI message that may be hardcoded on the success path
- **Replicate environments** — duplicate a whole profile (e.g. staging → prebau) or copy scenarios into another profile; just change the Base URL
- **📤 Share a profile (export / import)** — there's no central server, so export a whole profile to a single `.automation-profile.json` file (its scenarios + steps **and** the Test Data Library collections it references) and another QA imports it from their Dashboard. The bundle is self-contained: referenced collections travel with it, and on import any name clashes are suffixed and the references inside the steps (`{{Collection.field}}` tokens **and** repeating-group bindings) are rewritten so it runs immediately
- **Dashboard** — a card per profile showing scenario count, last-run status & time, the last run's "X/Y scenarios passed" breakdown, and a recent-runs streak
- **Live run view** — real-time step-by-step log with pass/fail status
- **Reports** — export results as HTML, CSV, or Word (.docx)
- **Run history** — browse past runs and re-open results at any time
- **Health check** — verifies Node.js and Playwright browser installations

## Tech Stack

- **Electron + Vite + React** — desktop shell and UI
- **Playwright** — browser automation engine
- **sql.js** — embedded SQLite (WASM, no native compilation needed)

## Design

The UI follows a hand-drawn **"Sketchbook"** theme (warm paper, soft-ink borders,
solid offset shadows, hand-drawn headings). Before adding or changing any UI, read
[**docs/DESIGN.md**](docs/DESIGN.md) — it documents the tokens, component classes,
icons, and do/don'ts that keep the look uniform.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- Playwright browsers (one-time install, see below)

## Setup

```bash
# Install dependencies
npm install

# Install Playwright browser (run once per machine)
# Chromium is the default; add `firefox webkit` only if you select those in a profile.
npx playwright install chromium

# Start in development mode
npm run dev
```

## Build

```bash
# Package for distribution (Windows NSIS installer)
npm run dist
```

Output goes to `release/`. `npm run dist` builds the app, downloads Chromium into
`pw-browsers/`, and bundles it into the installer — so end users just run the
installer and use the app. No Node.js and no `playwright install` on their machine:
runs execute with the Electron-bundled Node and the bundled Chromium.

> Installs ship Chromium only. Firefox/WebKit are opt-in per profile and not bundled;
> a profile that selects them on a machine without them will report the engine missing.

## Project Structure

```
src/
  main/
    core/       # db, scriptGenerator, webRunner, stepReplay, groupExpand (group/loop → steps),
                #   injectedScripts, tokenResolver, windowFocus, browserSession (shared login profile),
                #   portability (profile export/import serialize/deserialize),
                #   apiEngine (HTTP + {{var}}/extract/token engine), wsdlImport (WSDL → SOAP collection)
    ipc/        # IPC handlers: storage, runner, apiRunner (API send/run/WSDL-import), reporter,
                #   health, selectorTester, elementPicker, recorder, dataLibrary, transfer
  renderer/
    src/
      screens/  # Dashboard, ScenarioBuilder, ApiWorkspace (API profiles), ActiveRun, ParallelRun,
                #   Results, History, Settings, HealthCheck, TestData, Help
      components/ # Sidebar, StepCard, action definitions
      lib/      # confirm (in-app dialog used instead of native confirm/prompt)
  preload/      # Context bridge
```

Key shared modules:

- `core/stepReplay.js` — replays existing steps against a live page (used by the picker, recorder, and selector tester to reach mid-flow state); resolves `{{tokens}}` and tolerates SPA `ERR_ABORTED` navigations like a real run
- `core/groupExpand.js` — expands group/loop blocks into a flat step list; a repeating group unrolls once per data set for a run, or once against its **first set** for replay (`firstSetOnly`). Shared by `runner.js` and the replay handlers
- `core/injectedScripts.js` — in-page scripts injected into the picker/recorder browser; **single source of truth** for selector generation (`id → data-testid → name/aria → text → CSS path`)
- `core/scriptGenerator.js` — turns one or more scenarios into a single Playwright script (one browser per run)
- `core/tokenResolver.js` — resolves `{{Collection.field}}` / `{{faker.*}}` / `{{unique.*}}` tokens to concrete values at generate-time, so the emitted script stays plain JS
- `ipc/dataLibrary.js` — CRUD for the Test Data Library (collections, fields, data sets) + collection export/import
- `core/portability.js` — serialize a profile (+ its scenarios/steps + referenced collections) into a shareable bundle and recreate it on import, remapping collection ids/names and prerequisite links so the copy is self-consistent
- `ipc/transfer.js` — `transfer:exportProfile` / `transfer:importProfile` (file write + open dialog around `portability.js`)

## How a run works

- **Run All** generates **one** script for the whole profile and runs every scenario in order, in a single browser — so login and created state carry from one scenario to the next.
- **Per-scenario ▶ Run** runs just that scenario (plus an optional prerequisite) in a fresh browser.
- **⚡ Parallel Run** fires several profiles at the same time — each is a *separate* Run All (own browser process), so they finish faster but **don't** share state with each other.
- **🐢 Calm playback** sits *inside* the generated script: each step `await _settle(cap)`s for the prior step's network to quiet before acting (skipped per-step via `_noSettle`). It's a bounded best-effort wait — a never-idle app just proceeds at the cap.
- **Groups & loops** are expanded *before* the script is generated (`core/groupExpand.js`, called from `runner.js`): a repeating group's body is unrolled once per data set in its collection+group, each iteration's `{{tokens}}` resolved from that set (labels prefixed with the set name so per-row pass/fail is readable). Non-repeating groups are purely organizational and just inline their steps. Group markers never reach the generated script.
- **Record / Pick / Test replay mirrors a run.** Before you record, pick an element, or test a selector, the pre-interaction replay (`stepReplay.js`) now does what a run does: replays the scenario's prerequisite **Login** chain first (best-effort), resolves `{{tokens}}` to real values, expands a repeating group to its **first set** (`groupExpand.js` `firstSetOnly`), and navigates with the step's *Wait until*/*Nav timeout* while tolerating `ERR_ABORTED` — so you land on the gated page instead of stuck at login.

### Pass/fail (per scenario)

A run records **a pass/fail verdict for each scenario**, not just one verdict for the whole run:

- **Within a scenario**, execution stops at the **first failed step** (the rest of that scenario is meaningless) and the scenario is marked **failed**.
- **Between scenarios**, the run **continues** — a failing scenario does *not* abort the ones after it. Each scenario gets its own pass/fail, stored as `scenarios_total / scenarios_passed / scenarios_failed` on the run's history row.
- The overall run is **passed** only if every scenario passed.

> **Heads-up on shared state:** because Run All uses one browser session, scenarios depend
> on each other's state (e.g. a Login scenario logs everything in). If an early scenario like
> Login fails, later scenarios that rely on it will likely fail too — so one root cause can
> show as several red scenarios. That cascade is intentional (honest signal); a future
> refinement may mark dependent scenarios as "blocked" using each scenario's `prerequisite_id`.

## Phase 2 (planned)

- Mobile automation via Appium
- Tag-based step filtering
- Negative/"expected-to-fail" data-driven testing (assert a login is *rejected* per row)
- Self-healing selector fallback chain (auto-try by-text / role+name / nearby-label on failure)
- "Blocked" scenario marking — skip/flag scenarios whose prerequisite already failed

**Recently shipped** (was Phase 2): assert-mode recording, smart waits, Test Data Library + data-driven loops, step groups, drag-and-drop reordering, inline scenario rename, copy steps between scenarios, group-aware selection, **calm-playback network settle** (+ per-step `_noSettle` opt-out), **per-step network trace** in results, **parallel profile runs**, **Set Checkbox** action, a per-step **Max wait** on Assert Text, **replay parity for record/pick/test** (prereq Login chain + `{{token}}` resolution + first-set groups + `ERR_ABORTED`-tolerant navigate), **enforced history retention**, and **clean-shutdown browser reaping**.

**In progress:** 🔌 **API profiles (beta)** — SOAP/REST request collections with a shared `{{token}}` store, click-to-extract, an auth/token policy, and WSDL import. Remaining: SOAP-fault token auto-refresh and API-shaped report formatting.
