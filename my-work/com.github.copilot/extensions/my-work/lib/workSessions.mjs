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
	if (!item) { item = { key, bucket: BUCKETS.includes(bucket) ? bucket : 'current', sessions: [], addedAt: new Date().toISOString() }; items.push(item); }
	if (sessionId && !item.sessions.includes(sessionId)) item.sessions.push(sessionId);
	await write(items);
	return item;
}
export async function setIssueBucket(key, bucket) {
	if (!BUCKETS.includes(bucket)) throw Object.assign(new Error('invalid group'), { code: 'bad_input', status: 400 });
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

export async function pinSession(id, note = '', bucket = 'current') {
	const items = await read();
	const at = items.findIndex(i => i.id === id);
	if (at >= 0) { if (note) { items[at].note = note; await write(items); } return items[at]; }
	const item = { id, note, bucket: BUCKETS.includes(bucket) ? bucket : 'current', addedAt: new Date().toISOString() };
	items.push(item);
	await write(items);
	return item;
}

/** Place a pinned session in the current / next milestone group or in My priorities (local only). */
export async function setSessionBucket(id, bucket) {
	if (!BUCKETS.includes(bucket)) throw Object.assign(new Error('invalid group'), { code: 'bad_input', status: 400 });
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
