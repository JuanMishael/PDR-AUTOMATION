# PDR-AUTOMATION

Visual QA automation runner for non-technical testers, powered by Playwright and Electron.

Build and run browser automation scripts through a point-and-click UI — no coding required.

> **Guiding idea:** *demonstrate, don't declare.* A tester should perform the test once,
> naturally, and the tool handles the techy translation (selectors, waits). The human only
> owns the part they're good at — what counts as "passed."

## Features

- **Profile-based runs** — configure URL, browser, timeout, and headless mode per environment
- **Scenario builder** — assemble test steps from 28 action types (click, fill, assert, screenshot, etc.), with collapsible step cards for a clean overview
- **🎯 Element picker** — click "Pick", then click the real element in a live browser; a robust selector is generated for you (no CSS knowledge needed)
- **● Recorder** — open the site, hit Start, and just *use it* — your clicks, typing, and dropdowns become step cards live. Recording survives navigations (e.g. a login redirect)
- **Selector tester (from the top)** — test a selector after replaying the steps above it, so mid-flow elements (modals, post-login content) actually match instead of misreporting "0 found"
- **Continuous runs** — "Run All" runs every scenario in order in **one browser session**; state carries over (stay logged in, keep created records)
- **Per-scenario isolated run** — run a single scenario in a fresh browser, optionally re-running a prerequisite (e.g. Login) first, for debugging
- **Replicate environments** — duplicate a whole profile (e.g. staging → prebau) or copy scenarios into another profile; just change the Base URL
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

# Install Playwright browsers (run once per machine)
npx playwright install chromium firefox webkit

# Start in development mode
npm run dev
```

## Build

```bash
# Package for distribution (Windows NSIS installer)
npm run dist
```

Output goes to `release/`.

## Project Structure

```
src/
  main/
    core/       # db, scriptGenerator, webRunner, stepReplay, injectedScripts
    ipc/        # IPC handlers: storage, runner, reporter, health,
                #   selectorTester, elementPicker, recorder
  renderer/
    src/
      screens/  # Dashboard, ScenarioBuilder, ActiveRun, Results, History, Settings, HealthCheck
      components/ # Sidebar, StepCard, action definitions
  preload/      # Context bridge
```

Key shared modules:

- `core/stepReplay.js` — replays existing steps against a live page (used by the picker, recorder, and selector tester to reach mid-flow state)
- `core/injectedScripts.js` — in-page scripts injected into the picker/recorder browser; **single source of truth** for selector generation (`id → data-testid → name/aria → text → CSS path`)
- `core/scriptGenerator.js` — turns one or more scenarios into a single Playwright script (one browser per run)

## How a run works

- **Run All** generates **one** script for the whole profile and runs every scenario in order, in a single browser — so login and created state carry from one scenario to the next.
- **Per-scenario ▶ Run** runs just that scenario (plus an optional prerequisite) in a fresh browser.

## Phase 2 (planned)

- Mobile automation via Appium
- Tag-based step filtering
- Assert-mode recording (mark what to verify, not just actions)
- Smart waits and self-healing selector fallbacks
