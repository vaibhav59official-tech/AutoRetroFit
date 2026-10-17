/**
 * @file report.ts
 * @description Extent-Reports interactive HTML, Markdown, and JSON report generator.
 * @usage Called via `writeReport(root, report)` at the conclusion of retrofit and verify workflows.
 * @responsibilities Formats and writes standalone offline Extent HTML dashboard (`report.html`),
 *                   summary markdown (`report.md`), and raw structured data (`report.json`).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunReport } from './domain.js';

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function generateExtentHtml(report: RunReport): string {
  const fw = report.framework;
  const feasibility = report.feasibility;
  const plan = report.plan;
  const reusedCount = plan.mappings.filter(x => x.action === 'REUSE').length;
  const newCount = plan.mappings.filter(x => x.action === 'NEW').length;
  const reviewCount = plan.mappings.filter(x => x.action === 'MANUAL_REVIEW').length;
  const totalSteps = report.workflowAnalysis?.steps.length ?? plan.mappings.length;
  const score = feasibility.score;
  const statusColor = score >= 80 ? '#28a745' : score >= 50 ? '#ffc107' : '#dc3545';
  const execStatus = report.execution?.status ?? 'NOT_RUN';
  const execColor = execStatus === 'PASS' ? '#28a745' : execStatus === 'FAIL' ? '#dc3545' : '#6c757d';

  const rows = (report.workflowAnalysis?.steps ?? []).map((step, idx) => {
    const mapping = plan.mappings.find(m => m.requirement === step.requiredCapability);
    const action = mapping?.action ?? 'UNKNOWN';
    const actionBadge = action === 'REUSE'
      ? '<span class="badge badge-success">REUSE</span>'
      : action === 'NEW'
        ? '<span class="badge badge-warning">NEW STUB</span>'
        : '<span class="badge badge-danger">MANUAL REVIEW</span>';
    const target = mapping?.target ? `<code>${escapeHtml(mapping.target)}</code>` : '<span class="text-muted">-</span>';
    const conf = mapping ? `${Math.round(mapping.confidence * 100)}%` : '-';
    const files = (mapping?.evidence ?? []).flatMap(e => e.files).join(', ');

    return `
      <tr>
        <td><strong>#${idx + 1}</strong></td>
        <td><span class="step-intent">${escapeHtml(step.intent)}</span></td>
        <td>${escapeHtml(step.text)}</td>
        <td><code>${escapeHtml(step.requiredCapability)}</code></td>
        <td>${actionBadge}</td>
        <td>${target}</td>
        <td>${conf}</td>
        <td><small class="text-muted">${escapeHtml(files || 'Heuristic')}</small></td>
      </tr>
    `;
  }).join('');

  const createdFiles = (report.patch?.filesToCreate ?? []).map(f => `
    <div class="file-card">
      <div class="file-header"><span class="badge badge-primary">CREATE</span> <code>${escapeHtml(f.path)}</code></div>
      <pre class="code-preview"><code>${escapeHtml(f.content)}</code></pre>
    </div>
  `).join('');

  const modifiedFiles = (report.patch?.filesToModify ?? []).map(f => `
    <div class="file-card">
      <div class="file-header"><span class="badge badge-warning">MODIFY</span> <code>${escapeHtml(f.path)}</code></div>
      <pre class="code-preview"><code>${escapeHtml(f.content)}</code></pre>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AutoRetrofit Extent Report - ${escapeHtml(report.workflow)}</title>
  <style>
    :root {
      --bg-main: #0f172a;
      --bg-card: #1e293b;
      --bg-card-hover: #334155;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --border: #334155;
      --primary: #38bdf8;
      --success: #22c55e;
      --warning: #f59e0b;
      --danger: #ef4444;
      --accent: #818cf8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg-main);
      color: var(--text-main);
      line-height: 1.5;
      padding: 0;
    }
    .navbar {
      background: #020617;
      border-bottom: 1px solid var(--border);
      padding: 16px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .brand { font-size: 1.3rem; font-weight: 700; color: var(--primary); letter-spacing: 0.5px; }
    .brand span { color: var(--text-main); font-weight: 400; }
    .meta-pills { display: flex; gap: 8px; align-items: center; }
    .pill {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 9999px;
      padding: 4px 12px;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .container { max-width: 1400px; margin: 24px auto; padding: 0 24px; }
    .dashboard-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .card-title { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }
    .card-value { font-size: 2rem; font-weight: 700; }
    .card-desc { font-size: 0.85rem; color: var(--text-muted); }
    .section-title {
      font-size: 1.25rem;
      font-weight: 600;
      margin: 32px 0 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--bg-card);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 24px;
    }
    th, td {
      padding: 12px 16px;
      text-align: left;
      border-bottom: 1px solid var(--border);
      font-size: 0.9rem;
    }
    th {
      background: #020617;
      color: var(--text-muted);
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.5px;
    }
    tr:hover { background: var(--bg-card-hover); }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-success { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid #22c55e; }
    .badge-warning { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid #f59e0b; }
    .badge-danger { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid #ef4444; }
    .badge-primary { background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid #0284c7; }
    .step-intent {
      background: #020617;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-family: monospace;
      color: var(--accent);
    }
    code {
      font-family: Consolas, Monaco, "Andale Mono", monospace;
      background: #020617;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.85rem;
      color: var(--primary);
    }
    .file-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 16px;
      overflow: hidden;
    }
    .file-header {
      padding: 12px 16px;
      background: #020617;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .code-preview {
      padding: 16px;
      background: #0f172a;
      overflow-x: auto;
      font-family: Consolas, Monaco, monospace;
      font-size: 0.85rem;
      color: #e2e8f0;
      max-height: 400px;
    }
    .footer {
      text-align: center;
      padding: 32px 0;
      color: var(--text-muted);
      font-size: 0.85rem;
      border-top: 1px solid var(--border);
      margin-top: 48px;
    }
  </style>
</head>
<body>
  <div class="navbar">
    <div class="brand">AutoRetrofit <span>Extent Report</span></div>
    <div class="meta-pills">
      <div class="pill">Run: <code>${escapeHtml(report.runId)}</code></div>
      <div class="pill">Framework: <strong>${escapeHtml(fw.bddFramework ?? fw.testRunner ?? fw.language)}</strong></div>
      <div class="pill">Language: <strong>${escapeHtml(fw.language)}</strong></div>
      <div class="pill">${escapeHtml(new Date(report.timestamp).toLocaleString())}</div>
    </div>
  </div>

  <div class="container">
    <div class="dashboard-grid">
      <div class="card">
        <div class="card-title">Suitability Score</div>
        <div class="card-value" style="color: ${statusColor};">${score} / 100</div>
        <div class="card-desc">${escapeHtml(feasibility.recommendation)}</div>
      </div>
      <div class="card">
        <div class="card-title">Total Steps</div>
        <div class="card-value">${totalSteps}</div>
        <div class="card-desc">${reusedCount} reused · ${newCount} new stubs</div>
      </div>
      <div class="card">
        <div class="card-title">Discovered Capabilities</div>
        <div class="card-value">${feasibility.matchedCapabilities.length} / ${feasibility.requiredCapabilities.length}</div>
        <div class="card-desc">Coverage: ${Math.round((feasibility.matchedCapabilities.length / Math.max(1, feasibility.requiredCapabilities.length)) * 100)}%</div>
      </div>
      <div class="card">
        <div class="card-title">Execution Status</div>
        <div class="card-value" style="color: ${execColor}; font-size: 1.5rem; padding-top: 6px;">${execStatus}</div>
        <div class="card-desc">${escapeHtml(report.evidenceStatus)}</div>
      </div>
    </div>

    <div class="section-title">Workflow Execution & Step Mappings</div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Intent</th>
          <th>Workflow Step</th>
          <th>Required Capability</th>
          <th>Action</th>
          <th>Bound Method</th>
          <th>Confidence</th>
          <th>Evidence Source</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <div class="section-title">Framework Architecture & Conventions</div>
    <div class="card" style="margin-bottom: 24px;">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 0.9rem;">
        <div><strong>Primary Language:</strong> ${escapeHtml(fw.language)}</div>
        <div><strong>Build Tool:</strong> ${escapeHtml(fw.buildTool)}</div>
        <div><strong>Test Framework:</strong> ${escapeHtml(fw.bddFramework ?? fw.testRunner ?? 'standard')}</div>
        <div><strong>UI Automation:</strong> ${escapeHtml(fw.uiFramework ?? 'none')}</div>
        <div><strong>Design Pattern:</strong> ${escapeHtml(fw.architecturePattern)}</div>
        <div><strong>Target Command:</strong> <code>${escapeHtml(plan.targetedCommand ? `${plan.targetedCommand.executable} ${plan.targetedCommand.args.join(' ')}` : 'None')}</code></div>
      </div>
    </div>

    ${createdFiles || modifiedFiles ? `
      <div class="section-title">Generated Test Scaffolding & Code Patches</div>
      ${createdFiles}
      ${modifiedFiles}
    ` : ''}

    <div class="footer">
      Generated by <strong>AutoRetrofit</strong> · Interactive Extent Report · Openable in Integrated or External Browsers
    </div>
  </div>
</body>
</html>`;
}

export async function writeReport(root: string, report: RunReport): Promise<{ markdown: string; json: string; html: string }> {
  const dir = join(root, '.autoretofit', 'runs', report.runId);
  await mkdir(dir, { recursive: true });
  const json = join(dir, 'report.json');
  const markdown = join(dir, 'report.md');
  const html = join(dir, 'report.html');

  await writeFile(json, JSON.stringify(report, null, 2));

  const mdContent = `# AutoRetrofit Report

- Workflow: ${report.workflow}
- Recommendation: **${report.feasibility.recommendation}**
- Suitability: **${report.feasibility.score}/100 (HEURISTIC)**
- Evidence status: **${report.evidenceStatus}**
- Reused mappings: ${report.plan.mappings.filter(x => x.action === 'REUSE').length}
- New files: ${report.patch?.filesToCreate.length ?? report.plan.filesToCreate.length}
- Dependencies added: ${report.patch?.dependenciesAdded.length ?? 0}
- Execution: ${report.execution?.status ?? 'NOT RUN'}

## Evidence
${report.feasibility.reasons.map(x => `- ${x}`).join('\n')}

## Reuse
${report.plan.mappings.map(x => `- ${x.requirement}: **${x.action}**${x.target ? ` → ${x.target}` : ''} (${x.confidence.toFixed(2)})`).join('\n')}
`;

  await writeFile(markdown, mdContent);

  const htmlContent = generateExtentHtml(report);
  await writeFile(html, htmlContent);

  return { markdown, json, html };
}
