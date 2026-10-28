import { execFile } from 'node:child_process';
import { promises as fs, watch as fsWatch } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sessionsFor } from './sessions.mjs';
import { listIssueChats } from './workSessions.mjs';
import { COPILOT_HOME, BOARD, SCRIPT, config } from './config.mjs';

export { BOARD, SCRIPT };

export const CANVAS_ID = 'my-issues-triage';

export const DATA_DIR = path.join(COPILOT_HOME, 'extension-data', CANVAS_ID);
const QUEUE_JSON = path.join(BOARD, 'my-triage-queue.json');
const INDEX_JSON = path.join(BOARD, 'my-issues.json');
const REFRESH_STATUS_JSON = path.join(BOARD, 'my-issues-refresh-status.json');
const OUTCOMES_JSON = path.join(BOARD, 'my-issue-outcomes.json');
const FEATURES_JSON = path.join(BOARD, 'my-issue-features.json');
const TRIAGE_FILE = path.join(DATA_DIR, 'notification-triage.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const BATCHES_FILE = path.join(DATA_DIR, 'batches.json');
const GROUPS_FILE = path.join(DATA_DIR, 'notification-groups.json');
const ISSUE_RULES_FILE = path.join(DATA_DIR, 'issue-rules.json');
const PRIORITIES_FILE = path.join(DATA_DIR, 'priorities.json');
export const THREADS_DIR = path.join(DATA_DIR, 'threads');
export const OPINIONS_DIR = path.join(BOARD, 'my-issue-opinions');
export const DEFAULT_SETTINGS = { batchSize: 10, popularThreshold: 5, theme: 'vscode', accent: 'blue', linkTarget: 'vscode', chatHeight: 160, chatCollapsed: false, density: 'auto', listHeight: 40, areaFilter: '' };

const FORMATS = {
	triage: { format: 'my-issues-triage/notification-triage', version: 1, key: 'items', empty: () => ({}) },
	activity: { format: 'my-issues-triage/activity', version: 1, key: 'entries', empty: () => [] },
	settings: { format: 'my-issues-triage/settings', version: 1, key: 'settings', empty: () => ({}) },
	batches: { format: 'my-issues-triage/batches', version: 1, key: 'tabs', empty: () => ({}) },
	groups: { format: 'my-issues-triage/notification-groups', version: 1, key: 'groups', empty: () => ({}) },
	issueRules: { format: 'my-issues-triage/issue-rules', version: 1, key: 'items', empty: () => ({}) },
	priorities: { format: 'my-issues-triage/priorities', version: 1, key: 'items', empty: () => [] },
};

// Built-in notification groups. Custom groups (defineGroup) are stored in GROUPS_FILE and shown
// between these and `fyi`; every triage chat loads them with getConfig.
export const BUILTIN_GROUPS = ['action', 'route', 'auto', 'cleanup', 'dismiss', 'fyi'];
export const GROUP_ID_RE = /^[a-z][a-z0-9-]{1,30}$/;

export async function getCustomGroups() {
	const groups = await readStore('groups', GROUPS_FILE);
	return Object.values(groups).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt.localeCompare(b.createdAt));
}

export async function defineGroup({ id, label, criteria, bulk = 'dismiss', order = 0 }) {
	if (BUILTIN_GROUPS.includes(id) || id === 'untriaged') throw Object.assign(new Error(`"${id}" is a built-in group`), { code: 'bad_input' });
	const groups = await readStore('groups', GROUPS_FILE);
	const prev = groups[id];
	groups[id] = { id, label, criteria, bulk, order, createdAt: prev?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
	await writeStore('groups', GROUPS_FILE, groups);
	return { group: groups[id], created: !prev };
}

export async function removeGroup(id) {
	const groups = await readStore('groups', GROUPS_FILE);
	if (!groups[id]) throw Object.assign(new Error(`no custom group "${id}"`), { code: 'bad_input' });
	delete groups[id];
	await writeStore('groups', GROUPS_FILE, groups);
	return { removed: id };
}

export class StorageError extends Error {
	constructor(message) { super(message); this.code = 'storage_error'; }
}

function run(cmd, args, { timeout = 120_000 } = {}) {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, timeout }, (error, stdout, stderr) => {
			if (error) {
				const message = (stderr || stdout || error.message || '').toString().trim();
				reject(Object.assign(new Error(message || `${cmd} failed`), { code: 'command_failed' }));
				return;
			}
			resolve(stdout.toString());
		});
	});
}

export async function runScript(args) {
	return JSON.parse(await run('python3', [SCRIPT, ...args]));
}

async function readJsonFile(file) {
	try {
		return JSON.parse(await fs.readFile(file, 'utf8'));
	} catch (error) {
		if (error.code === 'ENOENT') {
			return undefined;
		}
		throw new StorageError(`Cannot read ${file}: ${error.message}`);
	}
}

async function atomicWrite(file, value) {
	await fs.mkdir(path.dirname(file), { recursive: true });
	const tmp = path.join(path.dirname(file), `.tmp-${process.pid}-${randomUUID()}.json`);
	await fs.writeFile(tmp, JSON.stringify(value, null, 2));
	await fs.rename(tmp, file);
}

async function readStore(kind, file) {
	const spec = FORMATS[kind];
	const data = await readJsonFile(file);
	if (data === undefined) {
		return spec.empty();
	}
	const payload = data?.[spec.key];
	const shapeOk = Array.isArray(spec.empty()) ? Array.isArray(payload) : payload && typeof payload === 'object' && !Array.isArray(payload);
	if (data.format !== spec.format || data.version !== spec.version || !shapeOk) {
		throw new StorageError(`Unrecognized or corrupt data in ${file}; not overwriting it.`);
	}
	return payload;
}

async function writeStore(kind, file, payload) {
	const spec = FORMATS[kind];
	await atomicWrite(file, { format: spec.format, version: spec.version, [spec.key]: payload });
}

