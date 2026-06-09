import { ipcMain, shell } from 'electron'
import { app } from 'electron'
import { join } from 'path'
import { writeFileSync, mkdirSync } from 'fs'
import { getDb } from '../core/db'
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel } from 'docx'

export function registerReporterHandlers() {
  ipcMain.handle('reporter:export', async (_, runId, format) => {
    const db = getDb()
    const run = db.prepare('SELECT * FROM history WHERE id = ?').get(runId)
    if (!run) return { error: 'Run not found' }

    const results = JSON.parse(run.log || '[]')
    const reportsDir = join(app.getPath('documents'), 'Botchi', 'Reports')
    mkdirSync(reportsDir, { recursive: true })

    const timestamp = new Date(run.started_at).toISOString().replace(/[:.]/g, '-')
    const baseName = `${run.profile_name}-${timestamp}`

    if (format === 'csv') return exportCsv(run, results, reportsDir, baseName)
    if (format === 'html') return exportHtml(run, results, reportsDir, baseName)
    if (format === 'docx') return exportDocx(run, results, reportsDir, baseName)

    return { error: `Unknown format: ${format}` }
  })

  ipcMain.handle('reporter:openTrace', async (_, tracePath) => {
    if (!tracePath) return { error: 'No trace path' }
    await shell.openPath(tracePath)
    return { ok: true }
  })
}

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

function exportHtml(run, results, dir, baseName) {
  const rows = results.map((r, i) => `
    <tr class="${r.status}">
      <td>${i + 1}</td>
      <td>${esc(r.label)}</td>
      <td><span class="badge">${r.status}</span></td>
      <td>${esc(r.error || '')}</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Botchi Report — ${esc(run.profile_name)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 40px auto; color: #1a1a2e; }
    h1 { font-size: 1.5rem; margin-bottom: 4px; }
    .meta { color: #666; font-size: 0.875rem; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: #f3f4f6; font-weight: 600; }
    tr.failed td { background: #fef2f2; }
    tr.passed td { background: #f0fdf4; }
    .badge { padding: 2px 10px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; }
    tr.passed .badge { background: #dcfce7; color: #166534; }
    tr.failed .badge { background: #fee2e2; color: #991b1b; }
  </style>
</head>
<body>
  <h1>Botchi Test Report</h1>
  <div class="meta">
    Profile: <strong>${esc(run.profile_name)}</strong> &nbsp;|&nbsp;
    Status: <strong>${run.status}</strong> &nbsp;|&nbsp;
    Started: ${run.started_at} &nbsp;|&nbsp;
    Duration: ${((run.duration_ms || 0) / 1000).toFixed(1)}s &nbsp;|&nbsp;
    Passed: ${run.steps_passed} / ${run.steps_total}
  </div>
  <table>
    <thead><tr><th>#</th><th>Step</th><th>Status</th><th>Error</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`

  const path = join(dir, `${baseName}.html`)
  writeFileSync(path, html, 'utf-8')
  shell.openPath(path)
  return { ok: true, path }
}

async function exportDocx(run, results, dir, baseName) {
  const tableRows = [
    new TableRow({
      children: ['#', 'Step', 'Status', 'Error'].map(h =>
        new TableCell({ children: [new Paragraph({ text: h, heading: HeadingLevel.HEADING_3 })] })
      )
    }),
    ...results.map((r, i) =>
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph(String(i + 1))] }),
          new TableCell({ children: [new Paragraph(r.label || '')] }),
          new TableCell({ children: [new Paragraph(r.status)] }),
          new TableCell({ children: [new Paragraph(r.error || '')] })
        ]
      })
    )
  ]

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: 'Botchi Test Report', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ children: [new TextRun(`Profile: ${run.profile_name} | Status: ${run.status} | Started: ${run.started_at}`)] }),
        new Paragraph(''),
        new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } })
      ]
    }]
  })

  const buffer = await Packer.toBuffer(doc)
  const path = join(dir, `${baseName}.docx`)
  writeFileSync(path, buffer)
  shell.showItemInFolder(path)
  return { ok: true, path }
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
