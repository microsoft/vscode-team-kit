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
	repoPaths: { 'octo/app': path.join(home, 'src', 'app'), 'octo/missing': '~/no/such/clone' },
	msrc: { fixWorkflow: 'Use the secure-fix skill in the private fork.' },
}));
process.env.COPILOT_HOME = home;
mkdirSync(path.join(home, 'src', 'app'), { recursive: true });
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
	assert.equal(c.repoPaths['octo/app'], path.join(home, 'src', 'app'));
	assert.equal(config.repoPath('octo/app'), path.join(home, 'src', 'app'));
	assert.equal(config.repoPath('octo/missing'), null, 'clones that do not exist are ignored');
	assert.equal(c.msrc.enabled, true);
	assert.equal(config.dataDir(), path.join(home, 'data'));
	assert.equal(existsSync(config.SCRIPT), true, 'helper script resolves inside the plugin');
});

test('Python and JS configs share their defaults', () => {
	const out = execFileSync('python3', ['-c', 'import json, my_work_config as c; print(json.dumps({k: c.DEFAULTS[k] for k in ["org", "planRepo", "repoPaths", "sweeperRepo", "rulesFile", "memoryFile"]}))'], { cwd: scripts, env: { ...process.env, COPILOT_HOME: home, PYTHONDONTWRITEBYTECODE: '1' } });
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
	assert.ok(texts.includes(`octo/app → ${path.join(home, 'src', 'app')}`.replaceAll(os.homedir(), '~')));
	assert.doesNotMatch(texts, /octo\/missing/);
	assert.ok(existsSync(config.PRINCIPLES), 'bundled triage principles exist');
	assert.ok(texts.includes(config.PRINCIPLES.replaceAll(os.homedir(), '~')), 'triage prompts apply the principles');
	assert.match(texts, /github-inbox-memory\.md/, 'triage prompts read the inbox memory');
	assert.ok(texts.includes(config.SCRIPT.replaceAll(os.homedir(), '~')), 'refers to the bundled helper script');
	assert.doesNotMatch(texts, /sandy081|\.agents\/skills|rules? \d/);
	const security = prompts.msrcItemSessionPrompt({ incidentId: '1', link: 'l', title: 't', description: 'd' });
	assert.match(security, /secure-fix skill in the private fork/);
	assert.match(security, /Never use the public repository/);
});

test('find-clones reads local clones from the session store', { skip: process.platform === 'win32' }, () => {
	const fakeHome = mkdtempSync(path.join(os.tmpdir(), 'my-work-clones-'));
	try {
		const clone = path.join(fakeHome, 'src', 'app');
		mkdirSync(clone, { recursive: true });
		execFileSync('git', ['init', '-q', clone]);
		execFileSync('git', ['-C', clone, 'remote', 'add', 'origin', 'https://github.com/Octo/App.git']);
		const store = process.platform === 'darwin'
			? path.join(fakeHome, 'Library', 'Application Support', 'Code - Insiders', 'User', 'globalStorage')
			: path.join(fakeHome, '.config', 'Code - Insiders', 'User', 'globalStorage');
		mkdirSync(store, { recursive: true });
		const payload = JSON.stringify({ data: { project: { uri: `file://${clone}` }, modifiedTime: Date.now() } });
		execFileSync('python3', ['-c', `import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("create table sessions_v2 (session_uri text, payload text, modified_time integer, is_chat_backing integer)")
c.execute("create table session_state_values (session_uri text, key text, value text)")
c.execute("insert into sessions_v2 values ('s1', ?, 0, 0)", (sys.argv[2],))
c.commit()`, path.join(store, 'agent-host.db'), payload]);
		const env = { ...process.env, HOME: fakeHome, XDG_CONFIG_HOME: path.join(fakeHome, '.config'), COPILOT_HOME: home, PYTHONDONTWRITEBYTECODE: '1' };
		const out = JSON.parse(String(execFileSync('python3', [path.join(scripts, 'my_issues.py'), 'find-clones', '--repo', 'octo/app'], { env })));
		assert.deepEqual(out.clones.map(c => [c.repo, c.path, c.sessions]), [['octo/app', '~/src/app', 1]]);
	} finally {
		rmSync(fakeHome, { recursive: true, force: true });
	}
});

test('the indexer picks open-first, backfill, delta or full passes', () => {
	const py = `
import json, os, sys, datetime
sys.argv = ['x']
sys.path.insert(0, ${JSON.stringify(scripts)})
import refresh_my_issues as r
r.ASSIGNEE = 'someone'
calls = []
r.run_pass = lambda name, label='', qualifier='': calls.append([name, qualifier])
def index(**gh):
    os.makedirs(r.BOARD_DIR, exist_ok=True)
    issues = gh.pop('issues', {})
    refreshed = gh.pop('refreshedAt', None)
    json.dump({'issues': issues, 'refreshedAt': refreshed, 'sourceCheckpoints': {'github': gh}}, open(r.INDEX_PATH, 'w'))
now = datetime.datetime.now(datetime.timezone.utc)
iso = lambda d: (now - datetime.timedelta(days=d)).strftime('%Y-%m-%dT%H:%M:%SZ')
out = {}
index(); calls.clear(); r.run_passes(); out['first'] = calls[:]
index(issues={'a#1': {}}, backfillPending=True, refreshedAt=iso(0)); calls.clear(); r.run_passes(); out['backfill'] = calls[:]
index(issues={'a#1': {}}, lastFullAt=iso(1), refreshedAt=iso(0)); calls.clear(); r.run_passes(); out['daily'] = calls[:]
index(issues={'a#1': {}}, lastFullAt=iso(8), refreshedAt=iso(0)); calls.clear(); r.run_passes(); out['weekly'] = calls[:]
index(issues={'a#1': {}}, lastFullAt=iso(1), refreshedAt=iso(0)); calls.clear(); r.run_passes(force_full=True); out['forced'] = calls[:]
print(json.dumps(out))
`;
	const fresh = mkdtempSync(path.join(os.tmpdir(), 'my-work-passes-'));
	try {
		const out = JSON.parse(String(execFileSync('python3', ['-c', py], { env: { ...process.env, COPILOT_HOME: fresh, PYTHONDONTWRITEBYTECODE: '1' } })));
		assert.deepEqual(out.first.map(c => c[0]), ['open', 'closed']);
		assert.deepEqual(out.backfill.map(c => c[0]), ['closed']);
		assert.equal(out.daily[0][0], 'delta');
		assert.match(out.daily[0][1], /^updated:>=\d{4}-\d{2}-\d{2}$/);
		assert.deepEqual(out.weekly.map(c => c[0]), ['full']);
		assert.deepEqual(out.forced.map(c => c[0]), ['full']);
	} finally {
		rmSync(fresh, { recursive: true, force: true });
	}
});