// --- Index (large, cached by mtime) ---
let indexCache = { mtimeMs: -1, data: undefined };
async function loadIndex() {
	const stat = await fs.stat(INDEX_JSON).catch(() => undefined);
	if (!stat) {
		throw new StorageError(`Missing ${INDEX_JSON}. Run the "VS Code Issues Indexer" automation first.`);
	}
	if (stat.mtimeMs !== indexCache.mtimeMs) {
		indexCache = { mtimeMs: stat.mtimeMs, data: await readJsonFile(INDEX_JSON) };
	}
	return indexCache.data;
}

function compactIssue(key, r) {
	const s = r.sweeper || {};
	return {
		key, title: r.title, url: r.url, state: r.state, area: r.primaryFeatureArea, updatedAt: r.updatedAt,
		labels: r.labels || [],
		sweeper: r.sweeper ? {
			action: s.triageAction ?? null, severity: s.severity ?? null, confidence: s.confidence ?? null,
			autoFixable: !!s.autoFixable, closeReason: s.closeReason ?? null,
		} : null,
		outcome: r.triageOutcome ?? null,
	};
}

// --- Cleanup groups (cached by index + outcomes mtime) ---
const CLEANUP_GROUPS = ['fixed', 'duplicate', 'reason', 'needs-info'];
function emptyCleanup() {
	return Object.fromEntries(CLEANUP_GROUPS.map(g => [g, { name: g, total: 0, items: [] }]));
}
let cleanupCache = { sig: '', data: undefined };
async function loadCleanup() {
	const [a, b] = await Promise.all([INDEX_JSON, OUTCOMES_JSON].map(f => fs.stat(f).then(s => s.mtimeMs).catch(() => 0)));
	const sig = `${a}:${b}`;
	if (sig !== cleanupCache.sig) {
		const groups = {};
		const outcomes = await loadOutcomes();
		for (const g of CLEANUP_GROUPS) {
			const res = await runScript(['cleanup', '--group', g, '--limit', '200']);
			// Keep items that were just decided elsewhere (e.g. closed from the chat) so they show as done in their batch.
			const fresh = new Set(res.items.map(i => i.key));
			const decided = (cleanupCache.data?.[g]?.items || []).filter(i => !fresh.has(i.key) && outcomes[i.key]);
			groups[g] = { name: res.name, total: res.total, items: [...res.items, ...decided] };
		}
		cleanupCache = { sig, data: groups };
	}
	return cleanupCache.data;
}

// User decisions written by the my-issues skill (`apply` / `record`), from the panel or from any chat.
async function loadOutcomes() {
	return (await readJsonFile(OUTCOMES_JSON).catch(() => undefined))?.outcomes ?? {};
}

// Refresh the panel when decisions or the index change outside the panel (e.g. the chat closed an issue).
export function watchDecisions(onChange) {
	const names = new Set([path.basename(OUTCOMES_JSON), path.basename(INDEX_JSON), path.basename(REFRESH_STATUS_JSON)]);
	let timer;
	let watcher;
	try {
		watcher = fsWatch(BOARD, (_, name) => {
			if (!names.has(String(name))) return;
			clearTimeout(timer);
			timer = setTimeout(onChange, 250);
		});
	} catch { /* folder missing; nothing to watch yet */ }
	return () => { clearTimeout(timer); watcher?.close(); };
}

// --- Agent-ready issues (cached by index + outcomes mtime) ---
let implementCache = { sig: '', data: undefined };
async function loadImplement() {
	const [a, b] = await Promise.all([INDEX_JSON, OUTCOMES_JSON].map(f => fs.stat(f).then(s => s.mtimeMs).catch(() => 0)));
	const sig = `${a}:${b}`;
	if (sig !== implementCache.sig) {
		const res = await runScript(['implement', '--limit', '500']);
		const outcomes = await loadOutcomes();
		const fresh = new Set(res.items.map(i => i.key));
		const decided = (implementCache.data?.items || []).filter(i => !fresh.has(i.key) && outcomes[i.key]);
		implementCache = { sig, data: { ...res, items: [...res.items, ...decided] } };
	}
	return implementCache.data;
}

// --- Live checks (cached 10 minutes per issue) ---
const checksCache = new Map();
export async function getChecks(key, fresh = false) {
	const hit = checksCache.get(key);
	if (!fresh && hit && Date.now() - hit.at < 600_000) {
		return hit.data;
	}
	const settings = await getSettings();
	const data = await runScript(['checks', key, '--popular', String(settings.popularThreshold)]);
	checksCache.set(key, { at: Date.now(), data });
	return data;
}

// --- Settings ---
export async function getSettings() {
	return { ...DEFAULT_SETTINGS, ...(await readStore('settings', SETTINGS_FILE)) };
}
export async function setSettings(patch) {
	const next = { ...(await readStore('settings', SETTINGS_FILE)) };
	if (patch.batchSize !== undefined) next.batchSize = patch.batchSize;
	if (patch.popularThreshold !== undefined) next.popularThreshold = patch.popularThreshold;
	if (patch.theme !== undefined) next.theme = patch.theme;
	if (patch.accent !== undefined) next.accent = patch.accent;
	if (patch.linkTarget !== undefined) next.linkTarget = patch.linkTarget;
	if (patch.chatHeight !== undefined) next.chatHeight = patch.chatHeight;
	if (patch.chatCollapsed !== undefined) next.chatCollapsed = patch.chatCollapsed;
	if (patch.density !== undefined) next.density = patch.density;
	if (patch.listHeight !== undefined) next.listHeight = patch.listHeight;
	if (patch.areaFilter !== undefined) next.areaFilter = patch.areaFilter;
	if (patch.recentCollapsed !== undefined) next.recentCollapsed = patch.recentCollapsed;
	await writeStore('settings', SETTINGS_FILE, next);
	if (patch.popularThreshold !== undefined) checksCache.clear();
	return { ...DEFAULT_SETTINGS, ...next };
}

