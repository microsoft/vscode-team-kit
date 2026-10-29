// Agents window sessions the user pinned to My Work (by session id). Stored with the other My Work
// data in the My Work data folder (config.dataDir); session details are read live from the session store.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir } from './config.mjs';

const FILE = path.join(dataDir(), 'sessions.json');
const FORMAT = 'my-work/pinned-sessions';
const VERSION = 1;
export const SESSION_ID_RE = /^[\w-]{8,80}$/;

async function read() {
	let data;
	try { data = JSON.parse(await fs.readFile(FILE, 'utf8')); } catch (error) {
		if (error.code === 'ENOENT') return [];
		throw Object.assign(new Error(`Cannot read ${FILE}: ${error.message}`), { code: 'storage' });
	}
	if (data?.format !== FORMAT || data.version !== VERSION || !Array.isArray(data.items)) {
		throw Object.assign(new Error(`Unrecognized or corrupt data in ${FILE}; not overwriting it.`), { code: 'storage' });
	}
	return data.items;
}
async function write(items) {
	await fs.mkdir(path.dirname(FILE), { recursive: true, mode: 0o700 });
	const tmp = path.join(path.dirname(FILE), `.tmp-${process.pid}-${randomUUID()}.json`);
	await fs.writeFile(tmp, JSON.stringify({ format: FORMAT, version: VERSION, items }, null, 2), { mode: 0o600 });
	await fs.rename(tmp, FILE);
}

/** Session id from `agent-host-session://<provider>/<id>[/…]`, `copilotcli:/<id>` or a bare id. */
export function parseSessionRef(text) {
	const t = String(text || '').trim();
	const m = t.match(/^agent-host-session:\/\/[\w-]+\/([\w-]+)/) || t.match(/^[\w-]+:\/+([\w-]{8,80})$/) || t.match(/^([0-9a-f]{8}-[0-9a-f-]{27,})$/i);
	return m && SESSION_ID_RE.test(m[1]) ? m[1] : null;
}

/** Pinned sessions ({id, bucket, summary?}); issue placements live in the same file ({key, bucket, sessions}). */
export async function listPinned() { return (await read()).filter(i => i.id); }
export async function listPinnedIssues() { return (await read()).filter(i => i.key); }

/** Add an issue to My Work locally (current / next group; never changes its GitHub milestone), linking the session that works on it. */
export async function pinIssue(key, bucket = 'current', sessionId = null) {
	const items = await read();
	let item = items.find(i => i.key === key);
	if (!item) { item = { key, bucket: BUCKET_RE.test(bucket) ? bucket : 'current', sessions: [], addedAt: new Date().toISOString() }; items.push(item); }
	if (sessionId && !item.sessions.includes(sessionId)) item.sessions.push(sessionId);
	await write(items);
	return item;
}
export async function setIssueBucket(key, bucket) {
	if (!BUCKET_RE.test(bucket)) throw Object.assign(new Error('invalid group'), { code: 'bad_input', status: 400 });
	const items = await read();
	let item = items.find(i => i.key === key);
	if (!item) { item = { key, bucket, sessions: [], addedAt: new Date().toISOString() }; items.push(item); }
	item.bucket = bucket;
	await write(items);
	return item;
}
export async function unpinIssues(keys) {
	const drop = new Set(keys);
	const items = await read();
	const kept = items.filter(i => !i.key || !drop.has(i.key));
	if (kept.length !== items.length) await write(kept);
	return { removed: items.length - kept.length };
}
/** What a pinned session is implementing, written by the My Work chat after reading the session. */
export async function setSessionSummary(id, summary) {
	const items = await read();
	const item = items.find(i => i.id === id);
	if (!item) throw Object.assign(new Error('That session is not in My Work'), { code: 'bad_input', status: 404 });
	item.summary = summary; item.summaryAt = new Date().toISOString(); delete item.summaryRequestedAt;
	await write(items);
	return item;
}
export async function markSummaryRequested(id) {
	const items = await read();
	const item = items.find(i => i.id === id);
	if (item) { item.summaryRequestedAt = new Date().toISOString(); await write(items); }
}

