#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ADO_ORG = 'https://dev.azure.com/monacotools';
const ADO_PROJECT = 'Monaco';
const PIPELINE_ID = 111;
const GH_REPO = 'microsoft/vscode';
const REPORT_FORMATS = new Set(['text', 'markdown']);

function usage(errorMessage = '') {
  if (errorMessage) {
    console.error(errorMessage);
    console.error('');
  }

  console.log(`analyze-builds.mjs - Analyze downloaded VS Code rolling build data.

Usage:
  node analyze-builds.mjs <data-dir> [--format text|markdown] [--report <path>]

Reads runs.json, timelines/*.json, and logs/*.txt from <data-dir> and produces:
  1. Per-build status with failure reasons and error excerpts
  2. Break/fix transitions (when did the build go red, when did it recover)
  3. Commits between the last green and first red build
  4. Deep links to builds and commits

Options:
  --format text|markdown  Output format (default: text)
  --report <path>         Write the rendered report to a file instead of stdout`);
  process.exit(1);
}

function parseArgs(argv) {
  let dataDir = '';
  let format = 'text';
  let reportPath = '';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (!arg.startsWith('--')) {
      if (dataDir) {
        usage(`Unexpected extra argument: ${arg}`);
      }
      dataDir = arg;
      continue;
    }

    if (arg === '--format') {
      format = argv[index + 1] ?? '';
      index += 1;
      if (!REPORT_FORMATS.has(format)) {
        usage(`Invalid --format value: ${format || '<missing>'}`);
      }
      continue;
    }

    if (arg === '--report') {
      reportPath = argv[index + 1] ?? '';
      index += 1;
      if (!reportPath) {
        usage('Missing value for --report');
      }
      continue;
    }

    usage(`Unknown option: ${arg}`);
  }

  if (!dataDir) {
    usage('Missing required <data-dir> argument');
  }

  return { dataDir, format, reportPath };
}

function loadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function loadRuns(dataDir) {
  const runsPath = path.join(dataDir, 'runs.json');
  const runs = loadJson(runsPath, []);
  runs.sort((left, right) => {
    const leftTime = left?.finishTime ?? '';
    const rightTime = right?.finishTime ?? '';
    return leftTime.localeCompare(rightTime);
  });
  return runs;
}

function extractErrorFromLog(logPath) {
  let lines;
  try {
    lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/);
  } catch {
    return '';
  }

  const cleaned = lines.map((line) => {
    const match = line.match(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*(.*)/);
    return match ? match[1] : line.trimEnd();
  });

  const boilerplate = [
    '##[error]',
    '##[section]',
    'logs are attached',
    'build summary',
    'scan through attached',
    'playwright traces',
    'published)',
  ];
  const keywords = [
    'error:',
    'assertion',
    'failed',
    'failing',
    'timed out',
    'err_assertion',
    'exception',
    'could not',
    'cannot find',
    'not found',
    'timeout',
    'segfault',
    'crash',
    'panic',
    '1 failing',
    'test failed',
  ];
  const errorSnippets = [];

  for (const [index, line] of cleaned.entries()) {
    const lowerLine = line.toLowerCase();
    if (boilerplate.some((entry) => lowerLine.includes(entry))) {
      continue;
    }
    if (!keywords.some((entry) => lowerLine.includes(entry))) {
      continue;
    }

    const start = Math.max(0, index - 2);
    const end = Math.min(cleaned.length, index + 5);
    const snippet = cleaned
      .slice(start, end)
      .filter((entry) => !boilerplate.some((bp) => entry.toLowerCase().includes(bp)))
      .join('\n');

    if (snippet.length > 20) {
      errorSnippets.push(snippet);
    }
  }

  if (errorSnippets.length > 0) {
    const best = errorSnippets.reduce((longest, current) => {
      return current.length > longest.length ? current : longest;
    });
    return best.length > 500 ? `${best.slice(0, 500)}...` : best;
  }

  return cleaned.slice(-10).join('\n').slice(0, 500);
}

