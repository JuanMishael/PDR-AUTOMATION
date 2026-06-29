import { ipcMain, shell } from 'electron'
import { app } from 'electron'
import { join } from 'path'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { getDb } from '../core/db'
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, HeadingLevel, ImageRun, AlignmentType, BorderStyle, ShadingType
} from 'docx'

const ACCENT = '4F46E5'
const PASS_BG = 'D1FAE5'
const FAIL_BG = 'FEE2E2'
const PASS_FG = '065F46'
const FAIL_FG = '991B1B'

export function registerReporterHandlers() {
  ipcMain.handle('reporter:export', async (_, runId, format) => {
    const db = getDb()
    const run = db.prepare('SELECT * FROM history WHERE id = ?').get(runId)
    if (!run) return { error: 'Run not found' }

    const results = JSON.parse(run.log || '[]')
    const reportsDir = reportsDirectory()

    const timestamp = new Date(run.started_at).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const baseName = sanitize(`${run.profile_name}-${timestamp}`)

    if (format === 'csv') return exportCsv(run, results, reportsDir, baseName)
    if (format === 'html') return exportHtml(run, results, reportsDir, baseName)
    if (format === 'docx') return exportRunDocx(run, results, reportsDir, baseName)

    return { error: `Unknown format: ${format}` }
  })

  ipcMain.handle('reporter:exportSteps', async (_, profileId, scenarioId) => {
    const db = getDb()
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId)
    if (!profile) return { error: 'Profile not found' }

    const scenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenarioId)
    if (!scenario) return { error: 'Scenario not found' }

    const steps = db.prepare('SELECT * FROM steps WHERE scenario_id = ? ORDER BY sort_order').all(scenarioId)

    const dir = reportsDirectory()
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const baseName = sanitize(`${profile.name}-${scenario.name}-TestCase-${timestamp}`)

    return exportStepsDocx(profile, scenario, steps, dir, baseName)
  })

  ipcMain.handle('reporter:openTrace', async (_, tracePath) => {
    if (!tracePath) return { error: 'No trace path' }
    await shell.openPath(tracePath)
    return { ok: true }
  })

  // Build + open a standalone DevTools-style network log page for a run (the XHR/fetch calls
  // the page made). Kept separate from the step report so it can be opened on its own.
  ipcMain.handle('reporter:openNetwork', async (_, runId) => {
    const db = getDb()
    const run = db.prepare('SELECT * FROM history WHERE id = ?').get(runId)
    if (!run) return { error: 'Run not found' }
    const entries = readNetwork(run.network_path)
    if (!entries.length) return { error: 'No network log was captured for this run' }

    const dir = reportsDirectory()
    const timestamp = new Date(run.started_at).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const baseName = sanitize(`${run.profile_name}-${timestamp}-network`)
    const baseCss = `body { font-family: system-ui, sans-serif; max-width: 1100px; margin: 40px auto; color: #1a1a2e; }
      h1 { font-size: 1.4rem; margin-bottom: 4px; } .meta { color: #666; font-size: 0.85rem; margin-bottom: 20px; }`
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<title>Network — ${esc(run.profile_name)}</title><style>${baseCss}${NETWORK_CSS}</style></head>
<body><h1>Network log — ${esc(run.profile_name)}</h1>
<div class="meta">${entries.length} request${entries.length !== 1 ? 's' : ''} · ${run.started_at}</div>
${networkTableHtml(entries)}</body></html>`
    const path = join(dir, `${baseName}.html`)
    writeFileSync(path, html, 'utf-8')
    shell.openPath(path)
    return { ok: true, path }
  })
}

// Read a run's captured network.json (the XHR/fetch calls). Returns [] if absent/unreadable.
function readNetwork(networkPath) {
  if (!networkPath || !existsSync(networkPath)) return []
  try { return JSON.parse(readFileSync(networkPath, 'utf-8')) || [] } catch { return [] }
}

// Just the network-table rules — shared by the standalone page AND embedded in the step report
// (which already defines body/h1/.meta, so those are kept out of here to avoid clashing).
const NETWORK_CSS = `
  table.net { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  table.net th, table.net td { padding: 7px 10px; text-align: left; border-bottom: 1px solid #eee; vertical-align: top; }
  table.net th { background: #f3f4f6; font-weight: 600; }
  .m { font-family: monospace; font-weight: 600; }
  .u { font-family: monospace; word-break: break-all; }
  .st-ok { color: #166534; font-weight: 600; }
  .st-bad { color: #991b1b; font-weight: 600; }
  details summary { cursor: pointer; color: #4F46E5; font-size: 0.8rem; }
  pre { background: #f8fafc; padding: 8px; border-radius: 4px; overflow:auto; max-height: 240px; font-size: 0.78rem; white-space: pre-wrap; word-break: break-all; }`

// One reusable <table> of the captured calls — embedded in the run report and the standalone page.
function networkTableHtml(entries) {
  const rows = entries.map((e, i) => {
    const bad = !e.status || e.status >= 400
    const status = e.error ? `✕ ${esc(e.error)}` : e.status
    const cell = (val, label) => val
      ? `<details><summary>${label}</summary><pre>${esc(val)}</pre></details>`
      : '—'
    return `<tr>
      <td>${i + 1}</td>
      <td>${esc(e.step || '')}</td>
      <td class="m">${esc(e.method || '')}</td>
      <td class="u">${esc(e.url || '')}</td>
      <td class="${bad ? 'st-bad' : 'st-ok'}">${status}</td>
      <td>${esc(e.type || '')}</td>
      <td>${e.ms != null ? e.ms + ' ms' : '—'}</td>
      <td>${cell(e.payload, 'payload')}</td>
      <td>${cell(e.body, 'body')}</td>
    </tr>`
  }).join('')
  return `<table class="net"><thead><tr>
    <th>#</th><th>Step</th><th>Method</th><th>URL</th><th>Status</th><th>Type</th><th>Time</th><th>Payload</th><th>Response</th>
  </tr></thead><tbody>${rows}</tbody></table>`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reportsDirectory() {
  const dir = join(app.getPath('documents'), 'AutomationTool', 'Reports')
  mkdirSync(dir, { recursive: true })
  return dir
}

function sanitize(s) {
  return s.replace(/[^a-zA-Z0-9\-_]/g, '_')
}

function formatAction(action) {
  return action.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim()
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fmtDuration(ms) {
  if (!ms) return '0s'
  return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function exportCsv(run, results, dir, baseName) {
  const rows = [
    ['Step', 'Label', 'Status', 'Error'],
    ...results.map((r, i) => [i + 1, r.label, r.status, r.error || ''])
  ]
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const path = join(dir, `${baseName}.csv`)
  writeFileSync(path, csv, 'utf-8')
  shell.showItemInFolder(path)
  return { ok: true, path }
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function exportHtml(run, results, dir, baseName) {
  const appName = (() => {
    try {
      const db = getDb()
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('app_name')
      return row?.value || 'AutomationTool'
    } catch { return 'AutomationTool' }
  })()

  const rows = results.map((r, i) => `
    <tr class="${r.status}">
      <td>${i + 1}</td>
      <td>${esc(r.label || '')}</td>
      <td><span class="badge">${r.status}</span></td>
      <td>${esc(r.error || '')}</td>
      ${r.screenshot && existsSync(r.screenshot) ? `<td><img src="file://${r.screenshot.replace(/\\/g, '/')}" style="max-width:300px;border-radius:4px"/></td>` : '<td>—</td>'}
    </tr>`).join('')

  const netEntries = readNetwork(run.network_path)
  const networkSection = netEntries.length ? `
  <h2 style="font-size:1.15rem;margin:32px 0 6px">Network calls (XHR / fetch)</h2>
  <div class="meta">${netEntries.length} request${netEntries.length !== 1 ? 's' : ''} the page made to its controllers during the run.</div>
  ${networkTableHtml(netEntries)}` : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${esc(appName)} Report — ${esc(run.profile_name)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 1000px; margin: 40px auto; color: #1a1a2e; }
    h1 { font-size: 1.5rem; margin-bottom: 4px; }
    .meta { color: #666; font-size: 0.875rem; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    th { background: #f3f4f6; font-weight: 600; }
    tr.failed td { background: #fef2f2; }
    tr.passed td { background: #f0fdf4; }
    .badge { padding: 2px 10px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; }
    tr.passed .badge { background: #dcfce7; color: #166534; }
    tr.failed .badge { background: #fee2e2; color: #991b1b; }
    ${NETWORK_CSS}
  </style>
</head>
<body>
  <h1>${esc(appName)} — Test Run Report</h1>
  <div class="meta">
    Profile: <strong>${esc(run.profile_name)}</strong> &nbsp;|&nbsp;
    Status: <strong>${run.status}</strong> &nbsp;|&nbsp;
    Started: ${run.started_at} &nbsp;|&nbsp;
    Duration: ${fmtDuration(run.duration_ms)} &nbsp;|&nbsp;
    Passed: ${run.steps_passed} / ${run.steps_total}
  </div>
  <table>
    <thead><tr><th>#</th><th>Step</th><th>Status</th><th>Error</th><th>Screenshot</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${networkSection}
</body>
</html>`

  const path = join(dir, `${baseName}.html`)
  writeFileSync(path, html, 'utf-8')
  shell.openPath(path)
  return { ok: true, path }
}

// ---------------------------------------------------------------------------
// DOCX — Run Report (section per step, screenshots embedded)
// ---------------------------------------------------------------------------

async function exportRunDocx(run, results, dir, baseName) {
  const children = [
    new Paragraph({
      text: 'Test Run Report',
      heading: HeadingLevel.HEADING_1
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'Profile: ', bold: true }),
        new TextRun(run.profile_name + '   '),
        new TextRun({ text: 'Status: ', bold: true }),
        new TextRun(run.status.toUpperCase() + '   '),
        new TextRun({ text: 'Duration: ', bold: true }),
        new TextRun(fmtDuration(run.duration_ms) + '   '),
        new TextRun({ text: 'Result: ', bold: true }),
        new TextRun(`${run.steps_passed} passed / ${run.steps_failed} failed of ${run.steps_total}`)
      ]
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'Started: ', bold: true }),
        new TextRun(run.started_at)
      ]
    }),
    new Paragraph({ text: '' }),
  ]

  for (const [i, r] of results.entries()) {
    const isPassed = r.status === 'passed'
    const statusText = isPassed ? '✓ PASSED' : '✗ FAILED'

    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `Step ${i + 1}  `, bold: true, size: 24 }),
          new TextRun({ text: `${formatAction(r.action || '')}  `, color: ACCENT, bold: true, size: 24 }),
          new TextRun({
            text: statusText,
            bold: true,
            size: 24,
            color: isPassed ? PASS_FG : FAIL_FG
          })
        ],
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' }
        },
        spacing: { before: 240, after: 80 }
      })
    )

    if (r.label) {
      children.push(new Paragraph({
        children: [new TextRun({ text: r.label, size: 22 })]
      }))
    }

    if (!isPassed && r.error) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: 'Error: ', bold: true, color: FAIL_FG }),
          new TextRun({ text: r.error, color: FAIL_FG })
        ],
        spacing: { before: 60 }
      }))
    }

    if (r.screenshot && existsSync(r.screenshot)) {
      try {
        const imgData = readFileSync(r.screenshot)
        children.push(
          new Paragraph({ text: 'Screenshot:', spacing: { before: 80 } }),
          new Paragraph({
            children: [
              new ImageRun({
                type: 'png',
                data: imgData,
                transformation: { width: 560, height: 350 }
              })
            ],
            spacing: { after: 120 }
          })
        )
      } catch { /* screenshot unreadable, skip */ }
    }
  }

  const doc = new Document({ sections: [{ children }] })
  const buffer = await Packer.toBuffer(doc)
  const path = join(dir, `${baseName}.docx`)
  writeFileSync(path, buffer)
  shell.showItemInFolder(path)
  return { ok: true, path }
}

// ---------------------------------------------------------------------------
// DOCX — Test Case / Procedure Document (steps only, no run needed)
// ---------------------------------------------------------------------------

async function exportStepsDocx(profile, scenario, steps, dir, baseName) {
  const headerCells = ['#', 'Action', 'Label', 'Parameters', 'Notes', 'Expected Result'].map(h =>
    new TableCell({
      shading: { type: ShadingType.SOLID, fill: ACCENT },
      children: [new Paragraph({
        children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', size: 20 })]
      })]
    })
  )

  const stepRows = steps.map((step, i) => {
    const params = typeof step.params === 'string' ? JSON.parse(step.params) : (step.params || {})
    const notes = params._notes || ''
    const expected = params._expected || ''
    const paramText = Object.entries(params)
      .filter(([k]) => !k.startsWith('_') && params[k] !== '' && params[k] !== false)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')

    return new TableRow({
      children: [
        new TableCell({ children: [new Paragraph(String(i + 1))] }),
        new TableCell({ children: [new Paragraph(formatAction(step.action))] }),
        new TableCell({ children: [new Paragraph(step.label || '')] }),
        new TableCell({ children: [new Paragraph(paramText)] }),
        new TableCell({ children: [new Paragraph(notes)] }),
        new TableCell({ children: [new Paragraph(expected)] })
      ]
    })
  })

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: scenario.name, heading: HeadingLevel.HEADING_1 }),
        new Paragraph({
          children: [
            new TextRun({ text: 'Profile: ', bold: true }),
            new TextRun(profile.name + '   '),
            new TextRun({ text: 'Date: ', bold: true }),
            new TextRun(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) + '   '),
            new TextRun({ text: 'Total Steps: ', bold: true }),
            new TextRun(String(steps.length))
          ]
        }),
        new Paragraph({ text: '' }),
        new Table({
          rows: [new TableRow({ tableHeader: true, children: headerCells }), ...stepRows],
          width: { size: 100, type: WidthType.PERCENTAGE }
        }),
        new Paragraph({ text: '' }),
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'Generated by AutomationTool', color: '9CA3AF', size: 18 })]
        })
      ]
    }]
  })

  const buffer = await Packer.toBuffer(doc)
  const path = join(dir, `${baseName}.docx`)
  writeFileSync(path, buffer)
  shell.showItemInFolder(path)
  return { ok: true, path }
}