// --- Opinions: blind judgements, one file per issue (written by judge chats via `my_issues.py opinion`) ---
const JUDGE_STALL_MS = 20 * 60 * 1000;
const NOTIF_TRIAGE_STALL_MS = 15 * 60 * 1000;
const OPINION_ACTIONS = new Set(['keep-open', 'fixed', 'duplicate', 'not-planned', 'needs-info']);

export async function getOpinions() {
	let names;
	try {
		names = await fs.readdir(OPINIONS_DIR);
	} catch (error) {
		if (error.code === 'ENOENT') return {};
		throw new StorageError(`Cannot read ${OPINIONS_DIR}: ${error.message}`);
	}
	const out = {};
	for (const name of names.filter(n => n.endsWith('.json') && !n.startsWith('.'))) {
		const value = await readJsonFile(path.join(OPINIONS_DIR, name)).catch(() => undefined);
		if (value?.format === 'my-issues/opinion' && value.version === 1 && typeof value.key === 'string' && OPINION_ACTIONS.has(value.action)) {
			out[value.key] = value;
		}
	}
	return out;
}

export async function setOpinion({ key, action, reference, confidence, reasoning, evidence }) {
	const args = ['opinion', key, '--action', action, '--reasoning', reasoning];
	if (reference) args.push('--reference', reference);
	if (confidence !== undefined) args.push('--confidence', String(confidence));
	for (const e of evidence || []) args.push('--evidence', e);
	return runScript(args);
}

export async function watchOpinions(onChange) {
	await fs.mkdir(OPINIONS_DIR, { recursive: true });
	let timer;
	const watcher = fsWatch(OPINIONS_DIR, () => {
		clearTimeout(timer);
		timer = setTimeout(onChange, 150);
	});
	return () => { clearTimeout(timer); watcher.close(); };
}

// --- Per-issue threads: what the user asked the chat from the panel, and the chat's replies ---
const THREAD_FORMAT = 'my-issues-triage/thread';
function threadFile(key) { return path.join(THREADS_DIR, `${key.replace(/[^\w.-]/g, '__')}.json`); }

export async function getThreads() {
	let names;
	try { names = await fs.readdir(THREADS_DIR); } catch (error) {
		if (error.code === 'ENOENT') return {};
		throw new StorageError(`Cannot read ${THREADS_DIR}: ${error.message}`);
	}
	const out = {};
	for (const name of names.filter(n => n.endsWith('.json') && !n.startsWith('.'))) {
		const value = await readJsonFile(path.join(THREADS_DIR, name)).catch(() => undefined);
		if (value?.format === THREAD_FORMAT && value.version === 1 && Array.isArray(value.entries)) out[value.key] = value.entries;
	}
	return out;
}

export async function getThread(key) {
	const value = await readJsonFile(threadFile(key)).catch(() => undefined);
	return value?.format === THREAD_FORMAT && Array.isArray(value.entries) ? value.entries : [];
}

export async function appendThread(key, role, text, choices) {
	const file = threadFile(key);
	const current = await readJsonFile(file);
	if (current !== undefined && (current?.format !== THREAD_FORMAT || !Array.isArray(current.entries))) {
		throw new StorageError(`Unrecognized data in ${file}; not overwriting it.`);
	}
	const entry = { role, text, at: new Date().toISOString() };
	if (choices?.length) entry.choices = choices.map(c => ({ label: c.label, reply: c.reply, style: c.style || 'secondary', edit: !!c.edit }));
	const entries = [...(current?.entries || []), entry].slice(-50);
	await atomicWrite(file, { format: THREAD_FORMAT, version: 1, key, entries });
	return entries;
}

// --- Batches ---
// tabs: { [tabKey]: { ids: string[], seen: string[], number: number } }
export const TAB_KEYS = ['notifications', 'cleanup:fixed', 'cleanup:duplicate', 'cleanup:reason', 'cleanup:needs-info', 'implement'];
async function getBatches() { return readStore('batches', BATCHES_FILE); }

function nextBatch(tab, pool, handled, size) {
	const current = new Set(tab.ids);
	let seen = new Set(tab.seen);
	let candidates = pool.filter(id => !handled.has(id) && !seen.has(id) && !current.has(id));
	if (!candidates.length) {
		seen = new Set();
		candidates = pool.filter(id => !handled.has(id) && !current.has(id));
	}
	for (const id of tab.ids) if (!handled.has(id)) seen.add(id);
	return { ids: candidates.slice(0, size), seen: [...seen].filter(id => pool.includes(id)), number: (tab.number || 0) + 1 };
}

function resolveBatch(tabs, key, pool, handled, size) {
	let tab = tabs[key] || { ids: [], seen: [], number: 0 };
	const present = tab.ids.filter(id => pool.includes(id));
	const open = present.filter(id => !handled.has(id));
	let changed = false;
	if (!open.length) {
		tab = nextBatch({ ...tab, ids: present }, pool, handled, size);
		changed = true;
	} else if (present.length !== tab.ids.length) {
		tab = { ...tab, ids: present };
		changed = true;
	}
	tabs[key] = tab;
	const remaining = pool.filter(id => !handled.has(id) && !tab.ids.includes(id)).length;
	return { changed, view: { number: tab.number, ids: tab.ids, open: tab.ids.filter(id => !handled.has(id)).length, remaining } };
}

let batchPools = {};
export async function advanceBatch(key) {
	if (!TAB_KEYS.includes(key)) {
		throw Object.assign(new Error(`unknown tab ${key}`), { code: 'bad_input' });
	}
	const [tabs, settings] = await Promise.all([getBatches(), getSettings()]);
	const pool = batchPools[key] || [];
	const handled = new Set(batchPools.__handled?.[key] || []);
	tabs[key] = nextBatch(tabs[key] || { ids: [], seen: [], number: 0 }, pool, handled, settings.batchSize);
	await writeStore('batches', BATCHES_FILE, tabs);
	return { tab: key, number: tabs[key].number, ids: tabs[key].ids };
}