export const BUCKETS = ['current', 'next', 'priorities'];
// A group id: a built-in bucket or a custom section id (the server checks the section exists).
export const BUCKET_RE = /^[a-z][a-z0-9-]{0,30}$/;

/** Move every pinned issue and session from one group to another (e.g. when a custom section is deleted). */
export async function moveBucket(from, to) {
	const items = await read();
	let moved = 0;
	for (const i of items) if (i.bucket === from) { i.bucket = to; moved++; }
	if (moved) await write(items);
	return moved;
}

export async function pinSession(id, note = '', bucket = 'current') {
	const items = await read();
	const at = items.findIndex(i => i.id === id);
	if (at >= 0) { if (note) { items[at].note = note; await write(items); } return items[at]; }
	const item = { id, note, bucket: BUCKET_RE.test(bucket) ? bucket : 'current', addedAt: new Date().toISOString() };
	items.push(item);
	await write(items);
	return item;
}

/** Place a pinned session in the current / next milestone group or in My priorities (local only). */
export async function setSessionBucket(id, bucket) {
	if (!BUCKET_RE.test(bucket)) throw Object.assign(new Error('invalid group'), { code: 'bad_input', status: 400 });
	const items = await read();
	const item = items.find(i => i.id === id);
	if (!item) throw Object.assign(new Error('That session is not in My Work'), { code: 'bad_input', status: 404 });
	item.bucket = bucket;
	await write(items);
	return item;
}

export async function unpinSessions(ids) {
	const drop = new Set(ids);
	const items = await read();
	const kept = items.filter(i => !drop.has(i.id));
	if (kept.length !== items.length) await write(kept);
	return { removed: items.length - kept.length };
}

