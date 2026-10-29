import http from 'node:http';
import { execFile } from 'node:child_process';
import { promises as fs, watch as watchFs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as data from './data.mjs';
import { spawnJudgeRequest, implementPrompt, createIssueChatPrompt, forwardToIssueChatPrompt, forwardToMyWorkSessionPrompt, startIssueSessionMessage, notificationIssueActionPrompt, notificationTriagePrompt, issueRulesPrompt, browseQueryPrompt, workSessionPrompt, noteSessionPrompt, createMyWorkChatPrompt, forwardToMyWorkChatPrompt, describeSessionMessage } from './prompts.mjs';
import { getVsCodeTheme, watchVsCodeTheme } from './vscodeTheme.mjs';
import { getMyWork, moveToMilestone, issueDetails, closingIssues, workSource, sourceQuery, myLogin, doneState } from './work.mjs';
import { config } from './config.mjs';
import { saveImage, imagePaths, MAX_IMAGE_BYTES } from './attachments.mjs';
import { listSections, saveSection, setSectionOrder, moveSection, removeSection, listNotes, getNote, saveNote, removeNote, getSection, isGroup } from './sections.mjs';
import { sessionsFor, sessionsMentioning, sessionsById, recentSessions, issueCandidates, sessionTranscript } from './sessions.mjs';
import { listPinned, pinSession, unpinSessions, parseSessionRef, getMyWorkChat, getHiddenSessions, setSessionHidden, setSessionBucket, BUCKETS, moveBucket, listPinnedIssues, pinIssue, setIssueBucket, unpinIssues, markSummaryRequested, markSessionSummaryRequested, getSessionSummaries, getIssueChat, setIssueChat, setMyWorkChat } from './workSessions.mjs';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
// Scripts, styles and data come only from this server; images and videos only from GitHub's own hosts
// (user attachments redirect to GitHub's S3 bucket).
const GITHUB_MEDIA = 'https://github.com https://*.githubusercontent.com https://github-production-user-asset-6210df.s3.amazonaws.com';
const CSP = [
	"default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "font-src 'self'", "connect-src 'self'",
	`img-src 'self' data: ${GITHUB_MEDIA}`, `media-src 'self' ${GITHUB_MEDIA}`, "base-uri 'none'", "form-action 'none'",
].join('; ');
const ASSET_TYPES = { 'app.js': 'text/javascript; charset=utf-8', 'style.css': 'text/css; charset=utf-8', 'codicon.ttf': 'font/ttf' };
// The icon font is not bundled (no binaries in the plugin); it is served from the VS Code installation.
async function findCodiconFont() {
	const rel = ['out', 'media', 'codicon.ttf'];
	const apps = process.platform === 'darwin'
		? ['Visual Studio Code - Insiders', 'Visual Studio Code', 'Visual Studio Code - Exploration'].flatMap(n => [`/Applications/${n}.app`, path.join(os.homedir(), 'Applications', `${n}.app`)]).map(a => path.join(a, 'Contents', 'Resources', 'app'))
		: process.platform === 'win32'
			? ['Microsoft VS Code Insiders', 'Microsoft VS Code'].flatMap(n => [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', n), process.env.ProgramFiles && path.join(process.env.ProgramFiles, n)]).filter(Boolean).map(a => path.join(a, 'resources', 'app'))
			: ['/usr/share/code-insiders', '/usr/share/code', '/opt/visual-studio-code-insiders', '/opt/visual-studio-code'].map(a => path.join(a, 'resources', 'app'));
	if (process.env.VSCODE_CWD) apps.unshift(path.join(process.env.VSCODE_CWD, 'resources', 'app'));
	for (const app of apps) {
		const file = path.join(app, ...rel);
		if (await fs.stat(file).catch(() => null)) return file;
	}
	return null;
}
let codiconFont;

const KEY_RE = /^[\w.-]+\/[\w.-]+#\d+$/;
const ID_RE = /^\d+$/;
const GROUPS = new Set(['fixed', 'duplicate', 'reason', 'needs-info']);
const DECISIONS = new Set(['rejected', 'deferred']);
const TABS = new Set(data.TAB_KEYS);
const THEMES = new Set(['vscode', 'system', 'light', 'dark', 'midnight']);
const ACCENTS = new Set(['blue', 'violet', 'green', 'orange', 'pink']);

function bad(message) {
	return Object.assign(new Error(message), { status: 400 });
}

function readBody(req, limit = 256 * 1024) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on('data', c => {
			size += c.length;
			if (size > limit) { reject(bad('body too large')); req.destroy(); return; }
			chunks.push(c);
		});
		req.on('end', () => {
			try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(bad('invalid JSON')); }
		});
		req.on('error', reject);
	});
}

// The URL scheme of the VS Code build hosting this process, so issue/PR links can be handed to the
// GitHub Pull Requests extension (it registers vscode://github.vscode-pull-request-github/...).
const BUNDLE_SCHEMES = {
	'com.microsoft.VSCodeInsiders': 'vscode-insiders',
	'com.microsoft.VSCode': 'vscode',
	'com.microsoft.VSCodeExploration': 'vscode-exploration',
	'com.visualstudio.code.oss': 'code-oss',
};
const PRODUCT_SCHEME = process.env.VSCODE_URL_PROTOCOL || BUNDLE_SCHEMES[process.env.__CFBundleIdentifier] || null;
const GH_ITEM_RE = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)\/?$/;