export async function setBatch(key, ids) {
	if (!TAB_KEYS.includes(key)) {
		throw Object.assign(new Error(`unknown tab ${key}`), { code: 'bad_input' });
	}
	const tabs = await getBatches();
	const prev = tabs[key] || { ids: [], seen: [], number: 0 };
	const { batchSize } = await getSettings();
	tabs[key] = { ids: [...new Set(ids)].slice(0, Math.max(batchSize, 1)), seen: [...new Set([...prev.seen, ...prev.ids.filter(id => !ids.includes(id))])], number: (prev.number || 0) + 1 };
	await writeStore('batches', BATCHES_FILE, tabs);
	return { tab: key, number: tabs[key].number, ids: tabs[key].ids };
}

export async function getBatchView(key) {
	const tabs = await getBatches();
	return tabs[key] || null;
}

// --- Notifications (live, cached briefly) ---
const NOTIF_JQ = '.[] | {id, reason, unread, updated_at, repo: .repository.full_name, title: .subject.title, type: .subject.type, url: .subject.url}';
let notifCache = { at: 0, data: undefined, error: undefined };
function htmlUrl(n) {
	const num = n.url ? n.url.split('/').pop() : undefined;
	if (n.type === 'PullRequest' && num) return `https://github.com/${n.repo}/pull/${num}`;
	if (n.type === 'Issue' && num) return `https://github.com/${n.repo}/issues/${num}`;
	return `https://github.com/${n.repo}`;
}
async function loadNotifications(force = false) {
	if (!force && notifCache.data && Date.now() - notifCache.at < 60_000) {
		return notifCache;
	}
	try {
		const out = await run('gh', ['api', '/notifications', '--paginate', '--jq', NOTIF_JQ]);
		const items = out.split('\n').filter(Boolean).map(line => JSON.parse(line)).map(n => {
			const num = n.url ? Number(n.url.split('/').pop()) : undefined;
			return {
				...n, htmlUrl: htmlUrl(n),
				issueKey: (n.type === 'Issue' || n.type === 'PullRequest') && Number.isInteger(num) ? `${n.repo}#${num}` : null,
			};
		});
		items.sort((x, y) => (y.updated_at || '').localeCompare(x.updated_at || ''));
		notifCache = { at: Date.now(), data: items, error: undefined };
	} catch (error) {
		notifCache = { at: Date.now(), data: notifCache.data ?? [], error: error.message };
	}
	return notifCache;
}

// --- Public API ---
export async function getTriage() { return readStore('triage', TRIAGE_FILE); }

export async function setNotificationTriage(items) {
	const known = new Set([...BUILTIN_GROUPS, ...(await getCustomGroups()).map(g => g.id)]);
	const unknown = [...new Set(items.map(i => i.group).filter(g => !known.has(g)))];
	if (unknown.length) throw Object.assign(new Error(`Unknown group(s) ${unknown.join(', ')}. Define them first with defineGroup.`), { code: 'bad_input' });
	const triage = await getTriage();
	for (const item of items) {
		triage[item.id] = { group: item.group, reason: item.reason, rule: item.rule ?? null, issueKey: item.issueKey ?? null, routeTo: item.group === 'route' ? (item.routeTo ?? []) : null, at: new Date().toISOString() };
	}
	const ids = Object.keys(triage);
	if (ids.length > 2000) {
		ids.sort((x, y) => triage[x].at.localeCompare(triage[y].at)).slice(0, ids.length - 2000).forEach(id => delete triage[id]);
	}
	await writeStore('triage', TRIAGE_FILE, triage);
	return { stored: items.length };
}

export async function getActivity(since) {
	const entries = await readStore('activity', ACTIVITY_FILE);
	return since ? entries.filter(e => e.at >= since) : entries;
}

let activityLock = Promise.resolve();
export function logActivity(entry) {
	const next = activityLock.then(async () => {
		const entries = await readStore('activity', ACTIVITY_FILE);
		entries.push({ ...entry, at: new Date().toISOString() });
		await writeStore('activity', ACTIVITY_FILE, entries.slice(-1000));
	});
	activityLock = next.catch(() => { });
	return next;
}

// A classification is stale when the notification got new activity after it was classified.
export const needsTriage = (n, t) => !t || (n.updated_at || '') > (t.at || '');

// A notification counts as handled only if it was handled after its latest activity: dismissed
// threads that get new comments come back unread on GitHub and must show up again as new.
function handledNotificationIds(activity, notifications) {
	const last = new Map();
	for (const e of activity) if (e.kind === 'notification') last.set(e.id, e.at);
	const updated = new Map((notifications || []).map(n => [n.id, Date.parse(n.updated_at || '') || 0]));
	return new Set([...last].filter(([id, at]) => !updated.has(id) || updated.get(id) <= Date.parse(at)).map(([id]) => id));
}

// Notifications to (re)classify: `ids` limits the set (e.g. the current batch); `recompute` re-checks
// everything not already in a dismiss/route list, otherwise only unclassified or stale ones.
export async function notificationsToTriage(limit, { ids, recompute = false } = {}) {
	const [notif, triage, activity] = await Promise.all([loadNotifications(), getTriage(), getActivity(startOfToday())]);
	const handled = handledNotificationIds(activity, notif.data);
	const only = ids?.length ? new Set(ids) : null;
	const settled = new Set(['auto', 'dismiss', 'route']);
	return (notif.data || [])
		.filter(n => !handled.has(n.id) && (!only || only.has(n.id)))
		.filter(n => recompute ? !settled.has(triage[n.id]?.group) : needsTriage(n, triage[n.id]))
		.slice(0, limit)
		.map(n => ({ ...n, previous: triage[n.id] ? { group: triage[n.id].group, reason: triage[n.id].reason } : null }));
}
export const nextUntriagedNotifications = limit => notificationsToTriage(limit);