// The nested "My Work chat" (under the triage chat) that handles My Work chat messages.
const CHAT_FILE = path.join(path.dirname(FILE), 'chat.json');
export const MY_WORK_DIR = path.dirname(FILE);
export async function getMyWorkChat() {
	try {
		const d = JSON.parse(await fs.readFile(CHAT_FILE, 'utf8'));
		return d?.format === 'my-work/chat' && typeof d.link === 'string' ? d.link : null;
	} catch { return null; }
}
export async function setMyWorkChat(link) {
	await fs.mkdir(MY_WORK_DIR, { recursive: true, mode: 0o700 });
	const tmp = path.join(MY_WORK_DIR, `.tmp-${process.pid}-${randomUUID()}.json`);
	await fs.writeFile(tmp, JSON.stringify({ format: 'my-work/chat', version: 1, link, setAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
	await fs.rename(tmp, CHAT_FILE);
}

// Short summaries of sessions (what each is doing), written by the My Work chat on request. Any session, pinned or not.
const SUMMARIES_FILE = path.join(MY_WORK_DIR, 'session-summaries.json');
export async function getSessionSummaries() {
	try {
		const d = JSON.parse(await fs.readFile(SUMMARIES_FILE, 'utf8'));
		return d?.format === 'my-work/session-summaries' && d.summaries && typeof d.summaries === 'object' ? d.summaries : {};
	} catch { return {}; }
}
async function updateSessionSummary(id, change) {
	const summaries = await getSessionSummaries();
	summaries[id] = { ...(summaries[id] || {}), ...change };
	// Keep the file small: the most recently touched 200 sessions.
	const kept = Object.entries(summaries).sort((a, b) => String(b[1].at || b[1].requestedAt).localeCompare(String(a[1].at || a[1].requestedAt))).slice(0, 200);
	await fs.mkdir(MY_WORK_DIR, { recursive: true, mode: 0o700 });
	const tmp = path.join(MY_WORK_DIR, `.tmp-${process.pid}-${randomUUID()}.json`);
	await fs.writeFile(tmp, JSON.stringify({ format: 'my-work/session-summaries', version: 1, summaries: Object.fromEntries(kept) }, null, 2), { mode: 0o600 });
	await fs.rename(tmp, SUMMARIES_FILE);
	return summaries[id];
}
export function recordSessionSummary(id, summary) {
	return updateSessionSummary(id, { summary, at: new Date().toISOString(), requestedAt: null });
}
export function markSessionSummaryRequested(id) {
	return updateSessionSummary(id, { requestedAt: new Date().toISOString() });
}

// Issues the user linked to a session by hand (when the panel can't tell which issue a session works on).
const LINKS_FILE = path.join(MY_WORK_DIR, 'session-links.json');
const ISSUE_KEY_RE = /^[\w.-]+\/[\w.-]+#\d+$/;
export async function getSessionLinks() {
	try {
		const d = JSON.parse(await fs.readFile(LINKS_FILE, 'utf8'));
		return d?.format === 'my-work/session-links' && d.links && typeof d.links === 'object' ? d.links : {};
	} catch { return {}; }
}
export async function linkSessionIssue(id, key, on = true) {
	if (!SESSION_ID_RE.test(id || '') || !ISSUE_KEY_RE.test(key || '')) throw Object.assign(new Error('invalid session or issue'), { code: 'bad_input', status: 400 });
	const links = await getSessionLinks();
	const keys = new Set(links[id] || []);
	if (on) keys.add(key); else keys.delete(key);
	if (keys.size) links[id] = [...keys]; else delete links[id];
	await fs.mkdir(MY_WORK_DIR, { recursive: true, mode: 0o700 });
	const tmp = path.join(MY_WORK_DIR, `.tmp-${process.pid}-${randomUUID()}.json`);
	await fs.writeFile(tmp, JSON.stringify({ format: 'my-work/session-links', version: 1, links }, null, 2), { mode: 0o600 });
	await fs.rename(tmp, LINKS_FILE);
	return links[id] || [];
}

// Each issue's own chat: where its discussion happens and, after Start session, its work session.
const ISSUE_CHATS_FILE = path.join(MY_WORK_DIR, 'issue-chats.json');
export async function listIssueChats() {
	try {
		const d = JSON.parse(await fs.readFile(ISSUE_CHATS_FILE, 'utf8'));
		return d?.format === 'my-work/issue-chats' && d.chats && typeof d.chats === 'object' ? d.chats : {};
	} catch { return {}; }
}
export async function getIssueChat(key) {
	return (await listIssueChats())[key] ?? null;
}
/** Register (or with link null, forget) an issue's chat; stage "session" once Start session turned it into the work session. */
export async function setIssueChat(key, link, stage = 'discuss') {
	const chats = await listIssueChats();
	if (link) chats[key] = { link, stage, at: new Date().toISOString() };
	else delete chats[key];
	await fs.mkdir(MY_WORK_DIR, { recursive: true, mode: 0o700 });
	const tmp = path.join(MY_WORK_DIR, `.tmp-${process.pid}-${randomUUID()}.json`);
	await fs.writeFile(tmp, JSON.stringify({ format: 'my-work/issue-chats', version: 1, chats }, null, 2), { mode: 0o600 });
	await fs.rename(tmp, ISSUE_CHATS_FILE);
	return chats[key] ?? null;
}

// Sessions the user hid from the "Active sessions" suggestions (not deleted; just not suggested).
const HIDDEN_FILE = path.join(MY_WORK_DIR, 'hidden-sessions.json');
export async function getHiddenSessions() {
	try {
		const d = JSON.parse(await fs.readFile(HIDDEN_FILE, 'utf8'));
		return d?.format === 'my-work/hidden-sessions' && Array.isArray(d.ids) ? d.ids : [];
	} catch { return []; }
}
export async function setSessionHidden(id, hidden) {
	const ids = new Set(await getHiddenSessions());
	if (hidden) ids.add(id); else ids.delete(id);
	await fs.mkdir(MY_WORK_DIR, { recursive: true, mode: 0o700 });
	const tmp = path.join(MY_WORK_DIR, `.tmp-${process.pid}-${randomUUID()}.json`);
	// Keep the list bounded; old hidden sessions are long inactive anyway.
	await fs.writeFile(tmp, JSON.stringify({ format: 'my-work/hidden-sessions', version: 1, ids: [...ids].slice(-500) }, null, 2), { mode: 0o600 });
	await fs.rename(tmp, HIDDEN_FILE);
	return { id, hidden };
}