function getFailedJobs(dataDir, buildId) {
  const timelinePath = path.join(dataDir, 'timelines', `${buildId}.json`);
  if (!fs.existsSync(timelinePath)) {
    return [];
  }

  const data = loadJson(timelinePath, {});
  const records = Array.isArray(data?.records) ? data.records : [];
  const idMap = new Map(records.map((record) => [record.id, record]));
  const results = [];

  for (const record of records) {
    if (record?.result !== 'failed' || record?.type !== 'Task') {
      continue;
    }

    const parent = idMap.get(record.parentId) ?? {};
    const grandparent = idMap.get(parent.parentId) ?? {};
    const errors = [];

    for (const issue of record.issues ?? []) {
      const message = issue?.message?.trim() ?? '';
      if (message && !message.includes('exited with code')) {
        errors.push(message.slice(0, 200));
      }
    }

    const logId = record?.log?.id;
    let logExcerpt = '';
    if (logId) {
      const logPath = path.join(dataDir, 'logs', `${buildId}_${logId}.txt`);
      if (fs.existsSync(logPath)) {
        logExcerpt = extractErrorFromLog(logPath);
      }
    }

    results.push({
      stage: grandparent.name ?? parent.name ?? '?',
      job: parent.name ?? '?',
      task: record.name ?? '',
      errors,
      logExcerpt,
    });
  }

  return results;
}

function fmtTime(isoString) {
  if (!isoString) {
    return '?';
  }
  return isoString.slice(0, 16).replace('T', ' ');
}

function buildUrl(buildId) {
  return `${ADO_ORG}/${ADO_PROJECT}/_build/results?buildId=${buildId}`;
}

function commitUrl(sha) {
  return `https://github.com/${GH_REPO}/commit/${sha}`;
}

function compareUrl(previousSha, currentSha) {
  return `https://github.com/${GH_REPO}/compare/${previousSha.slice(0, 12)}...${currentSha.slice(0, 12)}`;
}

function durationString(startTime, finishTime) {
  const start = new Date(startTime);
  const finish = new Date(finishTime);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(finish.valueOf())) {
    return '?';
  }
  return `${((finish - start) / 3_600_000).toFixed(1)}h`;
}

function resultIcon(result) {
  if (result === 'succeeded') {
    return '✅';
  }
  if (result === 'partiallySucceeded') {
    return '⚠️ ';
  }
  if (result === 'failed') {
    return '❌';
  }
  if (result === 'canceled') {
    return '🚫';
  }
  return '❓';
}

function resultLabel(result) {
  if (result === 'succeeded') {
    return 'SUCCESS';
  }
  if (result === 'partiallySucceeded') {
    return 'PARTIAL';
  }
  if (result === 'failed') {
    return 'FAILED';
  }
  if (result === 'canceled') {
    return 'CANCELED';
  }
  return 'UNKNOWN';
}