export async function untriagedNotificationsIn(ids) {
	const wanted = new Set(ids);
	const [notif, triage, activity] = await Promise.all([loadNotifications(), getTriage(), getActivity(startOfToday())]);
	const handled = handledNotificationIds(activity, notif.data);
	return (notif.data || []).filter(n => wanted.has(n.id) && !triage[n.id] && !handled.has(n.id));
}

function startOfToday() {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d.toISOString();
}

// Feature areas in configured priority order, with the fallback (Others) last.
export async function getAreas() { return loadAreas(); }
async function loadAreas() {
	const cfg = await readJsonFile(FEATURES_JSON).catch(() => undefined);
	const areas = [...(cfg?.featureAreas || [])].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)).map(a => ({ id: a.id, name: a.name, auto: !!a.auto, labels: Array.isArray(a.labels) ? a.labels : [] }));
	const fb = cfg?.fallbackArea || { id: 'others', name: 'Others' };
	return [...areas, { id: fb.id, name: fb.name }];
}

// The indexer (refresh_my_issues.py) publishes its progress so the panel can say it is still building.
async function loadIndexing() {
	const st = await readJsonFile(REFRESH_STATUS_JSON).catch(() => undefined);
	if (!st || typeof st !== 'object') return null;
	if (st.state === 'running') {
		let alive = true;
		try { process.kill(st.pid, 0); } catch (error) { alive = error.code === 'EPERM'; }
		const fresh = Date.now() - Date.parse(st.updatedAt || 0) < 30 * 60 * 1000;
		if (!alive || !fresh) return null;
	} else if (st.state === 'failed') {
		if (Date.now() - Date.parse(st.updatedAt || 0) > 24 * 60 * 60 * 1000) return null;
	} else {
		return null;
	}
	return { state: st.state, phase: st.phase || null, done: st.done ?? null, total: st.total ?? null, startedAt: st.startedAt || null, firstRun: !!st.firstRun, error: st.error || null };
}

