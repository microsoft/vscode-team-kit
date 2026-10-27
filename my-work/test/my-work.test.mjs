// Copyright (c) Microsoft Corporation. Licensed under the MIT license.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Point every module at a throwaway Copilot home before importing them; they read it at load time.
const home = mkdtempSync(path.join(os.tmpdir(), 'my-work-test-'));
const board = path.join(home, 'project-boards');
mkdirSync(board, { recursive: true });
writeFileSync(path.join(board, 'my-work.config.json'), JSON.stringify({
	dataDir: path.join(home, 'data'),
	repoPaths: { 'octo/app': '~/src/app' },
	msrc: { fixWorkflow: 'Use the secure-fix skill in the private fork.' },
}));
process.env.COPILOT_HOME = home;
test.after(() => rmSync(home, { recursive: true, force: true }));

const ext = new URL('../com.github.copilot/extensions/my-work/', import.meta.url);
const scripts = fileURLToPath(new URL('../skills/my-issues/scripts/', import.meta.url));
const config = await import(new URL('lib/config.mjs', ext));
const prompts = await import(new URL('lib/prompts.mjs', ext));
const data = await import(new URL('lib/data.mjs', ext));
const msrc = await import(new URL('lib/msrcItems.mjs', ext));
const workSessions = await import(new URL('lib/workSessions.mjs', ext));

test('config overlays the user file on the defaults', () => {
	const c = config.config();
	assert.equal(c.planRepo, 'microsoft/vscode');
	assert.deepEqual(c.repoPaths, { 'microsoft/vscode': '~/work/vscode', 'octo/app': '~/src/app' });
	assert.equal(c.msrc.enabled, true);
	assert.equal(config.dataDir(), path.join(home, 'data'));
	assert.equal(existsSync(config.SCRIPT), true, 'helper script resolves inside the plugin');
});

test('Python and JS configs share their defaults', () => {
	const out = execFileSync('python3', ['-c', 'import json, my_work_config as c; print(json.dumps({k: c.DEFAULTS[k] for k in ["org", "planRepo", "repoPaths", "sweeperRepo"]}))'], { cwd: scripts, env: { ...process.env, COPILOT_HOME: home, PYTHONDONTWRITEBYTECODE: '1' } });
	const py = JSON.parse(String(out));
	for (const key of Object.keys(py)) {
		assert.deepEqual(py[key], config.DEFAULTS[key], key);
	}
});

test('session and IcM references are parsed strictly', () => {
	assert.equal(workSessions.parseSessionRef('agent-host-session://ahp-session/0add0440-c947-4b28-8a0d-f82937655e11'), '0add0440-c947-4b28-8a0d-f82937655e11');
	assert.equal(workSessions.parseSessionRef('copilotcli:/0add0440-c947-4b28-8a0d-f82937655e11'), '0add0440-c947-4b28-8a0d-f82937655e11');
	assert.equal(workSessions.parseSessionRef('https://example.com/x'), null);
	assert.equal(msrc.parseIncident('https://portal.microsofticm.com/imp/v5/incidents/details/31000000000001/summary'), '31000000000001');
	assert.equal(msrc.parseIncident('IcM 31000000000001'), '31000000000001');
	assert.equal(msrc.parseIncident('#123'), null);
});

test('my priorities keep their order locally', async () => {
	await data.updatePriorities({ op: 'add', key: 'octo/app#1' });
	await data.updatePriorities({ op: 'add', key: 'octo/app#2' });
	await data.updatePriorities({ op: 'add', key: 'octo/app#3', to: 'top' });
	await data.updatePriorities({ op: 'move', key: 'octo/app#2', to: 'up' });
	assert.deepEqual((await data.getPriorities()).map(p => p.key), ['octo/app#3', 'octo/app#2', 'octo/app#1']);
	await data.updatePriorities({ op: 'remove', key: 'octo/app#3' });
	assert.deepEqual((await data.getPriorities()).map(p => p.key), ['octo/app#2', 'octo/app#1']);
});

test('MSRC items stay private to the user', async () => {
	await msrc.saveMsrcItem({ incidentId: '31000000000001', link: '', title: 'Test', description: 'secret', resolveBy: '2026-11-01' });
	assert.equal((await msrc.listMsrcItems()).length, 1);
	if (process.platform !== 'win32') {
		assert.equal(statSync(path.join(home, 'data', 'msrc-items.json')).mode & 0o077, 0, 'no group/other access');
	}
	await msrc.removeMsrcItem('31000000000001');
	assert.deepEqual(await msrc.listMsrcItems(), []);
});

test('prompts use the config, not one person\'s setup', () => {
	const texts = [
		prompts.implementPrompt({ issue: { key: 'octo/app#7', title: 't', url: 'u', area: 'a' }, review: {}, readiness: {} }),
		prompts.notificationTriagePrompt({ items: [] }),
		prompts.issueRulesPrompt({ items: [] }),
		prompts.workSessionPrompt({ key: 'octo/app#7', title: 't', url: 'u' }),
	].join('\n').replaceAll(os.homedir(), '~');
	assert.match(texts, /octo\/app → ~\/src\/app/);
	assert.ok(texts.includes(config.SCRIPT.replaceAll(os.homedir(), '~')), 'refers to the bundled helper script');
	assert.doesNotMatch(texts, /sandy081|\.agents\/skills|rules? \d/);
	const security = prompts.msrcItemSessionPrompt({ incidentId: '1', link: 'l', title: 't', description: 'd' });
	assert.match(security, /secure-fix skill in the private fork/);
	assert.match(security, /Never use the public repository/);
});