function singleLine(value, maxLength = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '-';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function markdownEscape(value) {
  return singleLine(value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function markdownLink(label, url) {
  return `[${label}](${url})`;
}

function groupFailures(failures) {
  const grouped = new Map();

  for (const failure of failures) {
    const key = `${failure.stage} / ${failure.job}`;
    const tasks = grouped.get(key) ?? [];
    tasks.push(failure);
    grouped.set(key, tasks);
  }

  return [...grouped.entries()]
    .map(([key, tasks]) => ({ key, tasks }))
    .sort((left, right) => {
      if (right.tasks.length !== left.tasks.length) {
        return right.tasks.length - left.tasks.length;
      }
      return left.key.localeCompare(right.key);
    });
}

function getFirstError(failures) {
  for (const failure of failures) {
    if (failure.logExcerpt) {
      return singleLine(failure.logExcerpt);
    }
    if (failure.errors.length > 0) {
      return singleLine(failure.errors[0]);
    }
  }
  return '-';
}

function summarizeFailures(failures) {
  const groupedEntries = groupFailures(failures);
  const failureSummary = groupedEntries.length > 0
    ? groupedEntries.slice(0, 2).map((entry) => entry.key).join('; ')
    : '-';

  return {
    groupedEntries,
    failureSummary,
    firstError: getFirstError(failures),
  };
}

function collectBuildRows(dataDir, runs) {
  const rows = [];
  let previousSourceVersion = '';

  for (const run of runs) {
    const failures = run.result === 'failed' || run.result === 'partiallySucceeded'
      ? getFailedJobs(dataDir, run.id)
      : [];
    const analysis = summarizeFailures(failures);
    const sourceVersion = run.sourceVersion ?? '';
    const row = {
      id: run.id,
      buildNumber: run.buildNumber ?? '?',
      buildUrl: buildUrl(run.id),
      result: run.result ?? 'unknown',
      resultLabel: resultLabel(run.result),
      reason: run.reason ?? '?',
      startTime: run.startTime ?? '',
      finishTime: fmtTime(run.finishTime),
      finishTimeIso: run.finishTime ?? '',
      sourceVersion,
      shortSha: sourceVersion ? sourceVersion.slice(0, 10) : '',
      commitUrl: sourceVersion ? commitUrl(sourceVersion) : '',
      compareUrl: previousSourceVersion && sourceVersion && previousSourceVersion !== sourceVersion
        ? compareUrl(previousSourceVersion, sourceVersion)
        : '',
      failures,
      analysis,
      failureSummary: analysis.failureSummary,
      firstError: analysis.firstError,
    };
    rows.push(row);
    previousSourceVersion = sourceVersion;
  }

  return rows;
}

function finalizeIncident(incident) {
  const failureReasons = new Map();

  for (const row of incident.redRows) {
    for (const entry of row.analysis.groupedEntries) {
      failureReasons.set(entry.key, (failureReasons.get(entry.key) ?? 0) + entry.tasks.length);
    }
  }

  const brokeRow = incident.brokeRow;
  const fixedRow = incident.fixedRow ?? null;
  const previousGreenRow = incident.previousGreenRow ?? null;
  const compareRange = previousGreenRow?.sourceVersion && brokeRow.sourceVersion && previousGreenRow.sourceVersion !== brokeRow.sourceVersion
    ? compareUrl(previousGreenRow.sourceVersion, brokeRow.sourceVersion)
    : '';

  return {
    brokeRow,
    fixedRow,
    previousGreenRow,
    brokeTime: brokeRow.finishTime,
    fixedTime: fixedRow ? fixedRow.finishTime : 'STILL RED',
    duration: fixedRow ? durationString(brokeRow.startTime, fixedRow.finishTimeIso) : 'ongoing',
    failureReasons: [...failureReasons.entries()].sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    }),
    firstError: brokeRow.firstError,
    compareUrl: compareRange,
    buildCount: incident.redRows.length,
  };
}

function collectIncidents(rows) {
  const incidents = [];
  let currentIncident = null;

  rows.forEach((row, index) => {
    const isRed = row.result === 'failed';
    const previousRow = index > 0 ? rows[index - 1] : null;

    if (isRed) {
      if (!currentIncident) {
        currentIncident = {
          previousGreenRow: previousRow && previousRow.result !== 'failed' ? previousRow : null,
          brokeRow: row,
          redRows: [row],
          fixedRow: null,
        };
      } else {
        currentIncident.redRows.push(row);
      }
      return;
    }

    if (!currentIncident) {
      return;
    }

    currentIncident.fixedRow = row;
    incidents.push(finalizeIncident(currentIncident));
    currentIncident = null;
  });

  if (currentIncident) {
    incidents.push(finalizeIncident(currentIncident));
  }

  return incidents;
}

function collectSummary(rows, incidents) {
  const counts = new Map();
  const topFailureReasons = new Map();

  for (const row of rows) {
    counts.set(row.result, (counts.get(row.result) ?? 0) + 1);
    if (row.result === 'succeeded') {
      continue;
    }
    for (const entry of row.analysis.groupedEntries) {
      topFailureReasons.set(entry.key, (topFailureReasons.get(entry.key) ?? 0) + entry.tasks.length);
    }
  }

  return {
    total: rows.length,
    succeeded: counts.get('succeeded') ?? 0,
    failed: counts.get('failed') ?? 0,
    partial: counts.get('partiallySucceeded') ?? 0,
    canceled: counts.get('canceled') ?? 0,
    incidentCount: incidents.length,
    ongoing: incidents.filter((incident) => !incident.fixedRow).length,
    latest: rows.at(-1) ?? null,
    topFailureReasons: [...topFailureReasons.entries()].sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    }).slice(0, 10),
  };
}

