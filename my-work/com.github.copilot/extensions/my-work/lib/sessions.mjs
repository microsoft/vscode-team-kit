// Finds Agents window sessions that work on an issue, by reading the Agents window's local session
// store read-only (<user-data>/User/globalStorage/agent-host.db). A session is linked to an issue
// when its title or one of its chats' titles mentions `#N`
// (e.g. "Fix #341126: …", "Investigate #342550 …"). This is an internal VS Code database, so every
// read is best effort: on any error the panel simply shows no sessions.
import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import { COPILOT_HOME } from './config.mjs';

const PRODUCT_DIRS = {
	'com.microsoft.VSCodeInsiders': 'Code - Insiders',
	'com.microsoft.VSCode': 'Code',
	'com.microsoft.VSCodeExploration': 'Code - Exploration',
	'com.visualstudio.code.oss': 'Code - OSS',
};

function dbPaths() {
	const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
		: process.platform === 'win32' ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
			: (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));
	const product = PRODUCT_DIRS[process.env.__CFBundleIdentifier];
	return (product ? [product] : ['Code - Insiders', 'Code']).map(p => path.join(base, p, 'User', 'globalStorage', 'agent-host.db'));
}

const ISSUE_REF_RE = /(?:([\w.-]+\/[\w.-]+))?#(\d{2,7})\b/g;
const json = v => { try { return v ? JSON.parse(v) : null; } catch { return null; } };