export async function getState({ forceNotifications = false } = {}) {
	// Without an index (e.g. before the first indexer run) My Work and Notifications still work;
	// the index-based views (Today, Cleanup, Implement) stay empty and show how to build it.
	const hasIndex = !!(await fs.stat(INDEX_JSON).catch(() => null));
	const [index, queue, cleanup, notif, triage, activity, implement, opinions, settings, tabs] = await Promise.all([
		hasIndex ? loadIndex() : { issues: {}, counts: {}, refreshedAt: null },
		readJsonFile(QUEUE_JSON).catch(() => undefined),
		hasIndex ? loadCleanup().catch(() => emptyCleanup()) : emptyCleanup(),
		loadNotifications(forceNotifications), getTriage(), getActivity(startOfToday()),
		hasIndex ? loadImplement().catch(() => ({ total: 0, bugs: 0, items: [] })) : { total: 0, bugs: 0, items: [] },
		getOpinions(), getSettings(), getBatches(),
	]);
	const threads = await getThreads();
	const issueChats = await listIssueChats();
	const sessions = await sessionsFor([...new Set([...Object.keys(index.issues || {}), ...(notif.data || []).map(n => n.issueKey).filter(Boolean)])]).catch(() => ({}));
	const customGroups = await getCustomGroups();
	const areas = await loadAreas();
	const issues = index.issues || {};
	const handledNotifs = handledNotificationIds(activity, notif.data);
	const handledIssues = new Set(activity.filter(e => e.kind === 'issue').map(e => e.key));
	// Decisions made today anywhere (panel or chat) also count as handled.
	const outcomes = await loadOutcomes();
	const today = startOfToday();
	for (const [k, o] of Object.entries(outcomes)) if ((o?.decidedAt || '') >= today.slice(0, 19)) handledIssues.add(k);
	// A request stays pending until a verdict newer than it arrives or the user cancels it; after
	// JUDGE_STALL_MS it is shown as stalled (e.g. the judge chat could not be created) with Retry/Cancel.
	// Blind and informed (second-round, with Sweeper's evidence) requests are tracked separately.
	const opinionPending = {};
	const informedPending = {};
	for (const e of activity) {
		const informed = e.mode === 'informed';
		const pending = informed ? informedPending : opinionPending;
		if (e.kind === 'opinion-request') {
			const verdict = informed ? opinions[e.key]?.informed : opinions[e.key];
			const verdictAt = verdict ? Date.parse(verdict.judgedAt) : 0;
			if (verdictAt < Date.parse(e.at) - 1000) pending[e.key] = { at: e.at };
		} else if (e.kind === 'opinion-cancel') {
			delete pending[e.key];
		} else if (e.kind === 'opinion-failed') {
			for (const p of [opinionPending[e.key], informedPending[e.key]]) if (p) p.failed = e.error || 'unknown error';
		}
	}
	for (const p of [...Object.values(opinionPending), ...Object.values(informedPending)]) p.stalled = Date.now() - Date.parse(p.at) > JUDGE_STALL_MS;
	const sections = (queue?.sections || []).map(s => ({
		id: s.id, title: s.title, why: s.why, total: s.total,
		items: s.keys.filter(k => issues[k]).map(k => ({ ...compactIssue(k, issues[k]), handled: handledIssues.has(k) })),
	}));
	const notifications = (notif.data || []).map(n => ({
		...n, triage: triage[n.id] ?? null, handled: handledNotifs.has(n.id),
		myIssue: n.issueKey && issues[n.issueKey] ? compactIssue(n.issueKey, issues[n.issueKey]) : null,
	}));
	const untriaged = notifications.filter(n => !n.handled && needsTriage(n, n.triage)).length;
	// The latest "triage more" request stays pending until its notifications are triaged or handled.
	const issueRules = await getIssueRules();
	let issueRulesPending = null;
	const lastRulesReq = activity.filter(e => e.kind === 'issue-rules-request').at(-1);
	if (lastRulesReq && Date.now() - Date.parse(lastRulesReq.at) < NOTIF_TRIAGE_STALL_MS * 3) {
		const left = (lastRulesReq.keys || []).filter(k => !handledIssues.has(k) && !((issueRules[k]?.at || '') >= lastRulesReq.at)).length;
		if (left) issueRulesPending = { at: lastRulesReq.at, total: lastRulesReq.keys.length, left, keys: lastRulesReq.keys, recompute: !!lastRulesReq.recompute, stalled: Date.now() - Date.parse(lastRulesReq.at) > NOTIF_TRIAGE_STALL_MS };
	}
	let notifTriagePending = null;
	const lastReq = activity.filter(e => e.kind === 'notif-triage-request').at(-1);
	if (lastReq && Date.now() - Date.parse(lastReq.at) < NOTIF_TRIAGE_STALL_MS * 3) {
		const live = new Set(notifications.map(n => n.id));
		// Done once the chat stored a classification newer than the request (works for re-checks too).
		const left = (lastReq.ids || []).filter(id => live.has(id) && !handledNotifs.has(id) && !((triage[id]?.at || '') >= lastReq.at)).length;
		if (left) notifTriagePending = { at: lastReq.at, total: lastReq.ids.length, left, recompute: !!lastReq.recompute, stalled: Date.now() - Date.parse(lastReq.at) > NOTIF_TRIAGE_STALL_MS };
	}
	const cleanupGroups = Object.fromEntries(Object.entries(cleanup).map(([g, v]) => [g, {
		name: v.name, total: v.total,
		items: v.items.map(i => ({ ...i, handled: handledIssues.has(i.key) })),
	}]));
	const implementItems = implement.items.map(i => ({ ...i, handled: handledIssues.has(i.key) }));

	// Batches: only a fixed-size slice of each list is shown at a time.
	const pools = {
		notifications: notifications.map(n => n.id),
		implement: implementItems.map(i => i.key),
		...Object.fromEntries(Object.entries(cleanupGroups).map(([g, v]) => [`cleanup:${g}`, v.items.map(i => i.key)])),
	};
	const handledBy = {
		notifications: new Set([...handledNotifs].filter(id => pools.notifications.includes(id))),
		implement: handledIssues,
		...Object.fromEntries(Object.keys(cleanupGroups).map(g => [`cleanup:${g}`, handledIssues])),
	};
	batchPools = { ...pools, __handled: Object.fromEntries(Object.entries(handledBy).map(([k, v]) => [k, [...v]])) };
	const batches = {};
	let dirty = false;
	for (const key of TAB_KEYS) {
		const { changed, view } = resolveBatch(tabs, key, pools[key] || [], handledBy[key] || new Set(), settings.batchSize);
		batches[key] = view;
		dirty ||= changed;
	}
	if (dirty) {
		await writeStore('batches', BATCHES_FILE, tabs);
	}

	return {
		hasIndex, indexing: await loadIndexing(), refreshedAt: index.refreshedAt, counts: index.counts, queueDate: queue?.date ?? null, settings, batches, opinions, opinionPending, informedPending, threads, issueChats, customGroups, areas, sessions,
		notifications, notificationsError: notif.error ?? null, notificationsFetchedAt: notif.at ? new Date(notif.at).toISOString() : null, untriaged, notifTriagePending, issueRules, issueRulesPending, sections, cleanup: cleanupGroups,
		implement: { total: implement.total, bugs: implement.bugs, items: implementItems },
		today: {
			notificationsHandled: new Set(activity.filter(e => e.kind === 'notification' && e.action !== 'skip').map(e => e.id)).size,
			issuesHandled: handledIssues.size,
			sessionsStarted: activity.filter(e => e.action === 'start-session').length,
			applied: activity.filter(e => e.action === 'apply').length,
		},
	};
}

export async function getIssueDetail(key) {
	// Without an index yet, every issue is simply "not indexed" and the panel shows it from GitHub.
	const index = await fs.stat(INDEX_JSON).then(() => loadIndex(), () => ({ issues: {} }));
	const r = index.issues?.[key];
	if (!r) {
		throw Object.assign(new Error(`${key} is not in your issue index`), { code: 'not_found' });
	}
	let proposal = null;
	let review = null;
	if (r.repository === 'microsoft/vscode') {
		[proposal, review] = await Promise.all([
			runScript(['proposal', key]).catch(() => null),
			runScript(['get', key]).then(g => g.sweeperReview ?? null).catch(() => null),
		]);
	}
	const s = r.sweeper || {};
	// Sweeper's "owner" is a comma-separated list of who it thinks should own the issue.
	const suggested = String(s.owner || '').split(',').map(x => x.trim()).filter(x => x && x !== 'unassigned' && x !== 'Copilot');
	return {
		issue: compactIssue(key, r), milestone: r.milestone ?? null, proposal, review,
		owners: { assignees: r.assignees || [], suggested },
		readiness: { agentReadiness: s.agentReadiness ?? null, itemType: s.itemType ?? null, breadth: s.breadth ?? null, upvotes: s.upvotes ?? null },
	};
}

export async function applyCleanup({ key, comment, group, note }) {
	await fs.mkdir(DATA_DIR, { recursive: true });
	const file = path.join(DATA_DIR, `.comment-${randomUUID()}.md`);
	await fs.writeFile(file, comment);
	try {
		const args = ['apply', key, '--comment-file', file, '--confirm'];
		if (group) args.push('--group', group);
		if (note) args.push('--note', note);
		const result = await runScript(args);
		await logActivity({ kind: 'issue', key, action: 'apply', group: group ?? null, done: result.done, decision: result.triageOutcome?.decision });
		return result;
	} finally {
		await fs.rm(file, { force: true });
	}
}