function renderTextBuildStatus(lines, rows) {
  lines.push('');
  lines.push('━'.repeat(120));
  lines.push('  PER-BUILD STATUS (newest → oldest)');
  lines.push('━'.repeat(120));

  const descRows = [...rows].reverse();
  for (const row of descRows) {
    lines.push('');
    lines.push(`  ${resultIcon(row.result)} ${row.buildNumber.padEnd(35)} ${row.finishTime}  (${row.reason})`);
    lines.push(`     Build: ${row.buildUrl}`);

    if (row.sourceVersion) {
      lines.push(`     Commit: ${row.shortSha}  ${row.commitUrl}`);
      if (row.compareUrl) {
        lines.push(`     Changes: ${row.compareUrl}`);
      }
    }

    if (row.result === 'failed' || row.result === 'partiallySucceeded') {
      for (const entry of row.analysis.groupedEntries) {
        lines.push(`     ┌─ FAILED: ${entry.key}`);
        for (const task of entry.tasks) {
          lines.push(`     │  Task: ${task.task}`);
          for (const error of task.errors) {
            lines.push(`     │  ⚠ ${error}`);
          }
          if (task.logExcerpt) {
            for (const line of task.logExcerpt.split('\n').slice(0, 8)) {
              lines.push(`     │    ${line}`);
            }
          }
        }
        lines.push('     └─');
      }
    }
  }
}

function renderTextIncidents(lines, incidents) {
  lines.push('');
  lines.push('━'.repeat(120));
  lines.push('  BREAK / FIX TRANSITIONS (newest → oldest)');
  lines.push('━'.repeat(120));
  lines.push('');

  if (incidents.length === 0) {
    lines.push('  No break/fix transitions found.');
    return;
  }

  const descIncidents = [...incidents].reverse();
  for (const [index, incident] of descIncidents.entries()) {
    const incidentNumber = index + 1;
    lines.push(`  ╔══ Incident #${incidentNumber}${incident.fixedRow ? '' : '  🔴 ONGOING'}`);
    lines.push('  ║');
    lines.push(`  ║ BROKE: ${incident.brokeTime}  build ${incident.brokeRow.buildNumber}`);
    lines.push(`  ║        ${incident.brokeRow.buildUrl}`);
    if (incident.brokeRow.commitUrl) {
      lines.push(`  ║        Commit: ${incident.brokeRow.commitUrl}`);
    }

    lines.push('  ║');
    if (incident.fixedRow) {
      lines.push(`  ║ FIXED: ${incident.fixedTime}  build ${incident.fixedRow.buildNumber}`);
      lines.push(`  ║        ${incident.fixedRow.buildUrl}`);
      if (incident.fixedRow.commitUrl) {
        lines.push(`  ║        Commit: ${incident.fixedRow.commitUrl}`);
      }
    } else {
      lines.push('  ║ FIXED: STILL RED');
    }

    lines.push('  ║');
    lines.push(`  ║ Duration: ${incident.duration}  (${incident.buildCount} consecutive red build${incident.buildCount === 1 ? '' : 's'})`);
    if (incident.compareUrl) {
      lines.push(`  ║ Compare: ${incident.compareUrl}`);
    }
    if (incident.failureReasons.length > 0) {
      lines.push('  ║ Failed stages:');
      for (const [reason, count] of incident.failureReasons.slice(0, 5)) {
        lines.push(`  ║   • ${reason} (×${count})`);
      }
    }
    if (incident.firstError && incident.firstError !== '-') {
      lines.push(`  ║ First error: ${incident.firstError}`);
    }
    lines.push(`  ╚${'═'.repeat(100)}`);
    lines.push('');
  }
}