function readAll(file) {
	const db = new DatabaseSync(file, { readOnly: true });
	try {
		const sessions = new Map();
		for (const row of db.prepare('SELECT session_uri, payload, modified_time FROM sessions_v2 WHERE is_chat_backing = 0').all()) {
			const p = json(row.payload)?.data;
			if (!p) continue;
			const id = String(row.session_uri).replace(/^[\w-]+:\/+/, '');
			sessions.set(row.session_uri, {
				id, uri: row.session_uri,
				title: p.summary || '',
				archived: !!p.isArchived,
				read: p.isRead !== false,
				modified: Number(p.modifiedTime || row.modified_time) || 0,
				changes: p.changes || null,
				project: p.project?.displayName || null,
				texts: [p.summary || '', ...(p.chats || []).map(c => c.summary || '')],
				branch: null, prs: [],
				info: {
					chats: (p.chats || []).filter(c => !c.archived).map(c => c.summary || '').filter(Boolean).slice(0, 12),
					repo: p._meta?.git?.githubOwner && p._meta?.git?.githubRepo ? `${p._meta.git.githubOwner}/${p._meta.git.githubRepo}` : null,
					gitBranch: p._meta?.git?.branchName || null,
					baseBranch: p._meta?.git?.baseBranchName || null,
					outgoing: p._meta?.git?.outgoingChanges ?? null,
					uncommitted: p._meta?.git?.uncommittedChanges ?? null,
					workingDirectory: (p.workingDirectories || [])[0]?.replace(/^file:\/\//, '') || null,
					createdBy: p._meta?.['agentHost/createdBySession']?.session?.replace(/^[\w-]+:\/+/, '') || null,
				},
			});
		}
		for (const row of db.prepare('SELECT session_uri, title FROM session_chat_state').all()) {
			sessions.get(row.session_uri)?.texts.push(row.title || '');
		}
		for (const row of db.prepare("SELECT session_uri, key, value FROM session_state_values WHERE key IN ('copilot.worktree.branchName', 'sessionArtifacts')").all()) {
			const s = sessions.get(row.session_uri);
			if (!s) continue;
			if (row.key === 'copilot.worktree.branchName') s.branch = row.value || null;
			else for (const a of json(row.value) || []) {
				if (a?.type !== 'pullRequest') continue;
				const url = a.link || a.uri || a.url || null;
				s.prs.push({ label: a.label || 'Pull request', url: typeof url === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.test(url) ? url : null });
			}
		}
		return [...sessions.values()];
	} finally {
		db.close();
	}
}

let cache = { key: '', byRef: new Map(), all: [] };

/**
 * Sessions by issue reference: `#N` (any repo) and `owner/repo#N` when the reference names a repo.
 * Callers resolve a key like `microsoft/vscode#123` with sessionsFor().
 */
async function load() {
	for (const file of dbPaths()) {
		const stat = await fs.stat(file).catch(() => null);
		if (!stat) continue;
		const wal = await fs.stat(`${file}-wal`).catch(() => null);
		const key = `${file}:${stat.mtimeMs}:${wal?.mtimeMs ?? 0}`;
		if (cache.key === key) return cache.byRef;
		let all;
		try { all = readAll(file); } catch { return cache.byRef; }
		const byRef = new Map();
		const everything = [];
		for (const s of all) {
			const refs = new Set();
			for (const t of s.texts) for (const m of String(t).matchAll(ISSUE_REF_RE)) refs.add(m[1] ? `${m[1].toLowerCase()}#${m[2]}` : `#${m[2]}`);
			const pub = {
				id: s.id, title: s.title, archived: s.archived, read: s.read, modified: s.modified,
				changes: s.changes && (s.changes.additions || s.changes.deletions || s.changes.files) ? s.changes : null,
				project: s.project, branch: s.branch || s.info.gitBranch, info: s.info,
				// Latest PR per URL (sessions can record many); keep a few.
				prs: [...new Map(s.prs.filter(p => p.url).map(p => [p.url, p])).values()].slice(-3),
				link: `agent-host-session://ahp-session/${s.id}`,
			};
			everything.push({ ...pub, text: s.texts.join('\n').toLowerCase() });
			for (const r of refs) {
				if (!byRef.has(r)) byRef.set(r, []);
				byRef.get(r).push(pub);
			}
		}
		for (const list of byRef.values()) list.sort((a, b) => (a.archived - b.archived) || (b.modified - a.modified));
		cache = { key, byRef, all: everything };
		return byRef;
	}
	return cache.byRef;
}

// A bare `#N` belongs to the session's project repo; we only know the project's display name,
// so it matches when the repo name equals it (vscode → microsoft/vscode) or no project is set.
function matches(s, repo) {
	if (!s.project) return true;
	return repo.split('/')[1]?.toLowerCase() === s.project.toLowerCase();
}

/** Sessions for each of `keys` (owner/repo#N), skipping keys with none. */
export async function sessionsFor(keys) {
	const byRef = await load();
	const out = {};
	for (const key of keys) {
		const [repo, num] = key.split('#');
		const seen = new Set();
		const list = [...(byRef.get(`${repo.toLowerCase()}#${num}`) || []), ...(byRef.get(`#${num}`) || []).filter(s => matches(s, repo))]
			.filter(s => !seen.has(s.id) && seen.add(s.id));
		if (list.length) out[key] = list.slice(0, 8);
	}
	return out;
}

/** Sessions whose titles mention any of `terms` (e.g. MSRC case numbers). */
export async function sessionsMentioning(terms) {
	await load();
	const out = {};
	for (const term of terms) {
		const t = String(term).toLowerCase();
		const list = cache.all.filter(s => s.text.includes(t)).sort((a, b) => b.modified - a.modified).map(({ text, ...s }) => s);
		if (list.length) out[term] = list.slice(0, 8);
	}
	return out;
}

/** Every known session by id (for pinned sessions), and the most recently active open ones. */
export async function sessionsById(ids) {
	await load();
	const want = new Set(ids);
	return Object.fromEntries(cache.all.filter(s => want.has(s.id)).map(({ text, ...s }) => [s.id, s]));
}
export async function recentSessions(limit = 15) {
	await load();
	return cache.all.filter(s => !s.archived).sort((a, b) => b.modified - a.modified).slice(0, limit).map(({ text, ...s }) => s);
}

/**
 * Candidate issues for a session, in tiers (best first): its own title, its branch name, then its
 * chats' titles. Callers add the issues its PRs close as another tier. Bare `#N` below 1000 is ignored
 * (numbered lists, not issues).
 */
export async function issueCandidates(id) {
	await load();
	const z = cache.all.find(s => s.id === id);
	if (!z) return { session: null, tiers: [], prs: [] };
	const repo = z.info?.repo || (z.project ? `microsoft/${z.project}` : 'microsoft/vscode');
	const refsIn = texts => {
		const out = [];
		for (const t of texts) for (const m of String(t).matchAll(ISSUE_REF_RE)) {
			if (!m[1] && Number(m[2]) < 1000) continue;
			const k = m[1] ? `${m[1].toLowerCase()}#${m[2]}` : `${repo}#${m[2]}`;
			if (!out.includes(k)) out.push(k);
		}
		return out;
	};
	const branch = [...String(z.branch || '').matchAll(/(?:^|[^\d])(\d{4,7})(?!\d)/g)].map(m => `${repo}#${m[1]}`);
	const { text, ...pub } = z;
	return {
		session: pub,
		tiers: [{ via: 'session title', keys: refsIn([z.title]) }, { via: 'branch name', keys: [...new Set(branch)] }, { via: 'chat titles', keys: refsIn(z.info?.chats || []) },
			{ via: 'first request', keys: await sessionTranscript(id).then(t => refsIn([(t?.requests?.[0]?.text || '').slice(0, 300)])).catch(() => []) }],
		prs: (z.prs || []).map(p => p.url).filter(Boolean),
	};
}

// --- Session transcript: what the session was asked, its latest reply and what it touched. ---
// The Agents window keeps per-session data in <product>/agentSessionData/<id>/session.db, which
// points at the Copilot conversation (~/.copilot/session-state/<sdkSessionId>/events.jsonl).
// Both are internal formats, so every read is best effort.
function agentSessionDb(id) {
	return dbPaths().map(p => path.join(path.dirname(path.dirname(path.dirname(p))), 'agentSessionData', id, 'session.db'));
}
const transcriptCache = new Map(); // id -> { sig, data }

export async function sessionTranscript(id) {
	let dbFile;
	for (const f of agentSessionDb(id)) if (await fs.stat(f).catch(() => null)) { dbFile = f; break; }
	if (!dbFile) return null;
	let sdk = null, model = null, worktree = null;
	let edits = [];
	try {
		const db = new DatabaseSync(dbFile, { readOnly: true });
		try {
			const meta = Object.fromEntries(db.prepare('SELECT key, value FROM session_metadata').all().map(r => [r.key, r.value]));
			sdk = json(meta.defaultChatProviderData)?.sdkSessionId || null;
			model = json(meta['copilot.model'])?.id || null;
			worktree = (meta['copilot.worktree.path'] || meta['copilot.workingDirectory'] || '').replace(/^file:\/\//, '') || null;
			edits = db.prepare('SELECT file_path, edit_type, COUNT(*) n FROM file_edits GROUP BY file_path, edit_type').all()
				.map(r => ({ path: worktree && r.file_path.startsWith(worktree + '/') ? r.file_path.slice(worktree.length + 1) : r.file_path, type: r.edit_type, n: r.n }));
		} finally { db.close(); }
	} catch { /* metadata unavailable */ }
	if (!sdk || !/^[\w-]+$/.test(sdk)) return { model, edits, requests: [], latest: null };
	const dir = path.join(COPILOT_HOME, 'session-state', sdk);
	const events = path.join(dir, 'events.jsonl');
	const st = await fs.stat(events).catch(() => null);
	if (!st) return { model, edits, requests: [], latest: null };
	const sig = `${st.mtimeMs}:${st.size}`;
	const hit = transcriptCache.get(id);
	if (hit?.sig === sig) return { ...hit.data, model, edits };
	const requests = [];
	const skills = new Set();
	let latest = null, turns = 0, tools = 0, subagents = 0, open = 0, lastAt = null, shutdown = false;
	const rl = readline.createInterface({ input: createReadStream(events, { encoding: 'utf8' }), crlfDelay: Infinity });
	for await (const line of rl) {
		// Cheap pre-filter: most lines are hooks and tool events.
		if (!/"type":"(user\.message|assistant\.message|assistant\.turn_(start|end)|tool\.execution_start|skill\.invoked|subagent\.started|session\.shutdown|session\.resume)"/.test(line.slice(0, 80))) continue;
		let e; try { e = JSON.parse(line); } catch { continue; }
		const d = e.data || {};
		lastAt = e.timestamp || lastAt;
		switch (e.type) {
			case 'user.message': requests.push({ at: e.timestamp, text: String(d.content || '').slice(0, 1500), auto: !!d.source }); break;
			case 'assistant.message': if (d.content && !d.parentToolCallId) latest = { at: e.timestamp, text: String(d.content).slice(0, 6000) }; break;
			case 'assistant.turn_start': turns++; open++; break;
			case 'assistant.turn_end': open = Math.max(0, open - 1); break;
			case 'tool.execution_start': tools++; break;
			case 'skill.invoked': if (d.name || d.skillName) skills.add(d.name || d.skillName); break;
			case 'subagent.started': subagents++; break;
			case 'session.shutdown': shutdown = true; break;
			case 'session.resume': shutdown = false; break;
		}
	}
	let checkpoints = [];
	try {
		checkpoints = (await fs.readFile(path.join(dir, 'checkpoints', 'index.md'), 'utf8')).split('\n')
			.map(l => l.match(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|/)).filter(Boolean).map(m => ({ n: Number(m[1]), title: m[2] }));
	} catch { }
	const data = { requests: requests.slice(-12), requestCount: requests.length, latest, turns, tools, subagents, skills: [...skills], working: open > 0 && !shutdown, lastAt, checkpoints };
	transcriptCache.set(id, { sig, data });
	return { ...data, model, edits };
}