export async function recordDecision({ key, decision, note }) {
	const result = await runScript(['record', key, '--decision', decision, '--note', note || '']);
	await logActivity({ kind: 'issue', key, action: 'record', decision });
	return result;
}

export async function skipIssue({ key }) {
	await logActivity({ kind: 'issue', key, action: 'skip' });
	return { key, skipped: true };
}

export async function logStart(key) {
	await logActivity({ kind: 'issue', key, action: 'start-session' });
}

export async function dismissNotification({ id, unsubscribe }) {
	if (unsubscribe) {
		await run('gh', ['api', '--method', 'DELETE', `/notifications/threads/${id}/subscription`]);
	}
	await run('gh', ['api', '--method', 'PATCH', `/notifications/threads/${id}`]);
	if (notifCache.data) {
		notifCache.data = notifCache.data.filter(n => n.id !== id);
	}
	await logActivity({ kind: 'notification', id, action: unsubscribe ? 'done' : 'dismiss' });
	return { id, dismissed: true, unsubscribed: !!unsubscribe };
}

let loginPromise;
function currentLogin() {
	loginPromise ??= run('gh', ['api', 'user', '--jq', '.login']).then(s => s.trim()).catch(error => { loginPromise = undefined; throw error; });
	return loginPromise;
}

// my_issues.py rewrites the outcomes file on every record, so records must not run in parallel.
let recordLock = Promise.resolve();
function recordSerial(args) {
	const next = recordLock.then(() => runScript(args));
	recordLock = next.catch(() => { });
	return next;
}

// Reassign the notification's issue/PR to the owners the chat proposed (triage group "route"),
// remove the current user, record `routed`, and dismiss the notification.
export async function routeNotification({ id }) {
	const t = (await getTriage())[id];
	if (!t || t.group !== 'route') throw new Error('not classified for routing');
	// The chat may omit issueKey; the notification itself knows its issue/PR.
	if (!t.issueKey) t.issueKey = (await loadNotifications()).data?.find(n => n.id === id)?.issueKey ?? null;
	if (!t.issueKey) throw new Error('no issue or PR to route');
	const to = Array.isArray(t.routeTo) ? t.routeTo : [];
	const recorded = await routeIssueTo(t.issueKey, to);
	await dismissNotification({ id, unsubscribe: true });
	return { id, key: t.issueKey, to, recorded };
}

// Assign `to`, remove the current user, record `routed` (indexed issues only) and log it.
async function routeIssueTo(key, to) {
	const me = await currentLogin();
	const [repo, num] = key.split('#');
	if (to.length) {
		const res = JSON.parse(await run('gh', ['api', '--method', 'POST', `repos/${repo}/issues/${num}/assignees`, ...to.flatMap(l => ['-f', `assignees[]=${l}`])]));
		const now = new Set((res.assignees || []).map(a => a.login.toLowerCase()));
		const missing = to.filter(l => !now.has(l.toLowerCase()));
		if (missing.length) throw new Error(`could not assign ${missing.map(l => `@${l}`).join(', ')} (not assignable?)`);
	}
	if (!to.some(l => l.toLowerCase() === me.toLowerCase())) {
		await run('gh', ['api', '--method', 'DELETE', `repos/${repo}/issues/${num}/assignees`, '-f', `assignees[]=${me}`]);
	}
	let recorded = false;
	try {
		await recordSerial(['record', key, '--decision', 'routed', '--note', to.length ? `routed to ${to.join(', ')} from triage board` : 'unassigned from triage board']);
		recorded = true;
	} catch { /* PRs and issues filed after the last index refresh are not indexed */ }
	await logActivity({ kind: 'issue', key, action: 'route', to });
	return recorded;
}

// --- Inbox rules applied to issues (Cleanup / Implement / Today) ---
// The chat applies the user's inbox rules (config.rulesFile) to each issue and stores a verdict here, keyed by issue.
export const ISSUE_RULE_GROUPS = ['route', 'close', 'needs-info', 'keep'];
export async function getIssueRules() { return readStore('issueRules', ISSUE_RULES_FILE); }
export async function setIssueRules(items) {
	const rules = await getIssueRules();
	const at = new Date().toISOString();
	for (const i of items) {
		rules[i.key] = { group: i.group, reason: i.reason, rule: i.rule ?? null, routeTo: i.group === 'route' ? (i.routeTo ?? []) : null, closeAs: i.group === 'close' ? (i.closeAs ?? null) : null, at };
	}
	const keys = Object.keys(rules);
	if (keys.length > 3000) keys.sort((a, b) => rules[a].at.localeCompare(rules[b].at)).slice(0, keys.length - 3000).forEach(k => delete rules[k]);
	await writeStore('issueRules', ISSUE_RULES_FILE, rules);
	return { stored: items.length };
}
export async function routeIssue({ key }) {
	const r = (await getIssueRules())[key];
	if (!r || r.group !== 'route') throw new Error('not marked for routing by your rules');
	const to = Array.isArray(r.routeTo) ? r.routeTo : [];
	const recorded = await routeIssueTo(key, to);
	return { key, to, recorded };
}
// Issues to (re)check against the rules: unchecked, or updated since they were checked (or all with recompute).
export async function issuesToCheck(keys, { recompute = false } = {}) {
	const [index, rules] = await Promise.all([loadIndex(), getIssueRules()]);
	return keys.map(k => [k, index.issues?.[k]]).filter(([k, r]) => r && (recompute || !rules[k] || (r.updatedAt || '') > rules[k].at))
		.map(([k, r]) => ({ key: k, title: r.title, url: r.url, area: r.primaryFeatureArea, labels: r.labels || [], assignees: r.assignees || [], sweeper: r.sweeper?.triageAction ?? null, previous: rules[k] ? { group: rules[k].group, reason: rules[k].reason } : null }));
}