function renderTextSummary(lines, summary) {
  lines.push('━'.repeat(120));
  lines.push('  SUMMARY');
  lines.push('━'.repeat(120));
  lines.push('');
  lines.push(`  Total builds:    ${summary.total}`);
  lines.push(`  ✅ Succeeded:     ${summary.succeeded}`);
  lines.push(`  ❌ Failed:        ${summary.failed}`);
  lines.push(`  ⚠️  Partial:       ${summary.partial}`);
  if (summary.canceled > 0) {
    lines.push(`  🚫 Canceled:      ${summary.canceled}`);
  }
  lines.push(`  Total incidents: ${summary.incidentCount}`);
  if (summary.ongoing > 0) {
    lines.push(`  🔴 Ongoing:       ${summary.ongoing}`);
  }
  if (summary.topFailureReasons.length > 0) {
    lines.push('');
    lines.push('  Top failure reasons:');
    for (const [reason, count] of summary.topFailureReasons) {
      lines.push(`    ${String(count).padStart(3)}× ${reason}`);
    }
  }
  if (summary.latest) {
    lines.push('');
    lines.push(`  Current status: ${summary.latest.resultLabel}`);
    lines.push(`  Latest build:   ${summary.latest.buildNumber}  ${summary.latest.buildUrl}`);
  }
}

function renderTextReport(runs, rows, incidents, summary) {
  const lines = [];
  lines.push('');
  lines.push('='.repeat(120));
  lines.push(`  BUILD HEALTH REPORT — Pipeline ${PIPELINE_ID}, branch: main`);
  lines.push(`  Range: ${fmtTime(runs.at(-1)?.finishTime)} → ${fmtTime(runs[0]?.finishTime)}`);
  lines.push(`  Total builds: ${rows.length}`);
  lines.push('='.repeat(120));

  renderTextBuildStatus(lines, rows);
  renderTextIncidents(lines, incidents);
  renderTextSummary(lines, summary);
  return `${lines.join('\n')}\n`;
}

