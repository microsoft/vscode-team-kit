// "My Work": my open issues planned for the current milestone and the next one, read live from
// GitHub (the daily index can lag behind milestone moves), followed by my own ordered priority list
// (stored locally; GitHub's On Deck milestone is too noisy to plan from).
import { execFile } from 'node:child_process';
import { config } from './config.mjs';
import { getPriorities, updatePriorities } from './data.mjs';

const BACKLOG = 'Backlog';

function gh(args, timeout = 60_000) {
	return new Promise((resolve, reject) => {
		execFile('gh', args, { timeout, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) { reject(new Error(String(stderr || error.message).trim().split('\n')[0] || 'gh failed')); return; }
			resolve(String(stdout));
		});
	});
}

const milestoneCache = new Map(); // repo -> { at, list }
async function openMilestones(repo) {
	const hit = milestoneCache.get(repo);
	if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.list;
	const list = JSON.parse(await gh(['api', `repos/${repo}/milestones?state=open&per_page=100`, '--jq', '[.[] | {number, title, due_on}]']));
	milestoneCache.set(repo, { at: Date.now(), list });
	return list;
}

/** Current = first open dated milestone due today or later; next = the one after it. */
export async function planMilestones() {
	const list = await openMilestones(config().planRepo);
	const today = new Date().toISOString().slice(0, 10);
	const dated = list.filter(m => m.due_on).sort((a, b) => a.due_on.localeCompare(b.due_on));
	const upcoming = dated.filter(m => m.due_on.slice(0, 10) >= today);
	const pick = (m, role) => m ? { role, title: m.title, due: m.due_on } : null;
	return [pick(upcoming[0], 'current'), pick(upcoming[1], 'next')].filter(Boolean);
}

let login;
export async function myLogin() {
	login ??= gh(['api', 'user', '--jq', '.login']).then(s => s.trim()).catch(e => { login = undefined; throw e; });
	return login;
}

let workCache = { at: 0, data: null };
/** { milestones: [{role, title, due, items:[{key,title,url,labels,updatedAt,isBug}]}] } with a final
 * `priorities` group (role 'priorities') in the user's own order. */
export async function getMyWork({ fresh = false } = {}) {
	const planned = await getPlanned(fresh);
	const plannedKeys = new Set(planned.milestones.flatMap(m => m.items.map(i => i.key)));
	const prios = await getPriorities();
	// Pinned sessions can sit in My priorities as `session:<id>`; only issues need GitHub details.
	const details = await issueDetails(prios.map(p => p.key).filter(k => !k.startsWith('session:')), fresh);
	// Closed or merged items stay, marked with their state, until the user clears them; issues now planned for current/next show there instead.
	const items = prios.filter(p => !plannedKeys.has(p.key) && !p.key.startsWith('session:')).map(p => {
		const d = details[p.key] || {};
		const labels = d.labels || [];
		return { key: p.key, title: d.title || p.key, url: d.url || `https://github.com/${p.key.replace('#', '/issues/')}`, updatedAt: d.updatedAt || p.addedAt, labels, isBug: labels.includes('bug'), milestone: d.milestone || null, rank: prios.indexOf(p) + 1, state: doneState(d.state), stateReason: d.stateReason || null };
	});
	return { ...planned, milestones: [...planned.milestones, { role: 'priorities', title: 'My priorities', due: null, items }], priorityKeys: prios.map(p => p.key) };
}

const detailCache = new Map(); // key -> { at, d }
export async function issueDetails(keys, fresh) {
	const need = keys.filter(k => fresh || !detailCache.has(k) || Date.now() - detailCache.get(k).at > 5 * 60 * 1000);
	for (let i = 0; i < need.length; i += 40) {
		const chunk = need.slice(i, i + 40);
		const parts = chunk.map((k, j) => {
			const [repo, num] = k.split('#');
			const [owner, name] = repo.split('/');
			return `i${j}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { issueOrPullRequest(number: ${Number(num)}) {
				__typename ... on Issue { title url state stateReason updatedAt milestone { title } labels(first: 30) { nodes { name } } }
				... on PullRequest { title url state updatedAt milestone { title } labels(first: 30) { nodes { name } } } } }`;
		});
		try {
			const out = JSON.parse(await gh(['api', 'graphql', '-f', `query=query { ${parts.join('\n')} }`]));
			chunk.forEach((k, j) => {
				const n = out.data?.[`i${j}`]?.issueOrPullRequest;
				if (n) detailCache.set(k, { at: Date.now(), d: { type: n.__typename, title: n.title, url: n.url, state: n.state, stateReason: n.stateReason ? n.stateReason.toLowerCase() : null, updatedAt: n.updatedAt, milestone: n.milestone?.title || null, labels: (n.labels?.nodes || []).map(l => l.name) } });
			});
		} catch { /* show stored keys without details */ }
	}
	return Object.fromEntries(keys.map(k => [k, detailCache.get(k)?.d]));
}

/** 'closed' / 'merged' for finished issues and PRs, null while open. */
export function doneState(state) {
	return state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : null;
}
const DONE_DAYS = 7;