export async function skipNotification({ id }) {
	await logActivity({ kind: 'notification', id, action: 'skip' });
	return { id, skipped: true };
}

// --- Live GitHub content for the detail view (description, latest comments, linked PRs) ---
const GH_TTL_MS = 3 * 60 * 1000;
const COMMENTS_SHOWN = 10;
const ghCache = new Map();
const ghJson = async path => JSON.parse(await run('gh', ['api', '-H', 'Accept: application/vnd.github+json', path], { timeout: 30_000 }));
const ghUser = u => u ? { login: u.login, bot: u.type === 'Bot' || /\[bot\]$/.test(u.login) } : { login: 'ghost', bot: false };
const reactionsOf = r => r ? Object.fromEntries(['+1', '-1', 'heart', 'hooray', 'rocket', 'eyes', 'laugh', 'confused'].filter(k => r[k]).map(k => [k, r[k]])) : {};

let meLogin;
async function getMe() {
	meLogin ??= run('gh', ['api', '/user', '--jq', '.login']).then(out => out.trim()).catch(error => { meLogin = undefined; throw error; });
	return meLogin;
}

export async function getGitHubDetail(key, fresh = false) {
	const hit = ghCache.get(key);
	if (!fresh && hit && Date.now() - hit.at < GH_TTL_MS) return hit.value;
	const [repo, num] = key.split('#');
	const base = `/repos/${repo}/issues/${num}`;
	const issue = await ghJson(base);
	const isPr = !!issue.pull_request;
	const total = issue.comments || 0;
	// Only the latest COMMENTS_SHOWN comments: read the last page (and the one before it if needed).
	let comments = [];
	if (total) {
		const per = COMMENTS_SHOWN;
		const lastPage = Math.ceil(total / per);
		const pages = lastPage > 1 && total % per ? [lastPage - 1, lastPage] : [lastPage];
		for (const p of pages) comments.push(...await ghJson(`${base}/comments?per_page=${per}&page=${p}`));
		comments = comments.slice(-COMMENTS_SHOWN);
	}
	const [pr, timeline] = await Promise.all([
		isPr ? ghJson(`/repos/${repo}/pulls/${num}`).catch(() => null) : null,
		ghJson(`${base}/timeline?per_page=100`).catch(() => []),
	]);
	const linked = new Map();
	for (const e of Array.isArray(timeline) ? timeline : []) {
		const src = e.event === 'cross-referenced' ? e.source?.issue : null;
		if (!src?.pull_request) continue;
		const k = `${src.repository?.full_name || repo}#${src.number}`;
		linked.set(k, { key: k, url: src.html_url, title: src.title, state: src.pull_request.merged_at ? 'merged' : src.state, draft: !!src.draft });
	}
	const value = {
		key, url: issue.html_url, isPr, title: issue.title, state: issue.state, stateReason: issue.state_reason ?? null,
		author: ghUser(issue.user), createdAt: issue.created_at, updatedAt: issue.updated_at, closedAt: issue.closed_at,
		labels: (issue.labels || []).map(l => ({ name: l.name, color: l.color })),
		assignees: (issue.assignees || []).map(a => a.login),
		milestone: issue.milestone?.title ?? null,
		reactions: reactionsOf(issue.reactions),
		body: issue.body || '',
		commentCount: total,
		comments: comments.map(c => ({ id: c.id, url: c.html_url, author: ghUser(c.user), association: c.author_association, createdAt: c.created_at, body: c.body || '', reactions: reactionsOf(c.reactions) })),
		linkedPrs: [...linked.values()].slice(-8),
		pr: pr ? { draft: pr.draft, merged: !!pr.merged_at, additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changed_files, head: pr.head?.ref, base: pr.base?.ref } : null,
		me: await getMe().catch(() => null),
		fetchedAt: new Date().toISOString(),
	};
	ghCache.set(key, { at: Date.now(), value });
	if (ghCache.size > 200) ghCache.delete(ghCache.keys().next().value);
	return value;
}

// Diagnostics for the ⌘V fallback: when it last had to read the clipboard itself.
export function notePasteFallback() {
	fs.writeFile(path.join(DATA_DIR, 'paste-fallback.json'), JSON.stringify({ at: new Date().toISOString() })).catch(() => { });
}

// --- My priorities: a private, ordered list of issues to work on after the next milestone.
// Local only; never changes milestones on GitHub.
export async function getPriorities() {
	return (await readStore('priorities', PRIORITIES_FILE)).filter(p => p && typeof p.key === 'string');
}

export async function updatePriorities({ op, key, to }) {
	const list = await getPriorities();
	const at = list.findIndex(p => p.key === key);
	if (op === 'add') {
		if (at < 0) list.splice(to === 'top' ? 0 : list.length, 0, { key, addedAt: new Date().toISOString() });
	} else if (op === 'remove') {
		if (at >= 0) list.splice(at, 1);
	} else if (op === 'move') {
		if (at < 0) throw Object.assign(new Error(`${key} is not in your priorities`), { code: 'bad_input' });
		const [item] = list.splice(at, 1);
		const idx = to === 'top' ? 0 : to === 'bottom' ? list.length : to === 'up' ? Math.max(0, at - 1) : to === 'down' ? Math.min(list.length, at + 1)
			: Number.isInteger(to) ? Math.max(0, Math.min(list.length, to)) : -1;
		if (idx < 0) throw Object.assign(new Error('invalid position'), { code: 'bad_input' });
		list.splice(idx, 0, item);
	} else if (op === 'prune') {
		const drop = new Set(Array.isArray(key) ? key : []);
		const kept = list.filter(p => !drop.has(p.key));
		if (kept.length !== list.length) await writeStore('priorities', PRIORITIES_FILE, kept);
		return kept;
	} else {
		throw Object.assign(new Error('invalid op'), { code: 'bad_input' });
	}
	await writeStore('priorities', PRIORITIES_FILE, list);
	return list;
}
