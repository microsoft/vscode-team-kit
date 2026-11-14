#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ADO_ORG = 'https://dev.azure.com/monacotools';
const ADO_PROJECT = 'Monaco';
// The pipelines that fetch-builds.sh downloads by default, in report order. Each pipeline is
// analyzed on its own, so a red product build never breaks or fixes a CI streak.
const PIPELINE_ORDER = [727, 111];
const PIPELINE_ROLES = new Map([
  [727, 'the CI builds of main'],
  [111, 'the scheduled and manual product builds'],
]);
const NO_USABLE_BUILDS = 'every fetched build was an informational run, so fetch a larger window';
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

function isInformationalRun(run) {
  return String(run?.triggerInfo?.['ci.isInformationalRun'] ?? '').toLowerCase() === 'true';
}

function loadRuns(dataDir) {
  const runsPath = path.join(dataDir, 'runs.json');
  const allRuns = loadJson(runsPath, []);
  // Informational runs are 0-second placeholders that Azure Pipelines creates when it can't
  // evaluate a trigger. They never ran, so they say nothing about build health.
  const runs = allRuns.filter((run) => !isInformationalRun(run));
  runs.sort((left, right) => {
    const leftTime = left?.finishTime ?? '';
    const rightTime = right?.finishTime ?? '';
    return leftTime.localeCompare(rightTime);
  });
  return { allRuns, runs };
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

function pipelineLabel(section) {
  const role = PIPELINE_ROLES.get(section.pipelineId);
  const name = section.pipelineName ? ` (${section.pipelineName})` : '';
  return `Pipeline ${section.pipelineId}${name}${role ? `, ${role}` : ''}`;
}

// Groups the usable runs by pipeline. A pipeline whose fetched runs were all skipped (for example,
// informational runs) keeps an empty group, so the report shows it as UNKNOWN instead of omitting it.
function groupRunsByPipeline(allRuns, runs) {
  const groups = new Map();
  for (const run of allRuns) {
    const pipelineId = run?.definition?.id ?? 'unknown';
    if (!groups.has(pipelineId)) {
      groups.set(pipelineId, { pipelineId, pipelineName: (run?.definition?.name ?? '').trim(), runs: [] });
    }
  }
  for (const run of runs) {
    groups.get(run.definition?.id ?? 'unknown').runs.push(run);
  }

  const rank = (pipelineId) => {
    const index = PIPELINE_ORDER.indexOf(pipelineId);
    return index === -1 ? PIPELINE_ORDER.length : index;
  };
  return [...groups.values()].sort((left, right) => rank(left.pipelineId) - rank(right.pipelineId)
    || String(left.pipelineId).localeCompare(String(right.pipelineId)));
}

function analyzePipeline(dataDir, group) {
  const rows = collectBuildRows(dataDir, group.runs);
  const incidents = collectIncidents(rows);
  const summary = collectSummary(rows, incidents);
  return { ...group, rows, incidents, summary };
}

function renderTextReport(runs, sections) {
  const lines = [];
  lines.push('');
  lines.push('='.repeat(120));
  lines.push(`  BUILD HEALTH REPORT — branch: main, ${sections.map((section) => `pipeline ${section.pipelineId}`).join(', ')}`);
  lines.push(`  Range: ${fmtTime(runs.at(-1)?.finishTime)} → ${fmtTime(runs[0]?.finishTime)}`);
  lines.push(`  Total builds: ${runs.length}`);
  lines.push('='.repeat(120));

  for (const section of sections) {
    lines.push('');
    lines.push('#'.repeat(120));
    lines.push(`  ${pipelineLabel(section)}: ${section.rows.length} builds`);
    lines.push('#'.repeat(120));
    if (section.rows.length === 0) {
      lines.push('');
      lines.push(`  Current status: UNKNOWN: ${NO_USABLE_BUILDS}`);
      continue;
    }
    renderTextBuildStatus(lines, section.rows);
    renderTextIncidents(lines, section.incidents);
    renderTextSummary(lines, section.summary);
  }
  return `${lines.join('\n')}\n`;
}

function renderMarkdownBuildTable(lines, rows) {
  lines.push('| # | Build | Finished | Result | Trigger | Commit | Compare | Failure reason | First error |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const descRows = [...rows].reverse();
  descRows.forEach((row, index) => {
    lines.push(`| ${index + 1} | ${markdownLink(row.buildNumber, row.buildUrl)} | ${markdownEscape(row.finishTime)} | ${row.resultLabel} | ${markdownEscape(row.reason)} | ${row.commitUrl ? markdownLink(row.shortSha, row.commitUrl) : '-'} | ${row.compareUrl ? markdownLink('diff', row.compareUrl) : '-'} | ${markdownEscape(row.failureSummary)} | ${markdownEscape(row.firstError)} |`);
  });
  lines.push('');
}

function renderMarkdownIncidents(lines, section) {
  const { incidents, pipelineId } = section;
  if (incidents.length === 0) {
    lines.push('No break/fix transitions found.');
    lines.push('');
    return;
  }

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

  descIncidents.forEach((incident, index) => {
    const incidentNumber = index + 1;
    lines.push(`#### Pipeline ${pipelineId} incident ${incidentNumber}`);
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

function renderMarkdownTopFailureReasons(lines, summary) {
  if (summary.topFailureReasons.length === 0) {
    lines.push('No failed builds in this range.');
    lines.push('');
    return;
  }

  lines.push('| Count | Failure reason |');
  lines.push('| --- | --- |');
  for (const [reason, count] of summary.topFailureReasons) {
    lines.push(`| ${count} | ${markdownEscape(reason)} |`);
  }
  lines.push('');
}

function renderMarkdownReport(runs, sections) {
  const lines = [];
  const ongoing = sections.reduce((total, section) => total + section.summary.ongoing, 0);
  const incidentCount = sections.reduce((total, section) => total + section.incidents.length, 0);

  lines.push('# Build Health Report');
  lines.push('');
  lines.push(`- Pipelines: ${sections.map((section) => pipelineLabel(section)).join('; ')}`);
  lines.push('- Branch: main');
  lines.push(`- Range: ${fmtTime(runs.at(-1)?.finishTime)} to ${fmtTime(runs[0]?.finishTime)}`);
  lines.push(`- Total builds: ${runs.length}`);
  lines.push(`- Incidents: ${incidentCount}`);
  lines.push(`- Ongoing incidents: ${ongoing}`);
  lines.push('');

  lines.push('## Current Status');
  lines.push('');
  lines.push('| Pipeline | Status | Latest build | Latest commit | Builds | Succeeded | Failed | Partial | Ongoing incidents |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const section of sections) {
    const { summary } = section;
    const latest = summary.latest;
    lines.push(`| ${markdownEscape(pipelineLabel(section))} | ${latest ? latest.resultLabel : `UNKNOWN: ${NO_USABLE_BUILDS}`} | ${latest ? markdownLink(latest.buildNumber, latest.buildUrl) : '-'} | ${latest?.commitUrl ? markdownLink(latest.shortSha, latest.commitUrl) : '-'} | ${summary.total} | ${summary.succeeded} | ${summary.failed} | ${summary.partial} | ${summary.ongoing} |`);
  }
  lines.push('');

  lines.push('## Build Table');
  lines.push('');
  for (const section of sections) {
    lines.push(`### ${markdownEscape(pipelineLabel(section))}`);
    lines.push('');
    renderMarkdownBuildTable(lines, section.rows);
  }

  lines.push('## Incidents');
  lines.push('');
  for (const section of sections) {
    lines.push(`### ${markdownEscape(pipelineLabel(section))}`);
    lines.push('');
    renderMarkdownIncidents(lines, section);
  }

  lines.push('## Top Failure Reasons');
  lines.push('');
  for (const section of sections) {
    lines.push(`### ${markdownEscape(pipelineLabel(section))}`);
    lines.push('');
    renderMarkdownTopFailureReasons(lines, section.summary);
  }

  lines.push('## Suggested Next Step');
  lines.push('');
  const red = sections.filter((section) => section.summary.latest?.result === 'failed');
  for (const section of sections.filter((section) => section.rows.length === 0)) {
    lines.push(`- Pipeline ${section.pipelineId} status is unknown: ${NO_USABLE_BUILDS}.`);
  }
  if (red.length === 0) {
    lines.push('Use this report to identify recurring failure patterns and compare incidents across the fetched builds of each pipeline.');
  } else {
    for (const section of red) {
      lines.push(`- Pipeline ${section.pipelineId} is red. Use its incidents to confirm where the current failure pattern started. Only after that, ask the user whether to continue with commit-range culprit analysis.`);
    }
    // Only a green counterpart shows that the failure is specific to the red pipeline.
    const pairIds = sections.map((section) => section.pipelineId).sort().join(',');
    const green = sections.filter((section) => section.summary.latest?.result === 'succeeded');
    if (pairIds === '111,727' && red.length === 1 && green.length === 1) {
      lines.push('- A failure in only one pipeline points at what differs between them: the signing, publishing and release steps of the product builds (pipeline 111), or the per-suite test jobs of the CI builds (pipeline 727).');
    }
  }
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function renderReport(runs, sections, format) {
  if (format === 'markdown') {
    return renderMarkdownReport(runs, sections);
  }
  return renderTextReport(runs, sections);
}

function writeReport(output, reportPath) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, output, 'utf8');
}

function main() {
  const { dataDir, format, reportPath } = parseArgs(process.argv.slice(2));
  const { allRuns, runs } = loadRuns(dataDir);
  if (runs.length === 0) {
    // Don't leave an older report in place for the report-first workflow to read.
    const message = `No usable builds in ${path.join(dataDir, 'runs.json')} (missing, empty, or only informational runs). Fetch a larger window.`;
    if (reportPath) {
      writeReport(format === 'markdown' ? `# Build Health Report\n\n${message}\n` : `${message}\n`, reportPath);
    }
    console.error(message);
    process.exitCode = 1;
    return;
  }

  const sections = groupRunsByPipeline(allRuns, runs).map((group) => analyzePipeline(dataDir, group));
  const output = renderReport(runs, sections, format);

  if (reportPath) {
    writeReport(output, reportPath);
    console.log(`Report written to ${reportPath}`);
    return;
  }

  process.stdout.write(output);
}

main();