function renderMarkdownReport(runs, rows, incidents, summary) {
  const lines = [];
  const latest = summary.latest;
  const currentStatus = latest ? latest.resultLabel : 'UNKNOWN';

  lines.push('# Build Health Report');
  lines.push('');
  lines.push(`- Pipeline: ${PIPELINE_ID}`);
  lines.push('- Branch: main');
  lines.push(`- Range: ${fmtTime(runs.at(-1)?.finishTime)} to ${fmtTime(runs[0]?.finishTime)}`);
  lines.push(`- Total builds: ${summary.total}`);
  lines.push(`- Incidents: ${incidents.length}`);
  lines.push(`- Ongoing incidents: ${summary.ongoing}`);
  lines.push('');

  lines.push('## Current Status');
  lines.push('');
  lines.push('| Status | Latest build | Latest commit | Ongoing incidents |');
  lines.push('| --- | --- | --- | --- |');
  lines.push(`| ${currentStatus} | ${latest ? markdownLink(latest.buildNumber, latest.buildUrl) : '-'} | ${latest?.commitUrl ? markdownLink(latest.shortSha, latest.commitUrl) : '-'} | ${summary.ongoing} |`);
  lines.push('');

  lines.push('## Build Table');
  lines.push('');
  lines.push('| # | Build | Finished | Result | Trigger | Commit | Compare | Failure reason | First error |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const descRows = [...rows].reverse();
  descRows.forEach((row, index) => {
    lines.push(`| ${index + 1} | ${markdownLink(row.buildNumber, row.buildUrl)} | ${markdownEscape(row.finishTime)} | ${row.resultLabel} | ${markdownEscape(row.reason)} | ${row.commitUrl ? markdownLink(row.shortSha, row.commitUrl) : '-'} | ${row.compareUrl ? markdownLink('diff', row.compareUrl) : '-'} | ${markdownEscape(row.failureSummary)} | ${markdownEscape(row.firstError)} |`);
  });
  lines.push('');

  lines.push('## Incidents');
  lines.push('');
  if (incidents.length === 0) {
    lines.push('No break/fix transitions found.');
    lines.push('');
  } else {
    lines.push('| Incident | Status | First red build | Fixed by | Duration | Failure pattern | Compare |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    const descIncidents = [...incidents].reverse();
    descIncidents.forEach((incident, index) => {
      const incidentNumber = index + 1;
      const fixedCell = incident.fixedRow
        ? `${markdownLink(incident.fixedRow.buildNumber, incident.fixedRow.buildUrl)} (${markdownEscape(incident.fixedTime)})`
        : 'STILL RED';
      const failurePattern = incident.failureReasons.length > 0
        ? incident.failureReasons
          .slice(0, 3)
          .map(([reason, count]) => (count > 1 ? `${reason} x${count}` : reason))
          .join('; ')
        : '-';
      lines.push(`| ${incidentNumber} | ${incident.fixedRow ? 'RESOLVED' : 'ONGOING'} | ${markdownLink(incident.brokeRow.buildNumber, incident.brokeRow.buildUrl)} (${markdownEscape(incident.brokeTime)}) | ${fixedCell} | ${markdownEscape(incident.duration)} | ${markdownEscape(failurePattern)} | ${incident.compareUrl ? markdownLink('compare', incident.compareUrl) : '-'} |`);
    });
    lines.push('');

    lines.push('### Incident Details');
    lines.push('');
    descIncidents.forEach((incident, index) => {
      const incidentNumber = index + 1;
      lines.push(`#### Incident ${incidentNumber}`);
      lines.push('');
      lines.push(`- Status: ${incident.fixedRow ? 'Resolved' : 'Ongoing'}`);
      lines.push(`- First red build: ${markdownLink(incident.brokeRow.buildNumber, incident.brokeRow.buildUrl)} at ${incident.brokeTime}`);
      lines.push(`- Consecutive red builds: ${incident.buildCount}`);
      if (incident.compareUrl) {
        lines.push(`- Compare range: ${markdownLink('last green to first red', incident.compareUrl)}`);
      }
      if (incident.firstError && incident.firstError !== '-') {
        lines.push(`- First error: ${markdownEscape(incident.firstError)}`);
      }
      lines.push('');
    });
  }

  lines.push('## Top Failure Reasons');
  lines.push('');
  if (summary.topFailureReasons.length === 0) {
    lines.push('No failed builds in this range.');
    lines.push('');
  } else {
    lines.push('| Count | Failure reason |');
    lines.push('| --- | --- |');
    for (const [reason, count] of summary.topFailureReasons) {
      lines.push(`| ${count} | ${markdownEscape(reason)} |`);
    }
    lines.push('');
  }

  lines.push('## Suggested Next Step');
  lines.push('');
  if (latest?.result === 'failed') {
    lines.push('Use this report to confirm where the current failure pattern started. Only after that, ask the user whether to continue with commit-range culprit analysis.');
  } else {
    lines.push('Use this report to identify recurring failure patterns and compare incidents across the last 100 builds.');
  }
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function renderReport(runs, rows, incidents, summary, format) {
  if (format === 'markdown') {
    return renderMarkdownReport(runs, rows, incidents, summary);
  }
  return renderTextReport(runs, rows, incidents, summary);
}

function writeReport(output, reportPath) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, output, 'utf8');
}

function main() {
  const { dataDir, format, reportPath } = parseArgs(process.argv.slice(2));
  const runs = loadRuns(dataDir);
  if (runs.length === 0) {
    console.log('No builds found.');
    return;
  }

  const rows = collectBuildRows(dataDir, runs);
  const incidents = collectIncidents(rows);
  const summary = collectSummary(rows, incidents);
  const output = renderReport(runs, rows, incidents, summary, format);

  if (reportPath) {
    writeReport(output, reportPath);
    console.log(`Report written to ${reportPath}`);
    return;
  }

  process.stdout.write(output);
}

main();