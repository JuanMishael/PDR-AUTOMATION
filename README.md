# AutomationTool

Visual QA automation runner for non-technical testers, powered by Playwright and Electron.

Build and run browser automation scripts through a point-and-click UI — no coding required.

## Features

- **Profile-based runs** — configure URL, browser, timeout, and headless mode per environment
- **Scenario builder** — assemble test steps from 28 action types (click, fill, assert, screenshot, etc.)
- **Live run view** — real-time step-by-step log with pass/fail status
- **Reports** — export results as HTML, CSV, or Word (.docx)
- **Run history** — browse past runs and re-open results at any time
- **Health check** — verifies Node.js and Playwright browser installations

## Tech Stack

- **Electron + Vite + React** — desktop shell and UI
- **Playwright** — browser automation engine
- **sql.js** — embedded SQLite (WASM, no native compilation needed)

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
    core/       # db, script generator, web runner
    ipc/        # IPC handlers: storage, runner, reporter, health
  renderer/
    src/
      screens/  # Dashboard, ScenarioBuilder, ActiveRun, Results, History, Settings, HealthCheck
      components/ # Sidebar, StepCard, StepPicker, action definitions
  preload/      # Context bridge
```

## Phase 2 (planned)

- Mobile automation via Appium
- Tag-based step filtering
- Record & playback