async function getPlanned(fresh) {
	if (!fresh && workCache.data && Date.now() - workCache.at < 2 * 60 * 1000) return workCache.data;
	const [ms, me] = await Promise.all([planMilestones(), myLogin()]);
	const milestones = await Promise.all(ms.map(async m => {
		// Open issues, plus those closed in the last week so finished work shows as done before it drops off.
		const since = new Date(Date.now() - DONE_DAYS * 864e5).toISOString().slice(0, 10);
		const search = async q => JSON.parse(await gh(['api', '-X', 'GET', 'search/issues', '-f', `q=${q}`, '-f', 'per_page=100', '--jq',
			'[.items[] | {key: ((.repository_url | sub("https://api.github.com/repos/"; "")) + "#" + (.number|tostring)), title, url: .html_url, updatedAt: .updated_at, labels: [.labels[].name], state: (if .state == "closed" then "closed" else null end), stateReason: .state_reason, closedAt: .closed_at}]']));
		const base = `org:${config().org} assignee:${me} is:issue milestone:"${m.title}"`;
		const [open, done] = await Promise.all([search(`${base} is:open`), search(`${base} is:closed closed:>=${since}`).catch(() => [])]);
		const items = [...open, ...done].map(i => ({ ...i, isBug: i.labels.includes('bug') }))
			.sort((a, b) => (!!a.state - !!b.state) || (b.isBug - a.isBug) || b.updatedAt.localeCompare(a.updatedAt));
		return { ...m, items };
	}));
	workCache = { at: Date.now(), data: { milestones, fetchedAt: new Date().toISOString() } };
	return workCache.data;
}

/** Set an issue's milestone by title (looked up in the issue's own repo); null/"none" clears it. */
export async function moveToMilestone(key, title) {
	const [repo, num] = key.split('#');
	let number = null;
	if (title && title !== 'none') {
		const m = (await openMilestones(repo)).find(x => x.title === title)
			?? (milestoneCache.delete(repo), (await openMilestones(repo)).find(x => x.title === title));
		if (!m) throw Object.assign(new Error(`${repo} has no open milestone "${title}"`), { status: 400 });
		number = m.number;
	}
	await gh(['api', '-X', 'PATCH', `repos/${repo}/issues/${num}`, ...(number === null ? ['-F', 'milestone=null'] : ['-F', `milestone=${number}`]), '--silent']);
	workCache = { at: 0, data: null };
	return { key, milestone: title || null };
}

export const PLAN_TARGETS = { backlog: BACKLOG };

/** Issues a PR closes (its "Fixes #N" links), as owner/repo#N keys. */
export async function closingIssues(prUrl) {
	const m = String(prUrl).match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
	if (!m) return [];
	try {
		const out = JSON.parse(await gh(['api', 'graphql', '-f', `query=query { repository(owner: ${JSON.stringify(m[1])}, name: ${JSON.stringify(m[2])}) { pullRequest(number: ${Number(m[3])}) { closingIssuesReferences(first: 5) { nodes { number repository { nameWithOwner } } } } } }`]));
		return (out.data?.repository?.pullRequest?.closingIssuesReferences?.nodes || []).map(n => `${n.repository.nameWithOwner}#${n.number}`);
	} catch { return []; }
}

// "Find work" sources for My Work: live GitHub searches across the configured org.
const sourceCache = new Map(); // query -> { at, items }
/** Extra search qualifiers that narrow a Browse source (the user's filter, as GitHub search syntax). */
export function cleanRefine(refine) {
	const text = String(refine ?? '').replace(/\s+/g, ' ').trim();
	if (text.length > 300) throw Object.assign(new Error('filter must be at most 300 characters'), { status: 400 });
	return text;
}
/** The GitHub search query behind a Browse source, narrowed by an optional filter. */
export async function sourceQuery(source, { labels = [], refine = '' } = {}) {
	const me = await myLogin();
	const extra = cleanRefine(refine);
	// A filter that asks for closed (or explicitly open) items replaces the default is:open.
	const state = /(^|\s)is:(open|closed)\b/i.test(extra) ? '' : ' is:open';
	const base = `org:${config().org}${state} archived:false`;
	// A feature area narrows any issue source: its labels are OR-ed (label:"a","b") on top of the source's own.
	const area = labels.length && source !== 'reviews' ? ` label:${labels.map(l => JSON.stringify(l)).join(',')}` : '';
	const q = source === 'bugs' ? `${base} is:issue assignee:${me} label:bug${area}`
		: source === 'features' ? `${base} is:issue assignee:${me} label:feature-request${area}`
			: source === 'mine' || source === 'area' ? `${base} is:issue assignee:${me}${area}`
				: source === 'reviews' ? `${base} is:pr user-review-requested:${me}`
					: null;
	return q && extra ? `${q} ${extra}` : q;
}
export async function workSource(source, { labels = [], refine = '', fresh = false } = {}) {
	const q = await sourceQuery(source, { labels, refine });
	if (!q) throw Object.assign(new Error('unknown source'), { status: 400 });
	const hit = sourceCache.get(q);
	if (hit && !fresh && Date.now() - hit.at < 2 * 60 * 1000) return hit.items;
	const out = await gh(['api', '-X', 'GET', 'search/issues', '-f', `q=${q}`, '-f', 'sort=updated', '-f', 'per_page=100', '--jq',
		'[.items[] | {key: ((.repository_url | sub("https://api.github.com/repos/"; "")) + "#" + (.number|tostring)), title, url: .html_url, updatedAt: .updated_at, labels: [.labels[].name], isPr: (.pull_request != null), milestone: .milestone.title, author: .user.login, authorType: .user.type, association: .author_association, createdAt: .created_at, comments: .comments, thumbsUp: (.reactions["+1"] // 0)}]']);
	const items = JSON.parse(out);
	sourceCache.set(q, { at: Date.now(), items });
	return items;
}