export function vscodeLinkFor(url) {
	if (!PRODUCT_SCHEME) return null;
	const clean = new URL(url);
	clean.search = '';
	clean.hash = '';
	const m = GH_ITEM_RE.exec(clean.href);
	if (!m) return null;
	const canonical = `https://github.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
	const path = m[3] === 'issues' ? 'open-issue-webview' : 'open-pull-request-webview';
	return `${PRODUCT_SCHEME}://github.vscode-pull-request-github/${path}?uri=${encodeURIComponent(canonical)}`;
}

// Fallback for pasting into the panel: some hosts don't deliver ⌘V/Ctrl+V to the embedded page.
function readClipboard() {
	const [cmd, args] = process.platform === 'darwin' ? ['pbpaste', []]
		: process.platform === 'win32' ? ['powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard -Raw']]
			: ['sh', ['-c', 'wl-paste --no-newline 2>/dev/null || xclip -selection clipboard -o 2>/dev/null || xsel -b -o']];
	return new Promise((resolve, reject) => {
		execFile(cmd, args, { timeout: 5_000, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(String(stdout)));
	});
}

function openExternal(url) {
	const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
		: process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
			: ['xdg-open', [url]];
	return new Promise((resolve, reject) => {
		execFile(cmd, args, { timeout: 10_000 }, error => error ? reject(error) : resolve());
	});
}

// The Browse view's last source, area and filter, kept with the settings so it survives reopening the panel.
function cleanBrowse(b) {
	if (!b || typeof b !== 'object') throw Object.assign(new Error('invalid browse'), { status: 400 });
	const str = (v, max) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
	const source = ['bugs', 'features', 'area', 'reviews', 'mine'].includes(b.source) ? b.source : 'bugs';
	const area = /^[a-z0-9_-]{0,40}$/.test(b.area || '') ? (b.area || '') : '';
	const refine = b.refine && str(b.refine.query, 300) ? { query: str(b.refine.query, 300), text: str(b.refine.text, 300), note: str(b.refine.note, 300) } : null;
	const groupBy = ['', 'reporter', 'milestone', 'age', 'interest', 'label'].includes(b.groupBy) ? b.groupBy : '';
	return { source, area, refine, groupBy };
}

function prKeyOf(url) {
	const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/.exec(String(url || ''));
	return m ? `${m[1]}#${m[2]}` : null;
}

export class TriageServer {
	/** Send to the nested My Work chat, creating it (via the triage chat) the first time. */
	async sendToMyWorkChat(text) {
		const link = await getMyWorkChat();
		await this.sendToChat(link ? forwardToMyWorkChatPrompt(link, text) : createMyWorkChatPrompt(text));
	}

	/**
	 * The open issue a session works on. Tiers: its title, its branch name, the issues its PRs close,
	 * then its chats' titles. Only a tier with exactly one open issue counts; anything ambiguous is
	 * left to the My Work chat (which reads the session).
	 */
	async resolveSessionIssue(id) {
		const c = await issueCandidates(id).catch(() => null);
		if (!c?.session) return null;
		const prKeys = [];
		for (const pr of c.prs.slice(0, 5)) prKeys.push(...await closingIssues(pr));
		const tiers = [c.tiers[0], c.tiers[1], { via: 'pull request', keys: [...new Set(prKeys)] }, c.tiers[3], c.tiers[2]].filter(t => t?.keys.length);
		if (!tiers.length) return null;
		const det = await issueDetails([...new Set(tiers.flatMap(t => t.keys))]).catch(() => ({}));
		for (const t of tiers) {
			const open = t.keys.filter(k => det[k]?.type === 'Issue' && det[k].state === 'OPEN');
			if (open.length === 1) return { key: open[0], via: t.via, title: det[open[0]].title };
			if (open.length > 1) return null;
		}
		return null;
	}

	constructor(log, sendToChat) {
		this.log = log;
		this.sendToChat = sendToChat;
		this.token = randomBytes(24).toString('hex');
		this.clients = new Set();
		this.focus = null;
		this.server = http.createServer((req, res) => {
			this.handle(req, res).catch(error => {
				const status = error.status ?? (error.code === 'not_found' ? 404 : 500);
				if (status === 500) this.log(`my-issues-triage: ${error.message}`, 'error');
				this.json(res, status, { error: error.message });
			});
		});
	}

	async start() {
		await new Promise((resolve, reject) => {
			this.server.once('error', reject);
			this.server.listen(0, '127.0.0.1', resolve);
		});
		this.port = this.server.address().port;
		this.unwatchTheme = watchVsCodeTheme(theme => this.push('theme', { theme }));
		// Reload open pages when the panel's assets change, so script/style fixes apply without reopening.
		try {
			let timer;
			const watcher = watchFs(ASSETS, () => { clearTimeout(timer); timer = setTimeout(() => this.push('reload', {}), 400); });
			this.unwatchAssets = () => { clearTimeout(timer); watcher.close(); };
		} catch { /* watching is best effort */ }
		return `http://127.0.0.1:${this.port}/`;
	}

	async stop() {
		this.unwatchTheme?.();
		this.unwatchAssets?.();
		for (const res of this.clients) res.end();
		this.clients.clear();
		await new Promise(resolve => this.server.close(() => resolve()));
	}

	push(event, payload = {}) {
		const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
		for (const res of this.clients) res.write(msg);
	}

	setFocus(focus) {
		this.focus = { ...focus, at: Date.now() };
		this.push('focus', focus);
	}

	/** Send a request that creates chats: run it in the My Work session so they are nested there, even from a panel opened elsewhere. */
	async sendToMyWorkSession(request) {
		const link = await data.myWorkSessionLink();
		await this.sendToChat(link ? forwardToMyWorkSessionPrompt(link, request) : request);
	}

	async browseSource(source, areaId) {
		source = String(source || '');
		if (!['bugs', 'features', 'area', 'reviews', 'mine'].includes(source)) throw Object.assign(new Error('unknown source'), { status: 400 });
		// "area" was a source of its own in earlier versions: it is All issues narrowed to an area.
		if (source === 'area') source = 'mine';
		if (!areaId || source === 'reviews') return { source, labels: [] };
		const area = (await data.getAreas()).find(a => a.id === areaId);
		if (!area?.labels?.length) throw Object.assign(new Error('unknown area'), { status: 400 });
		return { source, labels: area.labels };
	}

	json(res, status, body) {
		if (res.headersSent) { res.end(); return; }
		res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
		res.end(JSON.stringify(body));
	}

	checkWrite(req) {
		const origin = req.headers.origin;
		if (origin && origin !== `http://127.0.0.1:${this.port}` && origin !== `http://localhost:${this.port}`) throw Object.assign(new Error('forbidden origin'), { status: 403 });
		this.checkToken(req, new URL(req.url, `http://127.0.0.1:${this.port}`));
	}

	// Reject requests addressed to any other host name, so a web page can't reach this server
	// through DNS rebinding (an attacker's host name that resolves to 127.0.0.1).
	checkHost(req) {
		const host = String(req.headers.host || '').toLowerCase();
		if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) throw Object.assign(new Error('forbidden host'), { status: 403 });
	}

	// Every API call, reads included, needs the per-run token embedded in the page.
	checkToken(req, url) {
		const token = req.headers['x-triage-token'] || url.searchParams.get('t');
		const a = Buffer.from(String(token || '')), b = Buffer.from(this.token);
		if (a.length !== b.length || !timingSafeEqual(a, b)) throw Object.assign(new Error('invalid token'), { status: 403 });
	}

	async handle(req, res) {
		this.checkHost(req);
		const url = new URL(req.url, `http://127.0.0.1:${this.port}`);
		const route = `${req.method} ${url.pathname}`;
		if (url.pathname.startsWith('/api/')) this.checkToken(req, url);

		if (route === 'GET /') {
			const stamp = async name => (await fs.stat(path.join(ASSETS, name))).mtimeMs.toFixed(0);
			const html = (await fs.readFile(path.join(ASSETS, 'index.html'), 'utf8'))
				.replace('__TOKEN__', this.token)
				.replace('/assets/style.css', `/assets/style.css?v=${await stamp('style.css')}`)
				.replace('/assets/app.js', `/assets/app.js?v=${await stamp('app.js')}`);
			res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
			res.end(html);
			return;
		}
		if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
			const name = url.pathname.slice('/assets/'.length);
			if (!ASSET_TYPES[name]) throw Object.assign(new Error('not found'), { status: 404 });
			const file = name === 'codicon.ttf' ? (codiconFont ??= await findCodiconFont()) : path.join(ASSETS, name);
			if (!file) throw Object.assign(new Error('codicon font not found'), { status: 404 });
			res.writeHead(200, { 'content-type': ASSET_TYPES[name], 'cache-control': 'no-store' });
			res.end(await fs.readFile(file));
			return;
		}
		if (route === 'GET /api/events') {
			res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
			res.write(': connected\n\n');
			if (this.focus && Date.now() - this.focus.at < 120_000) res.write(`event: focus\ndata: ${JSON.stringify(this.focus)}\n\n`);
			this.clients.add(res);
			req.on('close', () => this.clients.delete(res));
			return;
		}
		if (route === 'GET /api/state') {
			this.json(res, 200, await data.getState({ forceNotifications: url.searchParams.get('fresh') === '1' }));
			return;
		}
		if (route === 'GET /api/checks') {
			const key = url.searchParams.get('key') || '';
			if (!KEY_RE.test(key)) throw bad('invalid key');
			this.json(res, 200, await data.getChecks(key, url.searchParams.get('fresh') === '1'));
			return;
		}
		if (route === 'GET /api/vscode-theme') {
			this.json(res, 200, { theme: await getVsCodeTheme() });
			return;
		}
		if (route === 'GET /api/work-source') {
			const { source, labels } = await this.browseSource(url.searchParams.get('source'), url.searchParams.get('area'));
			this.json(res, 200, { source, items: await workSource(source, { labels, refine: url.searchParams.get('refine') || '', fresh: url.searchParams.get('fresh') === '1' }) });
			return;
		}
		if (route === 'GET /api/session-info') {
			const id = parseSessionRef(url.searchParams.get('id'));
			if (!id) throw bad('invalid session');
			const pinned = (await listPinned()).some(p => p.id === id);
			const [transcript, issue] = await Promise.all([sessionTranscript(id).catch(() => null), pinned ? this.resolveSessionIssue(id).catch(() => null) : null]);
			this.json(res, 200, { id, transcript, issue });
			return;
		}
		if (route === 'GET /api/work') {
			const work = await getMyWork({ fresh: url.searchParams.get('fresh') === '1' });
			const keys = work.milestones.flatMap(m => m.items.map(i => i.key));
			const [sections, notes] = await Promise.all([listSections(), listNotes()]);
			const pinned = await listPinned();
			const byId = await sessionsById(pinned.map(p => p.id)).catch(() => ({}));
			// Finished sessions stay, marked with their status, until the user clears them: done (archived), or its pull request merged/closed.
			const prKeys = pinned.flatMap(p => (byId[p.id]?.prs || []).map(pr => prKeyOf(pr.url)).filter(Boolean));
			const prDet = prKeys.length ? await issueDetails([...new Set(prKeys)], url.searchParams.get('fresh') === '1').catch(() => ({})) : {};
			const pinnedSessions = pinned.map(p => {
				const z = byId[p.id] || null;
				const lastPr = (z?.prs || []).map(pr => prKeyOf(pr.url)).filter(Boolean).at(-1);
				return { ...p, session: z, status: z?.archived ? 'done' : lastPr ? doneState(prDet[lastPr]?.state) : null };
			});
			const hidden = new Set(await getHiddenSessions());
			const recent = (await recentSessions(40).catch(() => [])).filter(r => !pinned.some(p => p.id === r.id) && !hidden.has(r.id)).slice(0, 20);
			// Issues added locally (e.g. resolved from a session): details from GitHub; closed ones stay, marked, until cleared.
			const pinIssues = await listPinnedIssues();
			const det = await issueDetails(pinIssues.map(p => p.key), url.searchParams.get('fresh') === '1').catch(() => ({}));
			const pinnedIssues = pinIssues.map(p => {
				const d = det[p.key] || {};
				return { ...p, title: d.title || p.key, url: d.url || `https://github.com/${p.key.replace('#', '/issues/')}`, labels: d.labels || [], isBug: (d.labels || []).includes('bug'), milestone: d.milestone || null, updatedAt: d.updatedAt || p.addedAt, state: doneState(d.state) };
			});
			const sessions = await sessionsFor([...keys, ...pinnedIssues.map(p => p.key)]).catch(() => ({}));
			// Sessions linked explicitly (resolved from a branch or PR) show on their issue too.
			const linked = await sessionsById(pinnedIssues.flatMap(p => p.sessions || [])).catch(() => ({}));
			for (const p of pinnedIssues) for (const sid of p.sessions || []) {
				const z = linked[sid];
				if (!z) continue;
				const list = sessions[p.key] ||= [];
				if (!list.some(x => x.id === sid)) list.unshift({ ...z, link: `agent-host-session://ahp-session/${sid}` });
			}
			this.json(res, 200, { ...work, sections, notes, pinnedSessions, pinnedIssues, recentSessions: recent, myWorkChat: await getMyWorkChat(), sessionSummaries: await getSessionSummaries(), noteSessions: await sessionsMentioning(notes.map(n => n.ref || n.title)).catch(() => ({})), sessions });
			return;
		}
		if (route === 'GET /api/github') {
			const key = url.searchParams.get('key') || '';
			if (!KEY_RE.test(key)) throw bad('invalid key');
			this.json(res, 200, await data.getGitHubDetail(key, url.searchParams.get('fresh') === '1'));
			return;
		}
		if (route === 'GET /api/attachment') {
			const [file] = await imagePaths([url.searchParams.get('name')]);
			if (!file) throw Object.assign(new Error('not found'), { status: 404 });
			const type = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[file.split('.').pop()];
			res.writeHead(200, { 'content-type': type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' });
			res.end(await fs.readFile(file));
			return;
		}
		if (route === 'GET /api/issue') {
			const key = url.searchParams.get('key') || '';
			if (!KEY_RE.test(key)) throw bad('invalid key');
			this.json(res, 200, await data.getIssueDetail(key));
			return;
		}

		if (req.method !== 'POST') throw Object.assign(new Error('not found'), { status: 404 });
		this.checkWrite(req);
		// Pasted screenshots are the only large uploads (base64 of up to 8 MB).
		const body = await readBody(req, url.pathname === '/api/attachment' ? Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4096 : undefined);
		let result;
		switch (url.pathname) {
			case '/api/apply': {
				if (!KEY_RE.test(body.key || '')) throw bad('invalid key');
				if (typeof body.comment !== 'string' || !body.comment.trim() || body.comment.length > 20000) throw bad('comment required');
				if (body.group != null && !GROUPS.has(body.group)) throw bad('invalid group');
				result = await data.applyCleanup({ key: body.key, comment: body.comment, group: body.group ?? undefined, note: typeof body.note === 'string' ? body.note.slice(0, 500) : '' });
				break;
			}
			case '/api/record': {
				if (!KEY_RE.test(body.key || '')) throw bad('invalid key');
				if (!DECISIONS.has(body.decision)) throw bad('invalid decision');
				result = await data.recordDecision({ key: body.key, decision: body.decision, note: typeof body.note === 'string' ? body.note.slice(0, 500) : '' });
				break;
			}
			case '/api/settings': {
				const patch = {};
				if (body.batchSize !== undefined) {
					if (!Number.isInteger(body.batchSize) || body.batchSize < 1 || body.batchSize > 50) throw bad('batchSize must be 1-50');
					patch.batchSize = body.batchSize;
				}
				if (body.popularThreshold !== undefined) {
					if (!Number.isInteger(body.popularThreshold) || body.popularThreshold < 1 || body.popularThreshold > 1000) throw bad('popularThreshold must be 1-1000');
					patch.popularThreshold = body.popularThreshold;
				}
				if (body.recentCollapsed !== undefined) patch.recentCollapsed = !!body.recentCollapsed;
				if (body.browse !== undefined) patch.browse = cleanBrowse(body.browse);
				if (body.collapsedGroups !== undefined) {
					if (!Array.isArray(body.collapsedGroups) || body.collapsedGroups.length > 20 || !body.collapsedGroups.every(r => typeof r === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(r))) throw bad('invalid collapsedGroups');
					patch.collapsedGroups = [...new Set(body.collapsedGroups)];
				}
				if (body.browseHistory !== undefined) {
					if (!Array.isArray(body.browseHistory)) throw bad('invalid browseHistory');
					patch.browseHistory = body.browseHistory.slice(0, 15).map(h => ({ ...cleanBrowse(h), at: typeof h?.at === 'string' && !Number.isNaN(Date.parse(h.at)) ? h.at : new Date().toISOString() })).filter(h => h.refine);
				}
				if (body.theme !== undefined) {
					if (!THEMES.has(body.theme)) throw bad('invalid theme');
					patch.theme = body.theme;
				}
				if (body.chatHeight !== undefined) {
					if (!Number.isInteger(body.chatHeight) || body.chatHeight < 48 || body.chatHeight > 2000) throw bad('chatHeight must be 48-2000');
					patch.chatHeight = body.chatHeight;
				}
				if (body.chatCollapsed !== undefined) {
					if (typeof body.chatCollapsed !== 'boolean') throw bad('chatCollapsed must be boolean');
					patch.chatCollapsed = body.chatCollapsed;
				}
				if (body.linkTarget !== undefined) {
					if (body.linkTarget !== 'vscode' && body.linkTarget !== 'browser') throw bad('invalid linkTarget');
					patch.linkTarget = body.linkTarget;
				}
				if (body.areaFilter !== undefined) {
					if (typeof body.areaFilter !== 'string' || !/^[a-z0-9_-]{0,40}$/.test(body.areaFilter)) throw bad('invalid areaFilter');
					patch.areaFilter = body.areaFilter;
				}
				if (body.listHeight !== undefined) {
					if (!Number.isInteger(body.listHeight) || body.listHeight < 15 || body.listHeight > 85) throw bad('listHeight must be 15-85 (percent)');
					patch.listHeight = body.listHeight;
				}
				if (body.density !== undefined) {
					if (!['auto', 'comfortable', 'compact'].includes(body.density)) throw bad('invalid density');
					patch.density = body.density;
				}
				if (body.accent !== undefined) {
					if (!ACCENTS.has(body.accent)) throw bad('invalid accent');
					patch.accent = body.accent;
				}
				result = await data.setSettings(patch);
				break;
			}
			case '/api/next-batch':
				if (!TABS.has(body.tab)) throw bad('invalid tab');
				result = await data.advanceBatch(body.tab);
				if (body.tab === 'notifications' && this.sendToChat) {
					const items = await data.notificationsToTriage(50, { ids: result.ids });
					if (items.length) {
						await this.sendToChat(notificationTriagePrompt({ items, customGroups: await data.getCustomGroups() }));
						await data.logActivity({ kind: 'notif-triage-request', ids: items.map(n => n.id) });
					}
					result = { ...result, triageRequested: items.length };
				}
				break;
			case '/api/clipboard-read': {
				const text = await readClipboard();
				data.notePasteFallback?.();
				// Respond directly: reading the clipboard changes nothing, so no 'changed' push (it would re-render the panel).
				this.json(res, 200, { text: process.platform === 'win32' ? text.replace(/\r?\n$/, '') : text });
				return;
			}
			case '/api/browse-ask': {
				if (!this.sendToChat) throw Object.assign(new Error('This canvas is not attached to a chat'), { status: 409 });
				const text = String(body.text ?? '').replace(/\s+/g, ' ').trim();
				if (!text || text.length > 300) throw bad('text must be 1-300 characters');
				const { source, labels } = await this.browseSource(body.source, body.area);
				await this.sendToChat(browseQueryPrompt({ text, scope: await sourceQuery(source, { labels }), org: config().org, me: await myLogin() }));
				result = { sent: true };
				break;
			}
			case '/api/issue-rules': {
				if (!this.sendToChat) throw Object.assign(new Error('This canvas is not attached to a chat'), { status: 409 });
				const keys = Array.isArray(body.keys) ? body.keys.filter(k => KEY_RE.test(k || '')).slice(0, 60) : [];
				if (!keys.length) throw bad('keys required');
				const recompute = !!body.recompute;
				const items = (await data.issuesToCheck(keys, { recompute })).slice(0, 30);
				if (!items.length) { result = { sent: false, count: 0 }; break; }
				await this.sendToChat(issueRulesPrompt({ items, recompute }));
				await data.logActivity({ kind: 'issue-rules-request', keys: items.map(i => i.key), recompute });
				result = { sent: true, count: items.length };
				break;
			}
			case '/api/route-issues': {
				const keys = Array.isArray(body.keys) ? body.keys : [];
				if (!keys.length || keys.length > 100 || !keys.every(k => KEY_RE.test(k || ''))) throw bad('invalid keys');
				const done = [];
				const failed = [];
				for (const key of keys) {
					try { done.push(await data.routeIssue({ key })); } catch (error) { failed.push({ key, error: error.message }); }
				}
				result = { routed: done.length, done: done.map(d => d.key), results: done, failed };
				break;
			}
			case '/api/triage-more': {
				if (!this.sendToChat) throw Object.assign(new Error('This canvas is not attached to a chat'), { status: 409 });
				const count = Math.max(1, Math.min(50, Number(body.count) || 25));
				const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(id => ID_RE.test(id)).slice(0, 200) : undefined;
				const recompute = !!body.recompute;
				const items = await data.notificationsToTriage(count, { ids, recompute });
				if (!items.length) { result = { sent: false, count: 0 }; break; }
				await this.sendToChat(notificationTriagePrompt({ items, recompute, customGroups: await data.getCustomGroups() }));
				await data.logActivity({ kind: 'notif-triage-request', ids: items.map(n => n.id), recompute });
				result = { sent: true, count: items.length };
				break;
			}
			case '/api/ask': {
				if (!['opinion', 'implement', 'notification-start', 'notification-investigate', 'issue-investigate'].includes(body.kind)) throw bad('invalid kind');
				if (!this.sendToChat) throw Object.assign(new Error('This canvas is not attached to a chat'), { status: 409 });
				if (body.kind === 'issue-investigate') {
					if (!KEY_RE.test(body.key || '')) throw bad('invalid key');
					const [repo, num] = body.key.split('#');
					const detail = await data.getIssueDetail(body.key).catch(() => null);
					const item = { issueKey: body.key, title: detail?.issue.title || body.key, htmlUrl: detail?.issue.url || `https://github.com/${repo}/issues/${num}` };
					await this.sendToChat(notificationIssueActionPrompt({ action: 'investigate', notification: item }));
					result = { sent: true, kind: body.kind, key: body.key };
					break;
				}
				if (body.kind === 'notification-start' || body.kind === 'notification-investigate') {
					if (!ID_RE.test(String(body.id || ''))) throw bad('invalid notification id');
					const state = await data.getState();
					const notification = state.notifications.find(item => item.id === String(body.id));
					if (!notification) throw Object.assign(new Error('This notification is no longer unread'), { status: 404 });
					if (notification.type !== 'Issue' || !KEY_RE.test(notification.issueKey || '')) throw bad('notification is not an issue');
					const action = body.kind === 'notification-start' ? 'start' : 'investigate';
					const prompt = notificationIssueActionPrompt({ action, notification });
					await (action === 'start' ? this.sendToMyWorkSession(prompt) : this.sendToChat(prompt));
					result = { sent: true, kind: body.kind, id: notification.id, key: notification.issueKey };
					break;
				}
				if (body.kind === 'implement') {
					if (!KEY_RE.test(body.key || '')) throw bad('invalid key');
					await this.sendToMyWorkSession(implementPrompt(await data.getIssueDetail(body.key)));
					await data.logStart(body.key);
					result = { sent: true, kind: body.kind, key: body.key };
					break;
				}
				const keys = Array.isArray(body.keys) ? body.keys : [body.key];
				if (!keys.length || keys.length > 20 || !keys.every(k => KEY_RE.test(k || ''))) throw bad('invalid keys');
				const informed = body.mode === 'informed';
				if (informed && keys.length !== 1) throw bad('informed re-judging takes one issue');
				const judge = await data.runScript(['judge-prompt', ...(informed ? ['--informed'] : []), ...keys]);
				await this.sendToChat(spawnJudgeRequest({ title: judge.title, prompt: judge.prompt, keys: judge.keys }));
				for (const k of keys) await data.logActivity({ kind: 'opinion-request', key: k, mode: informed ? 'informed' : 'blind' });
				result = { sent: true, kind: 'opinion', mode: informed ? 'informed' : 'blind', keys };
				break;
			}
			case '/api/open-session': {
				const link = String(body.link || '');
				// A nested chat's link carries ?chat=<id>; the Agents window takes it as a /chat/<id> path segment.
				const m = /^agent-host-session:\/\/([\w-]+)\/([\w-]+)(?:\?chat=([\w-]+))?$/.exec(link);
				if (!m || !PRODUCT_SCHEME) throw bad('not a session link');
				await openExternal(`${PRODUCT_SCHEME}://agents/agent-host-session/${m[1].toLowerCase()}/${m[2]}${m[3] ? `/chat/${m[3]}` : ''}`);
				this.json(res, 200, { opened: link });
				return;
			}
			case '/api/move-milestone': {
				if (!KEY_RE.test(body.key || '')) throw bad('invalid key');
				const title = body.title == null ? null : String(body.title);
				if (title !== null && (!title || title.length > 80)) throw bad('invalid milestone');
				result = await moveToMilestone(body.key, title);
				await data.logActivity({ kind: 'plan', key: body.key, milestone: title });
				break;
			}
			case '/api/priorities': {
				const op = String(body.op || '');
				if (!['add', 'remove', 'move'].includes(op)) throw bad('invalid op');
				if (!KEY_RE.test(body.key || '') && !/^session:[\w-]{8,80}$/.test(body.key || '')) throw bad('invalid key');
				const to = body.to;
				if (to !== undefined && !['top', 'bottom', 'up', 'down'].includes(to) && !(Number.isInteger(to) && to >= 0 && to < 10000)) throw bad('invalid position');
				const list = await data.updatePriorities({ op, key: body.key, to });
				await data.logActivity({ kind: 'priority', key: body.key, op, to: to ?? null });
				result = { priorities: list.map(p => p.key) };
				break;
			}
			case '/api/section': {
				if (body.op === 'save') result = await saveSection({ id: body.id || undefined, name: body.name, instructions: body.instructions, linkPattern: body.linkPattern });
				else if (body.op === 'move') result = await moveSection(String(body.id || ''), body.dir === 'up' ? 'up' : 'down');
				else if (body.op === 'order') result = await setSectionOrder(String(body.id || ''), body.order);
				else if (body.op === 'remove') {
					const id = String(body.id || '');
					result = await removeSection(id);
					// Its issues and sessions go back to Current; its notes are deleted with it.
					if (result.removed) result.moved = await moveBucket(id, 'current');
				}
				else throw bad('invalid op');
				break;
			}
			case '/api/note': {
				if (body.op === 'remove') { result = await removeNote(String(body.id || '')); break; }
				if (body.op !== 'save') throw bad('invalid op');
				result = await saveNote({ id: body.id || undefined, section: String(body.section || ''), title: body.title, link: body.link, ref: body.ref, description: body.description, due: body.due });
				break;
			}
			case '/api/work-pin': {
				const id = parseSessionRef(body.id ?? body.link);
				if (!id) throw bad('Enter a session link (agent-host-session://…)');
				const bucket = body.bucket === undefined ? 'current' : String(body.bucket);
				if (!(await isGroup(bucket))) throw bad('invalid group');
				const to = body.to;
				if (to !== undefined && to !== 'top' && !(Number.isInteger(to) && to >= 0 && to < 10000)) throw bad('invalid position');
				const prioKey = `session:${id}`;
				if (body.op === 'to-issue') {
					// Replace a pinned session with the issue it works on, keeping its place.
					if (!KEY_RE.test(body.key || '')) throw bad('invalid key');
					const item = (await listPinned()).find(p => p.id === id);
					const where = item?.bucket || 'current';
					await pinIssue(body.key, where, id);
					if (where === 'priorities') {
						const at = (await data.getPriorities()).findIndex(p => p.key === prioKey);
						await data.updatePriorities({ op: 'add', key: body.key });
						if (at >= 0) await data.updatePriorities({ op: 'move', key: body.key, to: at });
					}
					await data.updatePriorities({ op: 'remove', key: prioKey });
					await unpinSessions([id]);
					result = { issue: body.key };
				}
				else if (body.op === 'hide' || body.op === 'unhide') result = await setSessionHidden(id, body.op === 'hide');
				else if (body.op === 'remove') { result = await unpinSessions([id]); await data.updatePriorities({ op: 'remove', key: prioKey }); }
				else if (body.op === 'add' && body.resolve !== false && (result = await this.resolveSessionIssue(id))) {
					// The session works on an issue: add the issue (linked to the session) instead of the session.
					await pinIssue(result.key, bucket, id);
					if (bucket === 'priorities') await data.updatePriorities({ op: 'add', key: result.key });
					result = { issue: result.key, title: result.title, via: result.via };
				}
				else if (body.op === 'add' || body.op === 'move') {
					result = body.op === 'add' ? await pinSession(id, String(body.note || '').slice(0, 200), bucket) : await setSessionBucket(id, bucket);
					if (body.op === 'add' && this.sendToChat) {
						const z = (await sessionsById([id]))[id];
						await this.sendToMyWorkChat(describeSessionMessage(`agent-host-session://ahp-session/${id}`, z?.title || id), { thread: false }).then(() => markSummaryRequested(id)).catch(() => { });
					}
					if (body.op === 'add' && result.bucket !== bucket) result = await setSessionBucket(id, bucket);
					await data.updatePriorities({ op: 'remove', key: prioKey });
					if (bucket === 'priorities') await data.updatePriorities({ op: 'add', key: prioKey, to: to === 'top' ? 'top' : undefined }).then(() => Number.isInteger(to) ? data.updatePriorities({ op: 'move', key: prioKey, to }) : null);
				}
				else throw bad('invalid op');
				await data.logActivity({ kind: 'work-pin', id, op: body.op });
				break;
			}
			case '/api/work-issue': {
				if (!KEY_RE.test(body.key || '')) throw bad('invalid key');
				const bucket = String(body.bucket || 'current');
				if (!(await isGroup(bucket))) throw bad('invalid group');
				const to = body.to;
				if (to !== undefined && to !== 'top' && !(Number.isInteger(to) && to >= 0 && to < 10000)) throw bad('invalid position');
				await data.updatePriorities({ op: 'remove', key: body.key });
				if (body.op === 'remove') result = await unpinIssues([body.key]);
				else if (body.op === 'move') {
					result = await setIssueBucket(body.key, bucket);
					if (bucket === 'priorities') await data.updatePriorities({ op: 'add', key: body.key, to: to === 'top' ? 'top' : undefined }).then(() => Number.isInteger(to) ? data.updatePriorities({ op: 'move', key: body.key, to }) : null);
				} else throw bad('invalid op');
				await data.logActivity({ kind: 'work-issue', key: body.key, op: body.op, bucket });
				break;
			}
			case '/api/describe-session': {
				const id = parseSessionRef(body.id);
				if (!id) throw bad('invalid session');
				if (!this.sendToChat) throw Object.assign(new Error('This canvas is not attached to a chat'), { status: 409 });
				const z = (await sessionsById([id]))[id];
				const pinned = (await listPinned()).some(p => p.id === id);
				await this.sendToMyWorkChat(describeSessionMessage(`agent-host-session://ahp-session/${id}`, z?.title || id, { pinned }), { thread: false });
				if (pinned) await markSummaryRequested(id);
				await markSessionSummaryRequested(id);
				this.push('changed', { by: 'summary', work: true });
				result = { sent: true };
				break;
			}
			case '/api/note-session': {
				if (!this.sendToChat) throw Object.assign(new Error('This canvas is not attached to a chat'), { status: 409 });
				const note = await getNote(String(body.id || ''));
				if (!note) throw Object.assign(new Error('That note is not in My Work'), { status: 404 });
				await this.sendToChat(noteSessionPrompt({ section: await getSection(note.section) || { name: note.section, instructions: '' }, note }));
				result = { sent: true, id: note.id };
				break;
			}
			case '/api/work-session': {
				if (!this.sendToChat) throw Object.assign(new Error('This canvas is not attached to a chat'), { status: 409 });
				if (!KEY_RE.test(body.key || '')) throw bad('invalid key');
				const issue = { key: body.key, title: String(body.title || '').slice(0, 300), url: String(body.url || ''), milestone: String(body.milestone || '').slice(0, 80) };
				// The issue's discussion chat becomes the work session; otherwise (or for another session) a new one is created.
				const chat = body.another ? null : await getIssueChat(body.key);
				if (chat?.stage === 'discuss') {
					await this.sendToChat(forwardToIssueChatPrompt({ link: chat.link, key: body.key, text: startIssueSessionMessage(issue) }));
					result = { sent: true, key: body.key, via: 'issue-chat' };
				} else {
					await this.sendToMyWorkSession(workSessionPrompt(issue));
					result = { sent: true, key: body.key, via: 'new-session' };
				}
				break;
			}
			case '/api/open': {
				let url;
				try { url = new URL(String(body.url || '')); } catch { throw bad('invalid url'); }
				if (url.protocol !== 'https:' && url.protocol !== 'http:') throw bad('only http(s) links can be opened');
				const { linkTarget } = await data.getSettings();
				const inVsCode = !body.browser && linkTarget === 'vscode' ? vscodeLinkFor(url.href) : null;
				await openExternal(inVsCode ?? url.href);
				this.json(res, 200, { opened: url.href, via: inVsCode ? 'vscode' : 'browser' });
				return;
			}
			case '/api/attachment': {
				result = { name: await saveImage(String(body.mimeType || ''), body.data) };
				break;
			}
			case '/api/message': {
				if (body.key !== 'my-work' && !KEY_RE.test(body.key || '')) throw bad('invalid key');
				const images = await imagePaths(body.images);
				const typed = typeof body.text === 'string' ? body.text.trim() : '';
				if ((!typed && !images.length) || typed.length > 4000) throw bad('message must be 1-4000 characters');
				const text = images.length
					? `${typed || 'See the attached screenshot.'}\n\nAttached screenshot${images.length > 1 ? 's' : ''} (open with the view tool): ${images.map(p => JSON.stringify(p)).join(', ')}`
					: typed;
				if (!this.sendToChat) throw Object.assign(new Error('This canvas is not attached to a chat'), { status: 409 });
				// fresh: the previous chat never answered, so forget it and resend (the message is already in the thread).
				const fresh = body.fresh === true;
				// resend: the same chat never got it (e.g. a delivery the Agents window dropped); send it again without repeating it in the thread.
				const again = fresh || body.resend === true;
				if (body.key === 'my-work') {
					if (fresh) await setMyWorkChat(null);
					await this.sendToMyWorkChat(text);
					result = { key: body.key, entries: again ? await data.getThread(body.key) : await data.appendThread(body.key, 'user', text) };
					break;
				}
				if (fresh) await setIssueChat(body.key, null);
				const [owner, rest] = body.key.split('/');
				const [repo, number] = rest.split('#');
				const title = typeof body.title === 'string' ? body.title.slice(0, 300) : '';
				const chat = await getIssueChat(body.key);
				if (chat) await this.sendToChat(forwardToIssueChatPrompt({ link: chat.link, key: body.key, text }));
				else await this.sendToMyWorkSession(createIssueChatPrompt({ key: body.key, url: `https://github.com/${owner}/${repo}/issues/${number}`, title, text }));
				result = { key: body.key, entries: again ? await data.getThread(body.key) : await data.appendThread(body.key, 'user', text) };
				break;
			}
			case '/api/cancel-opinion':
				if (!KEY_RE.test(body.key || '')) throw bad('invalid key');
				await data.logActivity({ kind: 'opinion-cancel', key: body.key, mode: body.mode === 'informed' ? 'informed' : 'blind' });
				result = { key: body.key, cancelled: true };
				break;
			case '/api/skip-issue':
				if (!KEY_RE.test(body.key || '')) throw bad('invalid key');
				result = await data.skipIssue({ key: body.key });
				break;
			case '/api/dismiss':
				if (!ID_RE.test(String(body.id || ''))) throw bad('invalid id');
				result = await data.dismissNotification({ id: String(body.id), unsubscribe: !!body.unsubscribe });
				break;
			case '/api/dismiss-many': {
				const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
				if (!ids.length || ids.length > 200 || !ids.every(id => ID_RE.test(id))) throw bad('invalid ids');
				const done = [];
				const failed = [];
				const queue = [...ids];
				const worker = async () => {
					for (let id = queue.shift(); id; id = queue.shift()) {
						try { await data.dismissNotification({ id, unsubscribe: false }); done.push(id); } catch (error) { failed.push({ id, error: error.message }); }
					}
				};
				await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
				result = { dismissed: done.length, done, failed };
				break;
			}
			case '/api/route-many': {
				const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
				if (!ids.length || ids.length > 50 || !ids.every(id => ID_RE.test(id))) throw bad('invalid ids');
				const done = [];
				const failed = [];
				const queue = [...ids];
				const worker = async () => {
					for (let id = queue.shift(); id; id = queue.shift()) {
						try { done.push(await data.routeNotification({ id })); } catch (error) { failed.push({ id, error: error.message }); }
					}
				};
				await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker));
				result = { routed: done.length, done: done.map(d => d.id), results: done, failed };
				break;
			}
			case '/api/skip-notification':
				if (!ID_RE.test(String(body.id || ''))) throw bad('invalid id');
				result = await data.skipNotification({ id: String(body.id) });
				break;
			default:
				throw Object.assign(new Error('not found'), { status: 404 });
		}
		this.json(res, 200, result);
		this.push('changed', { by: 'canvas' });
	}
}
