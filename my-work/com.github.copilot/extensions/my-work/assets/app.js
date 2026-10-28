const TOKEN = document.querySelector('meta[name="triage-token"]').content;
const $ = id => document.getElementById(id);

const BUILTIN_NOTIF_GROUPS = [
	{ id: 'action', label: 'Needs you', dot: 'dot-action' },
	{ id: 'route', label: 'Route', dot: 'dot-warn' },
	{ id: 'auto', label: 'Auto-dismiss', dot: 'dot-dismiss' },
	{ id: 'cleanup', label: 'Cleanup offers', dot: 'dot-cleanup' },
	{ id: 'dismiss', label: 'Safe to dismiss', dot: 'dot-dismiss' },
	{ id: 'fyi', label: 'FYI', dot: '' },
	{ id: 'untriaged', label: 'Not triaged yet', dot: '' },
];
// Built-in groups plus the user's persistent custom groups (shown before FYI).
function notifGroups() {
	const custom = (ui.state?.customGroups || []).map(g => ({ id: g.id, label: g.label, dot: 'dot-custom', custom: true, bulk: g.bulk, criteria: g.criteria }));
	const i = BUILTIN_NOTIF_GROUPS.findIndex(g => g.id === 'fyi');
	return [...BUILTIN_NOTIF_GROUPS.slice(0, i), ...custom, ...BUILTIN_NOTIF_GROUPS.slice(i)];
}
function groupOf(n) {
	const id = n.triage?.group || 'untriaged';
	return notifGroups().some(g => g.id === id) ? id : 'untriaged';
}
const CLEANUP_LABELS = { fixed: 'Already fixed', duplicate: 'Duplicate', reason: 'Not planned', 'needs-info': 'Needs info' };
const APPROVE_LABEL = { fixed: 'Close as fixed', duplicate: 'Close as duplicate', reason: 'Close as not planned', 'needs-info': 'Ask for info' };
const CHECK_ICON = { pass: '<i class="codicon codicon-pass" aria-hidden="true"></i>', warn: '<i class="codicon codicon-warning" aria-hidden="true"></i>', fail: '<i class="codicon codicon-error" aria-hidden="true"></i>', info: '<i class="codicon codicon-info" aria-hidden="true"></i>' };
const SEV_DOT = { 'data-loss': 'dot-action', crash: 'dot-action', freeze: 'dot-action', perf: 'dot-warn', correctness: 'dot-warn' };

const VIEW_TITLES = { queue: 'Today', notifications: 'Notifications', cleanup: 'Cleanup', implement: 'Implement', work: 'My Work' };
const VIEW_HINTS = { queue: 'What changed since yesterday', notifications: 'Unread GitHub notifications', cleanup: 'Sweeper close proposals to judge', implement: 'Agent-ready issues, bugs first', work: 'MSRC items, current and next milestone, then your own priority list' };

const ui = { tab: 'queue', sub: { queue: 'all', cleanup: 'fixed' }, work: null, selected: null, state: null, busy: false, checks: {}, asked: {}, picked: new Set() };

function esc(value) {
	return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Escape text and turn GitHub URLs, owner/repo#N and #N references into links.
const REF_RE = /(https?:\/\/[^\s<>"'`]+)|(\b[\w.-]+\/[\w.-]+#\d+)|((?:^|(?<=[\s(\[]))#\d{2,})/g;
function linkify(text, repo = 'microsoft/vscode') {
	const src = String(text ?? '');
	let out = '';
	let last = 0;
	for (const m of src.matchAll(REF_RE)) {
		let token = m[0];
		let tail = '';
		if (m[1]) {
			const trimmed = token.replace(/[.,;:!?)\]]+$/, '');
			tail = token.slice(trimmed.length);
			token = trimmed;
		}
		out += esc(src.slice(last, m.index));
		let href, label;
		if (m[1]) {
			href = token;
			const gh = token.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues|commit)\/([\w]+)/);
			if (gh) {
				const prefix = gh[1] === repo ? '' : gh[1];
				label = gh[2] === 'commit' ? `${prefix ? `${prefix}@` : ''}${gh[3].slice(0, 7)}` : `${prefix}#${gh[3]}`;
			} else {
				label = token.replace(/^https?:\/\//, '');
			}
		} else if (m[2]) {
			const [r, n] = token.split('#');
			href = `https://github.com/${r}/issues/${n}`;
			label = token;
		} else {
			href = `https://github.com/${repo}/issues/${token.slice(1)}`;
			label = token;
		}
		const safe = /^https?:\/\//.test(href) ? href : '#';
		out += `<a href="${esc(safe)}" target="_blank" rel="noopener" title="${esc(href)}">${esc(label)}</a>${esc(tail)}`;
		last = m.index + m[0].length;
	}
	return out + esc(src.slice(last));
}
function safeUrl(url) {
	return /^https:\/\/github\.com\//.test(url || '') ? url : '#';
}
function ago(iso) {
	if (!iso) return '';
	const m = Math.round((Date.now() - new Date(iso).getTime()) / 6e4);
	const h = Math.round(m / 60);
	return m < 1 ? 'now' : m < 60 ? `${m}m` : h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}
function agoText(iso) {
	const a = ago(iso);
	return a === 'now' ? 'just now' : `${a} ago`;
}
function shortKey(key) {
	return key === 'my-work' ? 'My Work' : key.startsWith('microsoft/vscode#') ? `#${key.split('#')[1]}` : key;
}
function toast(message, error = false) {
	const el = $('status');
	el.textContent = message;
	el.className = `toast show${error ? ' error' : ''}`;
	clearTimeout(toast.t);
	toast.t = setTimeout(() => { el.className = 'toast'; }, error ? 7000 : 3000);
}

async function api(path, body) {
	const res = await fetch(path, body === undefined ? { headers: { 'x-triage-token': TOKEN } } : {
		method: 'POST', headers: { 'content-type': 'application/json', 'x-triage-token': TOKEN }, body: JSON.stringify(body),
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
	return json;
}

async function load(fresh = false) {
	try {
		// Remember where the open item sat, so it can move on if it gets finished elsewhere (chat, bulk action).
		const before = ui.state && ui.selected ? flatItems() : null;
		const wasOpen = before?.find(i => i.kind === ui.selected.kind && i.id === ui.selected.id);
		const openBefore = wasOpen && !isHandled(wasOpen);
		ui.state = await api(`/api/state${fresh ? '?fresh=1' : ''}`);
		applyTheme(ui.state.settings);
		if (openBefore && !ui.busy && ui.selected) {
			const now = flatItems().find(i => i.kind === ui.selected.kind && i.id === ui.selected.id);
			if (!now || isHandled(now)) {
				const typing = document.activeElement?.classList.contains('ask-input') && document.activeElement.value.trim();
				if (!typing) {
					const label = ui.selected.kind === 'issue' ? shortKey(ui.selected.id) : 'Notification';
					render();
					advance(before);
					ui.autoAdvancedAt = Date.now();
					toast(`✓ ${label} done · moved to the next item`);
					return;
				}
			}
		}
		render();
		if (ui.pendingFocus) { const f = ui.pendingFocus; ui.pendingFocus = null; applyFocus(f); }
	} catch (error) {
		toast(`Could not load: ${error.message}`, true);
		$('subtitle').textContent = error.message;
	}
}

// ---------- theme & settings ----------
// "VS Code" theme: the server reads the host's colour theme and pushes changes live.
async function applyVsCodeTheme(theme) {
	const root = document.documentElement;
	if (theme === undefined) {
		try { theme = (await api('/api/vscode-theme')).theme; } catch { theme = null; }
	}
	ui.vscodeTheme = theme;
	for (const prop of [...root.style]) if (prop.startsWith('--')) root.style.removeProperty(prop);
	if ((ui.state?.settings.theme || 'vscode') !== 'vscode') return;
	if (!theme) { root.dataset.theme = 'system'; return; }
	root.dataset.theme = 'vscode';
	root.style.colorScheme = theme.dark ? 'dark' : 'light';
	for (const [k, v] of Object.entries(theme.tokens)) if (v) root.style.setProperty(k, v);
	const hint = $('vscode-theme-name');
	if (hint) hint.textContent = `${theme.name} · ${theme.source}`;
}
function applyTheme(settings) {
	const theme = settings.theme || 'vscode';
	document.documentElement.dataset.theme = theme === 'vscode' ? (ui.vscodeTheme ? 'vscode' : 'system') : theme;
	if (theme === 'vscode') applyVsCodeTheme(ui.vscodeTheme ?? undefined);
	else { for (const prop of [...document.documentElement.style]) if (prop.startsWith('--')) document.documentElement.style.removeProperty(prop); document.documentElement.style.colorScheme = ''; }
	document.getElementById('accent-seg')?.closest('fieldset')?.classList.toggle('disabled-by-theme', theme === 'vscode');
	if (theme !== 'vscode' && $('vscode-theme-name')) $('vscode-theme-name').textContent = '';
	document.documentElement.dataset.accent = settings.accent || 'blue';
	for (const b of document.querySelectorAll('#theme-seg button')) b.setAttribute('aria-pressed', String(b.dataset.theme === theme));
	for (const b of document.querySelectorAll('#accent-seg button')) b.setAttribute('aria-pressed', String(b.dataset.accent === settings.accent));
	for (const b of document.querySelectorAll('#link-seg button')) b.setAttribute('aria-pressed', String(b.dataset.link === (settings.linkTarget || 'vscode')));
	for (const b of document.querySelectorAll('#density-seg button')) b.setAttribute('aria-pressed', String(b.dataset.density === (settings.density || 'auto')));
	applyDensity();
	if (document.activeElement !== $('batch-size')) $('batch-size').value = settings.batchSize;
}
async function saveSettings(patch) {
	try {
		const settings = await api('/api/settings', patch);
		ui.state.settings = settings;
		applyTheme(settings);
		return settings;
	} catch (error) {
		toast(error.message, true);
		return null;
	}
}
function toggleSettings(open) {
	const pop = $('settings');
	const show = open ?? pop.hidden;
	pop.hidden = !show;
	$('settings-btn').setAttribute('aria-expanded', String(show));
	if (show) pop.querySelector('button[aria-pressed="true"], button')?.focus();
}

// ---------- batches ----------
function batchKey() {
	if (ui.tab === 'notifications') return 'notifications';
	if (ui.tab === 'cleanup') return `cleanup:${ui.sub.cleanup}`;
	if (ui.tab === 'implement') return 'implement';
	return null;
}
function batchIds(key) {
	return ui.state.batches[key]?.ids ?? [];
}

// ---------- items per tab ----------
// Feature-area filter (persisted). Notifications use their linked issue's area; '__none' = not in the index.
const NO_AREA = '__none';
const areaFilter = () => ui.state?.settings.areaFilter || '';
const areaOfIssue = x => x?.area || 'others';
const areaOfNotif = n => n.myIssue ? areaOfIssue(n.myIssue) : NO_AREA;
const inArea = (area, f = areaFilter()) => !f || area === f;
function areaName(id) {
	if (id === NO_AREA) return 'PRs & others\' issues';
	return ui.state?.areas?.find(a => a.id === id)?.name || id;
}

// ---- Inbox rules applied to issues (Cleanup / Implement / Today) ----
const ruleOf = key => ui.state?.issueRules?.[key] || null;
const issueObj = item => item.i || item.c || item.m || null;
function issueUpdatedAt(o) { return o?.updatedAt || o?.issueUpdatedAt || ''; }
function ruleStale(key, o) { const r = ruleOf(key); return !r || issueUpdatedAt(o) > (r.at || ''); }
function ruleLabel(r) {
	if (!r) return '';
	if (r.group === 'route') return r.routeTo?.length ? `→ ${r.routeTo.map(l => '@' + l).join(', ')}` : '→ unassign me';
	if (r.group === 'close') return `close${r.closeAs ? ` · ${r.closeAs}` : ''}`;
	if (r.group === 'needs-info') return 'ask for info';
	return '';
}
// All items of the current issue tab (every batch), honouring the area filter.
function issuePool() {
	const st = ui.state;
	let items = [];
	if (ui.tab === 'queue') { const seen = new Set(); st.sections.forEach(s => s.items.forEach(i => { if (!seen.has(i.key)) { seen.add(i.key); items.push({ kind: 'issue', id: i.key, i }); } })); }
	else if (ui.tab === 'cleanup') items = (st.cleanup[ui.sub.cleanup]?.items || []).map(c => ({ kind: 'issue', id: c.key, c }));
	else if (ui.tab === 'implement') items = st.implement.items.map(m => ({ kind: 'issue', id: m.key, m }));
	return items.filter(x => inArea(areaOfIssue(issueObj(x))));
}
function routeItems() {
	return issuePool().filter(x => ruleOf(x.id)?.group === 'route' && (!isHandled(x) || ui.bulkRun?.ids.includes(x.id)));
}
// Ask the chat to apply the inbox rules to what is on screen, once per batch view.
async function requestRules(keys, recompute, label) {
	try {
		const r = await api('/api/issue-rules', { keys, recompute });
		if (label) toast(r.sent ? `${label} ${r.count} issue${r.count === 1 ? '' : 's'}…` : 'Every issue here is already checked');
		await load();
	} catch (error) { if (label) toast(error.message, true); }
}
function autoRules() {
	if (!['queue', 'cleanup', 'implement'].includes(ui.tab) || ui.routeFilter) return;
	const p = ui.state.issueRulesPending;
	if (p && !p.stalled) return;
	const items = flatItems().filter(x => x.kind === 'issue' && !isHandled(x) && ruleStale(x.id, issueObj(x)));
	if (!items.length) return;
	const b = ui.state.batches[batchKey()] || {};
	const key = `${ui.state.queueDate}:${ui.tab}:${ui.sub[ui.tab] || ''}:${b.number || ''}:${areaFilter()}`;
	ui.autoRuled ??= new Set();
	if (ui.autoRuled.has(key)) return;
	ui.autoRuled.add(key);
	requestRules(items.slice(0, 30).map(x => x.id), false);
}

function listGroups() {
	const st = ui.state;
	const f = areaFilter();
	if (ui.tab === 'work') {
		if (!ui.work?.data) return [];
		const label = m => `${m.title}${m.role === 'current' ? ' · current' : m.role === 'next' ? ' · next' : ''}${m.due ? ` · due ${new Date(m.due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}`;
		const due = x => { const t = Date.parse(x.resolveBy || ''); return isNaN(t) ? Infinity : t; };
		const msrc = [...(ui.work.data.msrcItems || [])].sort((a, b) => due(a) - due(b));
		const draft = ui.msrcDraft && !msrc.some(x => x.incidentId === ui.msrcDraft.incidentId) ? [{ ...ui.msrcDraft, draft: true }] : [];
		const msrcGroup = msrc.length || draft.length ? [{ header: 'MSRC', role: 'msrc', items: [...draft, ...msrc].map(x => ({ kind: 'msrcitem', id: x.incidentId, x })) }] : [];
		const pinned = ui.work.data.pinnedSessions || [];
		const bucketOf = p => p.bucket || 'current';
		const sessIn = role => pinned.filter(p => bucketOf(p) === role && role !== 'priorities').map(p => ({ kind: 'pinsess', id: p.id, p, group: role }));
		// Issues added locally (e.g. from a session) sit in current/next without a GitHub milestone change.
		const shown = new Set([...ui.work.data.milestones.filter(m => m.role !== 'priorities').flatMap(m => m.items.map(w => w.key)), ...(ui.work.data.priorityKeys || [])]);
		const issuesIn = role => (ui.work.data.pinnedIssues || []).filter(p => (p.bucket || 'current') === role && !shown.has(p.key))
			.map(p => ({ kind: 'work', id: p.key, w: { ...p, local: true }, milestone: { title: p.milestone, role }, group: role }));
		// My priorities: issues and sessions in the user's own order.
		const prioItems = m => {
			const byKey = new Map(m.items.map(w => [w.key, w]));
			const out = [];
			for (const k of ui.work.data.priorityKeys || []) {
				if (k.startsWith('session:')) { const p = pinned.find(x => x.id === k.slice(8)); if (p) out.push({ kind: 'pinsess', id: p.id, p, group: 'priorities', rank: out.length + 1 }); }
				else if (byKey.has(k)) out.push({ kind: 'work', id: k, w: { ...byKey.get(k), rank: out.length + 1 }, milestone: m, group: 'priorities' });
			}
			return out;
		};
		const recent = (ui.work.data.recentSessions || []).filter(z => z.id !== ui.work.data.myWorkChat?.split('/').pop()).slice(0, 10);
		const collapsed = !!ui.state?.settings?.recentCollapsed;
		const recentGroup = recent.length ? [{ header: 'Active sessions', role: 'recent', collapsible: true, collapsed, keepEmpty: true, count: recent.length, items: collapsed ? [] : recent.map(z => ({ kind: 'recentsess', id: z.id, z })) }] : [];
		return [...msrcGroup, ...ui.work.data.milestones.map(m => ({ header: label(m), role: m.role, keepEmpty: true, drop: true,
			items: m.role === 'priorities' ? prioItems(m) : [...m.items.map(w => ({ kind: 'work', id: w.key, w, milestone: m, group: m.role })), ...issuesIn(m.role), ...sessIn(m.role)] })), ...recentGroup];
	}
	if (ui.tab === 'notifications' && ui.notifFilter) {
		const g = notifGroups().find(x => x.id === ui.notifFilter);
		return [{ header: null, items: bulkItems(ui.notifFilter).map(n => ({ kind: 'notification', id: n.id, n, bulk: true })) }].map(x => ({ ...x, label: g?.label }));
	}
	if (ui.tab === 'notifications') {
		// With an area filter, show every matching notification (all batches), not just the current batch.
		const ids = new Set(batchIds('notifications'));
		const items = f ? st.notifications.filter(n => !n.handled && inArea(areaOfNotif(n), f)) : st.notifications.filter(n => ids.has(n.id));
		const groups = Object.fromEntries(notifGroups().map(g => [g.id, []]));
		for (const n of items) groups[groupOf(n)].push(n);
		return notifGroups().map(g => ({ header: g.label, items: groups[g.id].map(n => ({ kind: 'notification', id: n.id, n })) }));
	}
	if (ui.routeFilter && ['queue', 'cleanup', 'implement'].includes(ui.tab)) {
		return [{ header: null, items: routeItems() }];
	}
	if (ui.tab === 'queue') {
		const sub = ui.sub.queue;
		return st.sections.filter(s => s.items.length && (sub === 'all' || sub === s.id)).map(s => ({
			header: s.title, items: s.items.filter(i => inArea(areaOfIssue(i), f)).map(i => ({ kind: 'issue', id: i.key, i })),
		}));
	}
	if (ui.tab === 'cleanup') {
		const g = st.cleanup[ui.sub.cleanup];
		const byKey = new Map((g?.items || []).map(c => [c.key, c]));
		const items = f ? (g?.items || []).filter(c => !c.handled && inArea(areaOfIssue(c), f)) : batchIds(`cleanup:${ui.sub.cleanup}`).map(k => byKey.get(k)).filter(Boolean);
		return [{ header: null, items: items.map(c => ({ kind: 'issue', id: c.key, c })) }];
	}
	const byKey = new Map(st.implement.items.map(m => [m.key, m]));
	const items = f ? st.implement.items.filter(m => !m.handled && inArea(areaOfIssue(m), f)) : batchIds('implement').map(k => byKey.get(k)).filter(Boolean);
	return [
		{ header: 'Bugs', items: items.filter(m => m.isBug).map(m => ({ kind: 'issue', id: m.key, m })) },
		{ header: 'Other', items: items.filter(m => !m.isBug).map(m => ({ kind: 'issue', id: m.key, m })) },
	];
}

// Unhandled items of the current page per area, for the dropdown counts.
function areaCounts() {
	const st = ui.state;
	const counts = {};
	const add = a => { counts[a] = (counts[a] || 0) + 1; };
	if (ui.tab === 'notifications') st.notifications.filter(n => !n.handled && (!ui.notifFilter || n.triage?.group === ui.notifFilter)).forEach(n => add(areaOfNotif(n)));
	else if (ui.tab === 'queue') { const seen = new Set(); st.sections.filter(s => ui.sub.queue === 'all' || ui.sub.queue === s.id).forEach(s => s.items.forEach(i => { if (!i.handled && !seen.has(i.key)) { seen.add(i.key); add(areaOfIssue(i)); } })); }
	else if (ui.tab === 'cleanup') (st.cleanup[ui.sub.cleanup]?.items || []).filter(c => !c.handled).forEach(c => add(areaOfIssue(c)));
	else st.implement.items.filter(m => !m.handled).forEach(m => add(areaOfIssue(m)));
	return counts;
}
function renderAreaBar() {
	if (ui.tab === 'work') {
		const src = ui.work;
		const at = src?.data?.fetchedAt;
		$('areabar').innerHTML = `${`<button type="button" class="btn sm${['worksrc', 'browseitem'].includes(ui.selected?.kind) ? ' on' : ''}" data-find-work aria-pressed="${['worksrc', 'browseitem'].includes(ui.selected?.kind)}" aria-controls="detail" title="Browse your bugs, feature requests, feature-area issues and PRs awaiting your review; drag them into a group or use the + buttons"><i class="codicon codicon-search" aria-hidden="true"></i>Browse issues &amp; PRs</button>`}<span class="subtabs-spacer"></span>${`
			<button type="button" class="link-btn list-refresh" data-list-refresh><i class="codicon codicon-refresh${ui.refreshing || src?.loading ? ' spin' : ''}" aria-hidden="true"></i>${ui.refreshing || src?.loading ? 'Refreshing…' : at ? `Updated ${esc(agoText(at))}` : 'Refresh'}</button>`}`;
		return;
	}
	const f = areaFilter();
	const counts = areaCounts();
	const total = Object.values(counts).reduce((a, b) => a + b, 0);
	const areas = [...(ui.state.areas || [])];
	if (ui.tab === 'notifications') areas.push({ id: NO_AREA, name: areaName(NO_AREA) });
	const opt = a => `<option value="${esc(a.id)}" ${a.id === f ? 'selected' : ''}>${esc(a.name)} (${counts[a.id] || 0})</option>`;
	const shown = areas.filter(a => counts[a.id] || a.id === f);
	// One flat list: your configured areas, then label-discovered areas (busiest first), then Others.
	const mine = shown.filter(a => !a.auto && a.id !== 'others' && a.id !== NO_AREA);
	const auto = shown.filter(a => a.auto).sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || a.name.localeCompare(b.name));
	const rest = shown.filter(a => a.id === 'others' || a.id === NO_AREA);
	const opts = [...mine, ...auto, ...rest].map(opt).join('');
	$('areabar').innerHTML = `<label class="area-pick${f ? ' active' : ''}"><i class="codicon codicon-filter" aria-hidden="true"></i><span class="sr-only">Feature area</span>
		<select id="area-filter" aria-label="Filter by feature area"><option value="">All areas (${total})</option>${opts}</select></label>
		${f ? `<button type="button" class="link-btn" id="area-clear" title="Show all areas">Clear</button><span class="cd area-note">all batches</span>` : ''}
		<span class="subtabs-spacer"></span>
		<button type="button" class="link-btn list-refresh" data-list-refresh title="${ui.tab === 'notifications' ? 'Fetch notifications from GitHub now' : 'Reload the index, notifications and live data'}"><i class="codicon codicon-refresh${ui.refreshing ? ' spin' : ''}" aria-hidden="true"></i>${ui.refreshing ? 'Refreshing…' : ui.tab === 'notifications' && ui.state.notificationsFetchedAt ? `Updated ${esc(agoText(ui.state.notificationsFetchedAt))}` : 'Refresh'}</button>`;
}
async function setAreaFilter(value) {
	ui.state.settings.areaFilter = value;
	ui.selected = null;
	$('detail').innerHTML = '<div class="empty">Select an item to see details and actions.</div>';
	render();
	await saveSettings({ areaFilter: value });
}

function flatItems() {
	return listGroups().flatMap(g => g.items);
}
function isHandled(item) {
	if (ui.bulkRun?.done.has(item.id)) return true;
	return !!(item.n?.handled || item.i?.handled || item.c?.handled || item.m?.handled);
}

// ---------- rendering ----------
function render() {
	const st = ui.state;
	if (!st) return;
	const date = st.queueDate ? new Date(`${st.queueDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) : '';
	$('heading').textContent = VIEW_TITLES[ui.tab];
	$('subtitle').textContent = `${date ? `${date} · ` : ''}${VIEW_HINTS[ui.tab]} · ${st.hasIndex === false ? 'no issue index yet' : `index ${ago(st.refreshedAt)} old`}${st.notificationsError ? ` · notifications error: ${st.notificationsError}` : ''}`;
	$('chip-unread').textContent = st.notifications.filter(n => !n.handled).length;
	$('chip-notif-done').textContent = st.today.notificationsHandled;
	$('chip-issues-done').textContent = st.today.issuesHandled;
	$('chip-sessions').textContent = st.today.sessionsStarted;
	$('count-notifications').textContent = st.notifications.filter(n => !n.handled).length;
	$('count-queue').textContent = st.sections.reduce((a, s) => a + s.items.filter(i => !i.handled).length, 0);
	$('count-cleanup').textContent = Object.values(st.cleanup).reduce((a, g) => a + g.items.filter(i => !i.handled).length, 0);
	$('count-implement').textContent = st.implement.items.filter(i => !i.handled).length;
	$('count-work').textContent = ui.work?.data ? (ui.work.data.milestones.find(m => m.role === 'current')?.items.length ?? '') : '';
	for (const b of document.querySelectorAll('.rail-nav button')) {
		b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab));
		b.tabIndex = b.dataset.tab === ui.tab ? 0 : -1;
	}
	renderAreaBar();
	renderSubtabs();
	renderBatchBar();
	$('indexbar').innerHTML = indexingBannerHtml();
	// While the index is still being built, "All done" in the batch bar would be misleading.
	if (ui.state.indexing?.state === 'running' && ['queue', 'cleanup', 'implement'].includes(ui.tab)) $('batchbar').innerHTML = '';
	renderList();
	if (ui.selected) renderDetail(true, true);
	renderWorkChat();
	if (ui.tab === 'work' && !ui.work) loadWork();
}

function renderSubtabs() {
	const st = ui.state;
	let opts = [];
	if (ui.tab === 'work') { $('subtabs').innerHTML = ''; return; }
	if (ui.tab === 'queue') {
		const n = sec => areaFilter() ? sec.items.filter(i => inArea(areaOfIssue(i))).length : sec.total;
		opts = [['all', 'All'], ...st.sections.filter(s => s.items.length && n(s)).map(s => [s.id, `${s.title.replace(/:.*$/, '')} ${n(s)}`])];
	} else if (ui.tab === 'cleanup') {
		opts = Object.entries(st.cleanup).map(([g, v]) => [g, `${CLEANUP_LABELS[g]} ${v.items.filter(i => !i.handled && inArea(areaOfIssue(i))).length}`]);
	} else if (ui.tab === 'notifications') {
		const route = bulkItems('route').length;
		const auto = bulkItems('auto').length;
		const safe = bulkItems('dismiss').length;
		const show = (id, count) => count || ui.notifFilter === id;
		const p = st.notifTriagePending;
		const busy = p && !p.stalled;
		const classify = busy
			? `<span class="pill classify busy" role="status"><i class="codicon codicon-loading" aria-hidden="true"></i>${p.recompute ? 'Re-checking' : 'Classifying'} ${p.total - p.left}/${p.total}</span>`
			: `${st.untriaged ? `<button type="button" class="pill classify" data-classify="new" title="Ask the chat to classify the ${st.untriaged} notifications that are new or changed since they were classified">Classify ${st.untriaged} new</button>` : ''}<button type="button" class="pill classify icon" data-classify="recompute" title="Ask the chat to re-check what is not yet in Auto-dismiss / Safe to dismiss / Route, and move everything that doesn't need you into them${p?.stalled ? ' (last request stalled)' : ''}"><i class="codicon codicon-refresh" aria-hidden="true"></i>Re-check</button>`;
		$('subtabs').innerHTML = [
			show('route', route) ? `<button type="button" class="pill bulk" data-bulk="route" aria-pressed="${ui.notifFilter === 'route'}"><i class="codicon codicon-person" aria-hidden="true"></i>Route ${route}</button>` : '',
			`<button type="button" class="pill bulk" data-bulk="auto" aria-pressed="${ui.notifFilter === 'auto'}"><i class="codicon codicon-check-all" aria-hidden="true"></i>Auto-dismiss ${auto}</button>`,
			`<button type="button" class="pill bulk" data-bulk="dismiss" aria-pressed="${ui.notifFilter === 'dismiss'}">Safe to dismiss ${safe}</button>`,
			...notifGroups().filter(g => g.custom && g.bulk !== 'none').map(g => {
				const count = bulkItems(g.id).length;
				return show(g.id, count) ? `<button type="button" class="pill bulk custom" data-bulk="${esc(g.id)}" aria-pressed="${ui.notifFilter === g.id}" title="${esc(g.criteria)}"><i class="codicon codicon-tag" aria-hidden="true"></i>${esc(g.label)} ${count}</button>` : '';
			}),
			`<span class="subtabs-spacer"></span>${classify}`,
		].join('');
		autoClassify();
		return;
	}
	const nRoute = routeItems().filter(x => !isHandled(x)).length;
	const p = st.issueRulesPending;
	const busy = p && !p.stalled;
	const rules = busy
		? `<span class="pill classify busy" role="status"><i class="codicon codicon-loading" aria-hidden="true"></i>Checking your rules ${p.total - p.left}/${p.total}</span>`
		: `<button type="button" class="pill classify icon" data-rules="recompute" title="Ask the chat to re-apply your inbox rules (routing, close, needs-info) to the issues shown${p?.stalled ? ' (last request stalled)' : ''}"><i class="codicon codicon-law" aria-hidden="true"></i>Re-check rules</button>`;
	$('subtabs').innerHTML = opts.map(([id, label]) => `<button type="button" class="pill" data-sub="${esc(id)}" aria-pressed="${!ui.routeFilter && ui.sub[ui.tab] === id}">${esc(label)}</button>`).join('')
		+ (nRoute || ui.routeFilter ? `<button type="button" class="pill bulk" data-route-filter aria-pressed="${!!ui.routeFilter}" title="Issues your routing rules say belong to someone else"><i class="codicon codicon-person" aria-hidden="true"></i>Route ${nRoute}</button>` : '')
		+ `<span class="subtabs-spacer"></span>${rules}`;
	autoRules();
}

// Classification is done by the chat. Each new notification batch is classified automatically
// (once per batch), so its dismissable items land in Auto-dismiss / Safe to dismiss.
const needsTriage = n => !n.handled && (!n.triage || (n.updated_at || '') > (n.triage.at || ''));
async function requestClassify(body, label) {
	try {
		const r = await api('/api/triage-more', body);
		if (label) toast(r.sent ? `${label} ${r.count} notification${r.count === 1 ? '' : 's'}…` : 'Nothing to classify');
		await load();
		return r;
	} catch (error) { if (label) toast(error.message, true); return null; }
}
function autoClassify() {
	const st = ui.state;
	const p = st.notifTriagePending;
	if (ui.tab !== 'notifications' || (p && !p.stalled) || !st.untriaged) return;
	const b = st.batches.notifications;
	const key = `${st.queueDate}:${b?.number}`;
	ui.autoClassified ??= new Set();
	if (!b || ui.autoClassified.has(key)) return;
	ui.autoClassified.add(key);
	const inBatch = st.notifications.filter(n => b.ids.includes(n.id) && needsTriage(n)).map(n => n.id);
	// The current batch first; otherwise classify ahead so the next batches are ready.
	requestClassify(inBatch.length ? { ids: inBatch, count: 50 } : { count: 25 });
}

// While the indexer runs (or after it failed), the index-based views say so.
function indexingBannerHtml() {
	const ix = ui.state?.indexing;
	if (!ix || !['queue', 'cleanup', 'implement'].includes(ui.tab)) return '';
	if (ix.state === 'failed') {
		return `<div class="index-banner bad" role="status"><i class="codicon codicon-warning" aria-hidden="true"></i><span><b>The last index refresh failed.</b> ${esc(ix.error || '')} Showing the previous index.</span></div>`;
	}
	const pct = ix.total ? Math.round((ix.done / ix.total) * 100) : null;
	const backfill = /^Closed issues/.test(ix.phase || '');
	const what = backfill ? 'Adding your closed issues' : ix.firstRun ? 'Building your issue index' : 'Refreshing your issue index';
	return `<div class="index-banner" role="status" aria-live="polite"><i class="codicon codicon-loading spin" aria-hidden="true"></i><span><b>${what}…</b> ${esc(ix.phase || '')}${ix.total ? ` · ${ix.done}/${ix.total}` : ''} · started ${esc(agoText(ix.startedAt))}. ${backfill ? 'Your open issues are ready; history and duplicate checks improve when this finishes.' : ix.firstRun ? 'This view fills in when it finishes.' : 'This view updates when it finishes.'}</span>${pct !== null ? `<span class="index-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>` : ''}</div>`;
}

function renderBatchBar() {
	if (ui.tab === 'work') {
		const src = ui.work;
		$('batchbar').innerHTML = src?.error ? `<span class="bm" style="grid-column:1/-1;color:var(--bad)"><i class="codicon codicon-warning" aria-hidden="true"></i> ${esc(src.error)}</span>`
			: !src?.data ? '<span class="bm" style="grid-column:1/-1"><i class="codicon codicon-loading" aria-hidden="true"></i> Loading…</span>'
				: '';
		return;
	}
	if (ui.tab === 'notifications' && ui.notifFilter) {
		const ids = bulkItems(ui.notifFilter).map(n => n.id);
		const label = notifGroups().find(x => x.id === ui.notifFilter)?.label || '';
		const routing = ui.notifFilter === 'route';
		const run = ui.bulkRun;
		if (run) {
			const pct = Math.round(((run.done.size + run.failed.size) / run.ids.length) * 100);
			$('batchbar').innerHTML = `<span class="bt"><i class="codicon codicon-loading" aria-hidden="true"></i> ${run.verb || 'Dismissing'}</span>
				<span class="bm" role="status">${run.done.size} of ${run.ids.length} done${run.failed.size ? ` · ${run.failed.size} failed` : ''}</span>
				<span></span><span></span>
				<span class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${run.ids.length}" aria-valuenow="${run.done.size + run.failed.size}" aria-label="${run.verb || 'Dismiss'} progress"><span style="width:${pct}%"></span></span>`;
			return;
		}
		const picked = ids.filter(id => !ui.unchecked?.has(id)).length;
		$('batchbar').innerHTML = (ids.length
			? `<label class="bulk-all"><input type="checkbox" id="bulk-all" ${picked === ids.length ? 'checked' : ''} ${picked && picked < ids.length ? 'data-mixed="1"' : ''}> <span class="bt">${esc(label)}</span></label>
				<span class="bm">${picked} of ${ids.length} selected · all batches</span>
				<span></span>
				<button type="button" class="btn primary bulk-go" data-act="${routing ? 'route-selected' : 'dismiss-selected'}" ${picked ? '' : 'disabled'} ${routing ? 'title="Assign each to the owner shown, unassign you, record routed, and dismiss"' : ''}>${routing ? 'Route &amp; dismiss' : 'Dismiss'} ${picked}</button>`
			: `<span class="bm" style="grid-column:1/-1"><i class="codicon codicon-check-all" aria-hidden="true"></i> Nothing left in ${esc(label)}</span>`) + moreHtml();
		const all = document.getElementById('bulk-all');
		if (all?.dataset.mixed) all.indeterminate = true;
		return;
	}
	if (ui.tab === 'notifications' && ui.picked.size) {
		const ids = pickableIds();
		const picked = ui.picked.size;
		$('batchbar').innerHTML = `<label class="bulk-all"><input type="checkbox" id="bulk-all" ${ids.length && ids.every(id => ui.picked.has(id)) ? 'checked' : 'data-mixed="1"'} aria-label="Select all in this batch"> <span class="bt">${picked} selected</span></label>
			<button type="button" class="next" id="pick-clear">Clear</button>
			<button type="button" class="btn primary bulk-go" data-act="dismiss-selected">Dismiss ${picked}</button>`;
		const all = document.getElementById('bulk-all');
		if (all?.dataset.mixed) all.indeterminate = true;
		return;
	}
	if (ui.routeFilter && ['queue', 'cleanup', 'implement'].includes(ui.tab)) {
		const run = ui.bulkRun;
		const items = routeItems();
		if (run) {
			const pct = Math.round(((run.done.size + run.failed.size) / run.ids.length) * 100);
			$('batchbar').innerHTML = `<span class="bt"><i class="codicon codicon-loading" aria-hidden="true"></i> Routing</span><span class="bm" role="status">${run.done.size} of ${run.ids.length} done${run.failed.size ? ` · ${run.failed.size} failed` : ''}</span><span></span><span></span>
				<span class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${run.ids.length}" aria-valuenow="${run.done.size + run.failed.size}" aria-label="Routing progress"><span style="width:${pct}%"></span></span>`;
			return;
		}
		const open = items.filter(x => !isHandled(x)).length;
		$('batchbar').innerHTML = open
			? `<span class="bt">Route by your rules</span><span class="bm">${open} issue${open === 1 ? '' : 's'} · all batches</span><span></span>
				<button type="button" class="btn primary bulk-go" data-act="route-issues" ${ui.confirmRoute ? '' : 'title="Assigns each to the owner shown, unassigns you and records routed"'}>${ui.confirmRoute ? `Confirm: route ${open}` : `Route ${open}…`}</button>`
			: '<span class="bm" style="grid-column:1/-1"><i class="codicon codicon-check-all" aria-hidden="true"></i> Nothing left to route</span>';
		return;
	}
	const key = batchKey();
	if (areaFilter() && key) {
		const items = flatItems();
		const open = items.filter(i => !isHandled(i)).length;
		$('batchbar').innerHTML = `<span class="bt">${esc(areaName(areaFilter()))}</span><span class="bm">${open} open · all batches</span>`;
		return;
	}
	const b = key && ui.state.batches[key];
	if (!b) { $('batchbar').innerHTML = ''; return; }
	const size = b.ids.length;
	const done = size - b.open;
	const pct = size ? Math.round((done / size) * 100) : 100;
	$('batchbar').innerHTML = size
		? `<span class="bt">Batch ${esc(b.number)}</span>
			<span class="bm">${esc(done)}/${esc(size)} done · ${esc(b.remaining)} more</span>
			${key.startsWith('cleanup:') ? `<button type="button" class="next" id="judge-batch" title="Start one separate chat that judges every unjudged issue in this batch without seeing Sweeper"><i class="codicon codicon-law" aria-hidden="true"></i>Judge all</button>` : ''}
			<button type="button" class="next" id="next-batch" ${b.remaining ? '' : 'disabled'}>Next<i class="codicon codicon-arrow-right" aria-hidden="true"></i></button>
			<span class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${size}" aria-valuenow="${done}" aria-label="Batch progress"><span style="width:${pct}%"></span></span>`
		: '<span class="bm"><i class="codicon codicon-check-all" aria-hidden="true"></i> All done here</span>';
}

// ---- Agents window sessions working on an issue (matched by "#N" in their titles) ----
function sessionsOf(key) {
	return ui.state?.sessions?.[key] || ui.work?.data?.sessions?.[key] || [];
}
function sessTag(key) {
	const list = sessionsOf(key).filter(s => !s.archived);
	return list.length ? `<span class="tag sess" title="${esc(list.map(s => s.title).join('\n'))}"><i class="codicon codicon-comment-discussion" aria-hidden="true"></i>${list.length > 1 ? list.length : 'session'}</span>` : '';
}
// The session's last message, shown on session cards (lazy-loaded from its local transcript).
function sessionLastHtml(id) {
	const st = ui.sessInfo?.[id];
	if (!st || (!st.data && !st.error && !st.loading) || Date.now() - (st.at || 0) > 30_000) setTimeout(() => loadSessionInfo(id));
	const t = st?.data?.transcript;
	if (!st?.data) return st?.error ? '' : '<div class="sess-last cd"><i class="codicon codicon-loading spin" aria-hidden="true"></i> Reading the session…</div>';
	if (!t?.latest) return '';
	return `<details class="sess-last"><summary><span class="cd">${t.working ? 'working now · ' : ''}last message ${esc(agoText(t.latest.at))}</span> ${esc(t.latest.text.replace(/[#*`>_\[\]]/g, '').split('\n').find(l => l.trim())?.slice(0, 160) || '')}</summary><div class="md">${renderMarkdown(t.latest.text)}</div></details>`;
}
function sessionsHtml(list, heading = 'Sessions') {
	if (!list?.length) return '';
	const rows = list.map(s => `<li class="sess-row${s.archived ? ' archived' : ''}">
		<div class="sess-main">
			<div class="sess-title">${esc(s.title || 'Untitled session')}${s.archived ? ' <span class="tag">archived</span>' : !s.read ? ' <span class="tag acc">unread</span>' : ''}</div>
			<div class="sess-meta cd">${[s.branch ? `<code>${esc(s.branch)}</code>` : '', s.changes ? `<span class="add">+${esc(s.changes.additions)}</span> <span class="del">−${esc(s.changes.deletions)}</span>` : '', s.modified ? `active ${esc(agoText(new Date(s.modified).toISOString()))}` : ''].filter(Boolean).join(' · ')}</div>
			${s.prs?.length ? `<div class="sess-prs">${s.prs.map(p => `<a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener"><i class="codicon codicon-git-pull-request" aria-hidden="true"></i>${esc(p.label)}</a>`).join('')}</div>` : ''}
			${!s.archived && s.id && heading !== 'Session' ? sessionLastHtml(s.id) : ''}
		</div>
		<button type="button" class="btn sm" data-open-session="${esc(s.link)}" title="Open this chat in the Agents window"><i class="codicon codicon-comment-discussion" aria-hidden="true"></i>Open</button>
	</li>`).join('');
	return `<section class="linked dcard sess-card"><div class="linked-head"><span class="section-label">${esc(heading)} · ${list.length}</span></div><ul class="sess-list">${rows}</ul></section>`;
}
// The issue's own chat (where the panel's messages about it go); stage "session" once it became the work session.
function issueChat(key) {
	return ui.state?.issueChats?.[key] || null;
}
function liveSession(key) {
	const chat = issueChat(key);
	const discussId = chat?.stage === 'discuss' ? chat.link.split('/').pop() : null;
	return sessionsOf(key).find(s => !s.archived && s.id !== discussId) || null;
}
function inMyWork(key) {
	const d = ui.work?.data;
	if (!d) return false;
	return d.milestones.some(m => m.items.some(w => w.key === key)) || (d.pinnedIssues || []).some(p => p.key === key) || (d.priorityKeys || []).includes(key);
}
// Plan menu entries: my priority list (local) and moving an issue to the current / next milestone or Backlog.
function planMenu(key, currentMilestone) {
	const cur = ui.work?.data?.milestones?.find(m => m.role === 'current');
	const addWork = ui.tab !== 'work' && cur && !inMyWork(key) ? [{ act: 'issue-move', key, milestone: 'current', label: `Add to My Work (${cur.title}, local)` }] : [];
	return [...addWork, ...planMenuInner(key, currentMilestone)];
}
function planMenuInner(key, currentMilestone) {
	const ms = (ui.work?.data?.milestones || []).filter(m => m.role === 'current' || m.role === 'next');
	const prios = ui.work?.data?.priorityKeys || [];
	const at = prios.indexOf(key);
	const planned = ms.some(m => m.title === currentMilestone);
	const prio = at < 0
		? (planned ? [] : [{ act: 'prio-add', key, label: 'Add to my priorities' }, { act: 'prio-add-top', key, label: 'Add to top of my priorities' }])
		: [...(at > 0 ? [{ act: 'prio-top', key, label: 'Move to top of priorities' }, { act: 'prio-up', key, label: 'Move up' }] : []),
			...(at < prios.length - 1 ? [{ act: 'prio-down', key, label: 'Move down' }] : []),
			{ act: 'prio-remove', key, label: 'Remove from my priorities' }];
	const targets = [...ms.map(m => ({ title: m.title, label: `Plan for ${m.title} (${m.role})` })), { title: 'Backlog', label: 'Move to Backlog milestone' }];
	return [...prio, ...targets.filter(t => t.title !== currentMilestone).map(t => ({ act: 'move-milestone', key, milestone: t.title, label: t.label }))];
}

function rowHtml(item) {
	const current = ui.selected && ui.selected.kind === item.kind && ui.selected.id === item.id;
	const handled = isHandled(item);
	const cls = `row${handled ? ' handled' : ''}`;
	if (item.kind === 'work') {
		const w = item.w;
		const prio = item.milestone?.role === 'priorities';
		const local = !!w.local;
		return `<button type="button" class="${cls} ${w.isBug ? 'dot-action' : ''}${prio || local ? ' prio-row' : ''}" data-kind="work" data-id="${esc(w.key)}" data-group="${esc(item.group || '')}" aria-current="${!!current}"${prio ? ` draggable="true" data-prio="${esc(w.key)}" data-pin-issue="${esc(w.key)}" title="Drag to reorder or into current / next; Alt+↑/↓ moves the selected issue"` : local ? ` draggable="true" data-pin-issue="${esc(w.key)}" title="Added locally (GitHub milestone unchanged). Drag to another group."` : ''}>
			<span class="row-title" title="${esc(w.title)}">${prio ? `<span class="prio-rank">${w.rank}</span>` : ''}${esc(w.title)}</span><span class="row-meta"><span>${esc(shortKey(w.key))}</span>${w.isBug ? '<span>bug</span>' : ''}${prio && w.milestone ? `<span>${esc(w.milestone)}</span>` : ''}${local ? '<span class="tag" title="Added to My Work locally; its GitHub milestone is unchanged">local</span>' : ''}${sessTag(w.key)}</span>
		</button>`;
	}
	if (item.kind === 'workhome') {
		const waiting = (ui.state.threads?.['my-work'] || []).at(-1)?.role === 'user';
		return `<button type="button" class="${cls} work-home" data-kind="workhome" data-id="home" aria-current="${!!current}">
			<span class="row-title"><i class="codicon codicon-comment-discussion" aria-hidden="true"></i> Chat &amp; add sessions</span>
			<span class="row-meta"><span>${waiting ? 'waiting for the chat…' : 'Ask the chat to add or reorder work'}</span></span>
		</button>`;
	}
	if (item.kind === 'recentsess') {
		const z = item.z;
		return `<div class="row-wrap"><button type="button" class="${cls}${!z.read ? ' dot-action' : ''}" data-kind="recentsess" data-id="${esc(z.id)}" aria-current="${!!current}">
			<span class="row-title" title="${esc(z.title || '')}"><i class="codicon codicon-comment-discussion" aria-hidden="true"></i> ${esc(z.title || 'Untitled session')}</span>
			<span class="row-meta">${z.project ? `<span>${esc(z.project)}</span>` : ''}${z.modified ? `<span>active ${esc(agoText(new Date(z.modified).toISOString()))}</span>` : ''}${!z.read ? '<span class="tag acc">unread</span>' : ''}</span>
		</button><span class="row-tools"><button type="button" class="row-pin" data-act="pin-session" data-key="${esc(z.id)}" title="Add to My Work" aria-label="Add ${esc(z.title || 'session')} to My Work"><i class="codicon codicon-add" aria-hidden="true"></i></button><button type="button" class="row-pin" data-act="hide-session" data-key="${esc(z.id)}" title="Not relevant: hide from Active sessions" aria-label="Hide ${esc(z.title || 'session')} from Active sessions"><i class="codicon codicon-close" aria-hidden="true"></i></button></span></div>`;
	}
	if (item.kind === 'pinsess') {
		const p = item.p, z = p.session;
		const inPrio = item.group === 'priorities';
		return `<button type="button" class="${cls}${z && !z.read ? ' dot-action' : ''} prio-row" data-kind="pinsess" data-id="${esc(p.id)}" data-group="${esc(item.group || 'current')}" data-sess="${esc(p.id)}"${inPrio ? ` data-prio="session:${esc(p.id)}"` : ''} draggable="true" title="Drag to another group${inPrio ? ' or reorder' : ''}" aria-current="${!!current}">
			<span class="row-title" title="${esc(z?.title || '')}">${inPrio ? `<span class="prio-rank">${item.rank}</span>` : ''}<i class="codicon codicon-comment-discussion" aria-hidden="true"></i> ${esc(z?.title || p.note || 'Session not found')}</span>
			<span class="row-meta">${z?.project ? `<span>${esc(z.project)}</span>` : ''}${z?.modified ? `<span>active ${esc(agoText(new Date(z.modified).toISOString()))}</span>` : ''}${z?.changes ? `<span class="add">+${esc(z.changes.additions)}</span><span class="del">−${esc(z.changes.deletions)}</span>` : ''}${z && !z.read ? '<span class="tag acc">unread</span>' : ''}</span>
		</button>`;
	}
	if (item.kind === 'msrcitem') {
		const x = item.x;
		const due = msrcDue(x);
		const live = (ui.work?.data?.msrcSessions?.[x.incidentId] || []).some(z => !z.archived);
		return `<button type="button" class="${cls} ${due.cls === 'bad' || due.cls === 'sev' ? 'dot-action' : ''}" data-kind="msrcitem" data-id="${esc(x.incidentId)}" aria-current="${!!current}">
			<span class="row-title" title="${esc(x.title || '')}"><i class="codicon codicon-shield" aria-hidden="true"></i> ${esc(x.draft ? 'New MSRC item' : x.title || `IcM ${x.incidentId}`)}</span>
			<span class="row-meta"><span>IcM ${esc(x.incidentId)}</span><span class="tag ${due.cls}"><i class="codicon codicon-clock" aria-hidden="true"></i>${esc(due.text)}</span>${live ? '<span class="tag sess"><i class="codicon codicon-comment-discussion" aria-hidden="true"></i>session</span>' : ''}</span>
		</button>`;
	}
	if (item.kind === 'notification') {
		const n = item.n;
		const g = notifGroups().find(x => x.id === groupOf(n));
		const checked = item.bulk ? !ui.unchecked?.has(n.id) : ui.picked.has(n.id);
		const check = handled ? '<span></span>' : `<input type="checkbox" class="row-check" data-id="${esc(n.id)}" aria-label="Select ${esc(n.title)}" ${checked ? 'checked' : ''}>`;
		const tag = n.triage?.group === 'route' ? `<span class="tag sev">${esc(routeLabel(n.triage))}</span> ` : item.bulk && n.triage?.rule ? `<span class="tag ok">${esc(n.triage.rule)}</span> ` : '';
		const reason = n.triage?.reason
			? `<span class="row-reason">${n.issueKey ? sessTag(n.issueKey) : ''}${tag}${esc(n.triage.reason)}</span>`
			: `<span class="row-meta"><span>${esc(n.repo.replace('microsoft/', ''))}</span><span>${esc(n.reason)}</span><span>${esc(ago(n.updated_at))}</span></span>`;
		const btn = `<button type="button" class="${cls} ${g?.dot || ''}" data-kind="notification" data-id="${esc(n.id)}" aria-current="${!!current}">
			<span class="row-title" title="${esc(n.title)}">${esc(n.title)}</span>
			${reason}
		</button>`;
		return `<div class="row-wrap${item.bulk ? '' : ' pick'}">${check}${btn}</div>`;
	}
	const key = item.id;
	const op = ui.state.opinions[key];
	const latest = op?.informed || op;
	const cmp = op ? compareOpinion(latest, item.c || proposalFor(key)) : null;
	const when = op?.informed ? (cmp === 'agree' ? 'now agrees' : cmp === 'partial' ? 'agrees, other ref' : 'still disagrees') : null;
	const opTag = op ? `<span class="tag ${cmp === 'agree' ? 'ok' : cmp === 'disagree' ? 'bad' : 'sev'}">judge: ${esc(when || (cmp === 'agree' ? 'agrees' : cmp === 'disagree' ? ACTION_LABEL[op.action] : cmp === 'partial' ? 'partly' : ACTION_LABEL[op.action]))}</span>`
		: ui.state.opinionPending?.[key] ? (ui.state.opinionPending[key].failed ? '<span class="tag bad">judge failed</span>' : ui.state.opinionPending[key].stalled ? '<span class="tag sev">judge stalled</span>' : '<span class="tag">judging…</span>') : '';
	let title, meta, dot = '';
	if (item.m) {
		const m = item.m;
		title = m.title;
		dot = SEV_DOT[m.severity] || '';
		meta = `<span>${esc(shortKey(key))}</span>${m.severity ? `<span class="tag sev">${esc(m.severity)}</span>` : ''}${m.upvotes ? `<span><i class="codicon codicon-thumbsup" aria-hidden="true"></i>${esc(m.upvotes)}</span>` : ''}`;
	} else if (item.c) {
		const c = item.c;
		title = c.title;
		dot = c.activitySinceReview ? 'dot-warn' : 'dot-cleanup';
		const hint = c.shippedIn ? `shipped ${c.shippedIn}` : c.duplicateOf ? `→ #${c.duplicateOf}` : c.closeReason || '';
		meta = `<span>${esc(shortKey(key))}</span>${hint ? `<span>${esc(hint)}</span>` : ''}${c.activitySinceReview ? '<span class="tag sev">new activity</span>' : ''}${opTag}`;
	} else {
		const i = item.i;
		title = i.title;
		dot = SEV_DOT[i.sweeper?.severity] || '';
		meta = `<span>${esc(shortKey(key))}</span>${i.sweeper?.action ? `<span>${esc(i.sweeper.action)}</span>` : ''}${i.sweeper?.severity ? `<span class="tag sev">${esc(i.sweeper.severity)}</span>` : ''}${opTag}`;
	}
	meta += sessTag(key);
	const rl = ruleLabel(ruleOf(key));
	if (rl) meta += `<span class="tag ${ruleOf(key).group === 'route' ? 'sev' : 'acc'}" title="${esc(`${ruleOf(key).rule || 'Your rules'}: ${ruleOf(key).reason}`)}">${esc(rl)}</span>`;
	return `<button type="button" class="${cls} ${dot}" data-kind="issue" data-id="${esc(key)}" aria-current="${!!current}">
		<span class="row-title" title="${esc(title)}">${esc(title)}</span><span class="row-meta">${meta}</span>
	</button>`;
}

// Finished items leave their group and collect in one collapsed "Done" section at the bottom
// (the open item stays in place until you move on, and bulk runs keep their rows for progress).
const keepInPlace = i => (ui.selected && i.kind === ui.selected.kind && i.id === ui.selected.id) || ui.bulkRun?.ids.includes(i.id);
function renderList() {
	const all = listGroups().filter(g => g.items.length || g.keepEmpty);
	const done = all.flatMap(g => g.items.filter(i => isHandled(i) && !keepInPlace(i)));
	const doneSet = new Set(done);
	const groups = all.map(g => ({ ...g, items: g.items.filter(i => !doneSet.has(i)) })).filter(g => g.items.length || g.keepEmpty);
	$('list').classList.toggle('picking', ui.picked.size > 0 || !!ui.notifFilter);
	const doneHtml = done.length
		? `<button type="button" class="group-h done-toggle" data-done-toggle aria-expanded="${!!ui.showDone}"><i class="codicon codicon-chevron-right" aria-hidden="true"></i>Done<span class="group-n">${done.length}</span></button>${ui.showDone ? done.map(rowHtml).join('') : ''}`
		: '';
	$('list').innerHTML = groups.length || done.length
		? groups.map(g => `${g.collapsible ? `<button type="button" class="group-h done-toggle" data-group-toggle="${esc(g.role)}" aria-expanded="${!g.collapsed}"><i class="codicon codicon-chevron-right" aria-hidden="true"></i>${esc(g.header)}<span class="group-n">${g.count}</span></button>` : g.header ? `<div class="group-h"${g.drop ? ` data-drop-group="${esc(g.role)}"` : ''}>${esc(g.header)}<span class="group-n">${g.items.filter(i => !isHandled(i)).length || ''}</span></div>` : ''}${g.collapsed ? '' : g.items.length ? g.items.map(rowHtml).join('') : g.role === 'priorities' ? '<div class="cd empty-group" data-drop-group="priorities">Your own ordered list, kept locally (milestones on GitHub are untouched). Paste <b>#123</b> or an issue link into the chat below, or use <b>Add to my priorities</b> on any issue.</div>' : `<div class="cd empty-group"${g.drop ? ` data-drop-group="${esc(g.role)}"` : ''}>Nothing planned yet. Use <b>Plan for…</b> on an issue or drop a session here.</div>`}`).join('')
			+ (groups.length ? '' : '<div class="empty"><i class="codicon codicon-check-all" aria-hidden="true"></i>All done in this batch</div>') + doneHtml
		: ui.state?.indexing?.state === 'running' && ['queue', 'cleanup', 'implement'].includes(ui.tab) && (ui.state.indexing.firstRun || !ui.state.hasIndex)
			? '<div class="empty cd">My Work and Notifications already work while the index is built.</div>'
		: ui.state && !ui.state.hasIndex && ['queue', 'cleanup', 'implement'].includes(ui.tab)
			? '<div class="empty"><i class="codicon codicon-info" aria-hidden="true"></i><b>No issue index yet</b><br>This view is built from your local issue index. Ask the chat to <i>set up My Work</i> (my-work-setup skill) to build it; My Work and Notifications work without it.</div>'
			: '<div class="empty"><i class="codicon codicon-check-all" aria-hidden="true"></i>Nothing here</div>';
}

// Density: compact spacing on small panels (or always/never), and a one-pane layout when narrow,
// where the list and the details take turns and the details get a Back button.
const COMPACT_W = 1100, COMPACT_H = 760, NARROW_W = 720;
function applyDensity() {
	const pref = ui.state?.settings.density || 'auto';
	const w = window.innerWidth, h = window.innerHeight;
	const compact = pref === 'compact' || (pref === 'auto' && (w < COMPACT_W || h < COMPACT_H));
	const root = document.documentElement;
	root.dataset.density = compact ? 'compact' : 'comfortable';
	root.classList.toggle('narrow', w < NARROW_W);
	root.style.setProperty('--list-h', `${ui.state?.settings.listHeight || 40}%`);
}
window.addEventListener('resize', () => applyDensity());
new ResizeObserver(() => applyDensity()).observe(document.body);
// Narrow layout: list on top, details below; the handle between them sets the list's share.
{
	const handle = $('split-handle');
	const layout = $('panel');
	const pct = y => { const r = layout.getBoundingClientRect(); return Math.round(Math.max(15, Math.min(85, ((y - r.top) / r.height) * 100))); };
	const set = (p, save) => {
		document.documentElement.style.setProperty('--list-h', `${p}%`);
		if (save && ui.state) { ui.state.settings.listHeight = p; saveSettings({ listHeight: p }); }
	};
	handle.addEventListener('pointerdown', e => {
		e.preventDefault();
		handle.setPointerCapture(e.pointerId);
		document.body.classList.add('resizing');
		let last = null;
		const move = ev => { last = pct(ev.clientY); set(last, false); };
		const up = () => {
			handle.removeEventListener('pointermove', move);
			document.body.classList.remove('resizing');
			if (last !== null) set(last, true);
		};
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', up, { once: true });
		handle.addEventListener('pointercancel', up, { once: true });
	});
	handle.addEventListener('keydown', e => {
		if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
		e.preventDefault();
		const cur = ui.state?.settings.listHeight || 40;
		set(Math.max(15, Math.min(85, cur + (e.key === 'ArrowDown' ? 5 : -5))), true);
	});
	handle.addEventListener('dblclick', () => set(40, true));
}

async function select(kind, id, focusDetail = false) {
	ui.selected = { kind, id, detail: null };
	applyDensity();
	renderList();
	await renderDetail(true);
	if (focusDetail) $('detail').focus();
}

function captureDraft() {
	const ta = document.getElementById('comment');
	const ask = $('detail').querySelector('.ask-input');
	return {
		key: ui.selected && `${ui.selected.kind}:${ui.selected.id}`,
		comment: ta?.value, commentView: ta && !ta.hidden ? 'edit' : 'preview',
		ask: ask?.value, askFocused: ask && document.activeElement === ask,
		scroll: document.querySelector('#detail .detail-body')?.scrollTop ?? 0,
	};
}
function scrollThreadToEnd() {
	for (const b of document.querySelectorAll('.bubbles')) {
		b.scrollTop = b.scrollHeight;
		requestAnimationFrame(() => { b.scrollTop = b.scrollHeight; });
	}
}
function restoreDraft(d) {
	if (!d || d.key !== (ui.selected && `${ui.selected.kind}:${ui.selected.id}`)) return;
	const ta = document.getElementById('comment');
	if (ta && d.comment !== undefined) { ta.value = d.comment; setCommentView(d.commentView); }
	const ask = $('detail').querySelector('.ask-input');
	if (ask && d.ask) { ask.value = d.ask; autoGrow(ask); }
	if (ask && d.askFocused) ask.focus();
	const body = document.querySelector('#detail .detail-body');
	if (body) body.scrollTop = d.scroll;
}
function autoGrow(ta) {
	ta.style.height = 'auto';
	ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
}

async function renderDetail(fetchDetail, silent = false) {
	const draft = fetchDetail && !silent ? null : captureDraft();
	await renderDetailInner(fetchDetail, silent);
	restoreDraft(draft);
	scrollThreadToEnd();
}

// All classified, still-unread notifications in a dismiss group (across every batch).
// While a bulk dismiss runs, its items stay listed so the rows can show progress.
function bulkItems(group) {
	const run = ui.bulkRun;
	return (ui.state?.notifications || []).filter(n => n.triage?.group === group && (!n.handled || run?.ids.includes(n.id)) && inArea(areaOfNotif(n)));
}
function routeLabel(t) {
	return t?.routeTo?.length ? `→ ${t.routeTo.map(l => `@${l}`).join(', ')}` : '→ unassign me';
}
function moreHtml() {
	const st = ui.state;
	const p = st.notifTriagePending;
	const body = p && !p.stalled
		? `<i class="codicon codicon-loading" aria-hidden="true"></i> The chat is triaging ${p.total} more · ${p.total - p.left} done (asked ${esc(agoText(p.at))})`
		: st.untriaged
			? `${p?.stalled ? 'Last request stalled. ' : ''}${st.untriaged} notification${st.untriaged > 1 ? 's' : ''} not triaged yet <button type="button" class="next" id="triage-more" title="Ask the chat to triage the next ${Math.min(25, st.untriaged)} so more land in these lists"><i class="codicon codicon-arrow-right" aria-hidden="true"></i>${p?.stalled ? 'Retry' : `Find more (next ${Math.min(25, st.untriaged)})`}</button>`
			: 'Every notification is triaged';
	return `<div class="bulk-more bm" role="status">${body}</div>`;
}

const TRIAGE_ICON = { action: 'bell-dot', route: 'person', auto: 'check-all', cleanup: 'law', dismiss: 'check', fyi: 'info' };
// The chat's classification of a notification: a quiet card with a coloured accent, not a full-colour box.
function triageCardHtml(n, g) {
	if (!n.triage) return '<div class="triage-card t-none"><div class="tc-head"><i class="codicon codicon-circle-large" aria-hidden="true"></i>Not triaged yet</div><p>Use <b>Find more</b> in the Auto-dismiss or Safe-to-dismiss list, or ask the chat to triage this batch.</p></div>';
	const t = n.triage;
	const tone = t.group === 'action' ? 't-action' : t.group === 'route' ? 't-route' : ['dismiss', 'auto'].includes(t.group) ? 't-ok' : g?.custom ? 't-custom' : 't-none';
	const extra = t.group === 'route' ? `<span class="tag sev">${esc(routeLabel(t))}</span>` : '';
	return `<div class="triage-card ${tone}">
		<div class="tc-head"><i class="codicon codicon-${TRIAGE_ICON[t.group] || 'tag'}" aria-hidden="true"></i>${esc(g?.label || t.group)}${extra}${t.rule ? `<span class="tag">${esc(t.rule)}</span>` : ''}</div>
		<p>${linkify(t.reason, n.repo)}</p>
	</div>`;
}

// A recorded decision as a compact status line (session links are not shown raw).
function outcomeHtml(outcome) {
	if (!outcome) return '';
	const label = DECISION_LABEL[outcome.decision] || outcome.decision;
	const note = outcome.note || '';
	const session = /^agent-host-session:\/\//.test(note.trim());
	const text = session ? 'fix session started' : note;
	return `<div class="outcome-line"><span class="tag ${outcome.decision === 'fixing' ? 'acc' : 'ok'}"><i class="codicon codicon-${outcome.decision === 'fixing' ? 'rocket' : 'pass'}" aria-hidden="true"></i>${esc(label)}</span>${text ? `<span class="cd" ${session ? `title="${esc(note)}"` : ''}>${session ? esc(text) : linkify(text)}</span>` : ''}${outcome.decidedAt ? `<span class="cd">· ${esc(agoText(outcome.decidedAt))}</span>` : ''}</div>`;
}

async function renderDetailInner(fetchDetail, silent = false) {
	const sel = ui.selected;
	const el = $('detail');
	if (sel.kind === 'msrcitem') { renderMsrcItemInto(el, sel.id); return; }
	if (sel.kind === 'workhome') { renderWorkHomeInto(el); return; }
	if (sel.kind === 'worksrc') { renderFindWorkInto(el); return; }
	if (sel.kind === 'browseitem') { await renderBrowseItemInto(el, sel.id, fetchDetail, silent); return; }
	if (sel.kind === 'pinsess' || sel.kind === 'recentsess') { renderPinnedSessionInto(el, sel.id); return; }
	if (sel.kind === 'work') {
		const item = flatItems().find(i => i.kind === 'work' && i.id === sel.id);
		await renderIssueInto(el, sel.id, fetchDetail, false, silent, { work: item });
		hydrateGitHub();
		return;
	}
	if (sel.kind === 'notification') {
		const n = ui.state.notifications.find(x => x.id === sel.id);
		if (!n) { el.innerHTML = '<div class="empty">This notification is no longer unread.</div>'; return; }
		const g = notifGroups().find(x => x.id === n.triage?.group);
		const routable = n.triage?.group === 'route' && !n.handled && n.issueKey;
		// Issue-level actions are secondary; the notification's own action is the one primary button.
		const issueActions = n.type === 'Issue' && n.issueKey
			? `<button type="button" class="btn" data-act="notification-start"><i class="codicon codicon-rocket" aria-hidden="true"></i>Start fix session</button>
				<button type="button" class="btn" data-act="notification-investigate"><i class="codicon codicon-search" aria-hidden="true"></i>Investigate</button>`
			: '';
		const ref = n.issueKey ? (n.issueKey.startsWith('microsoft/vscode#') ? shortKey(n.issueKey) : n.issueKey) : n.repo;
		const nhead = titleBarHtml({
			title: n.title, url: n.htmlUrl,
			meta: `<div class="meta"><a class="num-link" href="${esc(safeUrl(n.htmlUrl))}" target="_blank" rel="noopener" title="Open (⌘-click for the other target)">${esc(ref)}</a><span class="sep">·</span><span>${esc(n.type === 'PullRequest' ? 'Pull request' : n.type)}</span><span class="sep">·</span><span>${esc(n.reason.replace(/_/g, ' '))}</span><span class="sep">·</span><span>${esc(agoText(n.updated_at))}</span></div>`,
			primary: routable
				? { act: 'route-one', label: n.triage.routeTo?.length ? `Route to ${n.triage.routeTo.map(l => `@${l}`).join(', ')}` : 'Unassign me', icon: 'person' }
				: { act: 'dismiss', label: 'Dismiss', icon: 'check' },
			menu: [...(routable ? [{ act: 'dismiss', label: 'Dismiss only' }] : []), { act: 'done', label: 'Done & unsubscribe' }, { act: 'skip-notification', label: 'Skip for now' }],
			status: n.handled ? '<span class="decided"><i class="codicon codicon-pass" aria-hidden="true"></i>Handled</span>' : null,
		});
		el.innerHTML = `<div class="detail-head">${nhead}</div><div class="detail-body">
			${triageCardHtml(n, g)}
			${n.issueKey ? recoSlot(n.issueKey) : ''}
			<div id="issue-slot">${!n.myIssue && issueActions ? `<div class="toolbar">${issueActions}</div>` : ''}</div>
			${n.issueKey ? ghSlot(n.issueKey) : ''}
		</div>
		${n.issueKey ? `<div class="footer">${threadHtml(n.issueKey, n.title)}</div>` : ''}`;
		hydrateGitHub();
		if (n.myIssue) {
			await renderIssueInto($('issue-slot'), n.myIssue.key, fetchDetail, true, silent, { extras: issueActions, sameTitle: n.myIssue.title === n.title });
			paintGitHub(n.issueKey);
		}
		return;
	}
	await renderIssueInto(el, sel.id, fetchDetail, false, silent);
	hydrateGitHub();
}

function checksHtml(key) {
	const c = ui.checks[key];
	if (!c || c.loading) return '<div class="checks-sum"><span class="cd">Running live checks…</span></div>';
	if (c.error) return `<div class="callout bad">Checks failed: ${esc(c.error)}</div>`;
	const s = c.data.summary;
	const attention = s.warn + s.fail;
	const list = `<ul class="checks">${c.data.checks.map(x => `<li class="c-${esc(x.status)}"><span class="ci" title="${esc(x.status)}">${CHECK_ICON[x.status] || ''}</span><span>${linkify(x.label)}${x.detail ? ` <span class="cd">· ${linkify(x.detail)}</span>` : ''}</span>${(x.comments || []).map(cm => `<div class="quote"><b>${esc(cm.user)}</b> ${esc(ago(cm.at))}: ${linkify(cm.body)}</div>`).join('')}</li>`).join('')}</ul>`;
	return `<details ${attention ? 'open' : ''} style="border:none;padding:0;margin:0">
		<summary><span class="checks-sum" style="display:inline-flex"><span class="pills"><span class="tag ok"><i class="codicon codicon-pass" aria-hidden="true"></i> ${esc(s.pass)}</span>${s.warn ? `<span class="tag sev"><i class="codicon codicon-warning" aria-hidden="true"></i> ${esc(s.warn)}</span>` : ''}${s.fail ? `<span class="tag bad"><i class="codicon codicon-error" aria-hidden="true"></i> ${esc(s.fail)}</span>` : ''}</span>${attention ? '<span class="cd">needs a look</span>' : '<span class="cd">all clear</span>'}</span></summary>
		${list}
	</details>`;
}

async function loadChecks(key, fresh = false) {
	ui.checks[key] = { loading: true };
	const paint = () => {
		const slot = document.getElementById(`checks-${key}`);
		if (slot) slot.innerHTML = checksHtml(key);
		const att = document.getElementById(`attention-${key}`);
		if (att) att.innerHTML = attentionHtml(key);
		for (const r of document.querySelectorAll('.reco-slot')) if (r.dataset.key === key) r.innerHTML = recoHtml(key);
	};
	paint();
	try {
		ui.checks[key] = { data: await api(`/api/checks?key=${encodeURIComponent(key)}${fresh ? '&fresh=1' : ''}`) };
	} catch (error) {
		ui.checks[key] = { error: error.message };
	}
	paint();
}

const ACTION_LABEL = { 'keep-open': 'Keep open', fixed: 'Already fixed', duplicate: 'Duplicate', 'not-planned': 'Not planned', 'needs-info': 'Needs info' };
const GROUP_ACTION = { fixed: 'fixed', duplicate: 'duplicate', reason: 'not-planned', 'needs-info': 'needs-info' };

function refId(value) {
	const s = String(value ?? '').trim();
	const sha = s.match(/\b([0-9a-f]{7,40})\b/);
	if (sha && !/#\d+$/.test(s)) return `sha:${sha[1].slice(0, 7)}`;
	const num = s.match(/(?:#|\/(?:pull|issues)\/)(\d+)/);
	return num ? `n:${num[1]}` : s.toLowerCase();
}

// Compares a blind judgement with Sweeper's proposal for the same issue: 'agree' | 'partial' | 'disagree'.
function compareOpinion(op, proposal) {
	if (!op || !proposal?.group) return null;
	const sweeper = GROUP_ACTION[proposal.group];
	if (op.action !== sweeper) return 'disagree';
	const sweeperRef = proposal.group === 'fixed' ? proposal.fixedByCommit : proposal.group === 'duplicate' ? proposal.duplicateOf && `#${proposal.duplicateOf}` : null;
	if (!sweeperRef || !op.reference) return 'agree';
	return refId(op.reference) === refId(sweeperRef) ? 'agree' : 'partial';
}

function proposalFor(key) {
	const sel = ui.selected?.detail;
	if (sel?.issue.key === key && sel.proposal) return sel.proposal;
	for (const g of Object.values(ui.state.cleanup)) {
		const c = g.items.find(i => i.key === key);
		if (c) return c;
	}
	return null;
}

function attentionHtml(key) {
	const c = ui.checks[key]?.data;
	const op = ui.state.opinions[key];
	const bad = c ? c.summary.warn + c.summary.fail : 0;
	const parts = [];
	if (bad) parts.push(`${bad} check${bad > 1 ? 's' : ''} need${bad > 1 ? '' : 's'} a look`);
	const cmp = compareOpinion(op?.informed || op, proposalFor(key));
	if (cmp === 'partial') parts.push(`judge agrees on the action but cites a different ${proposalFor(key)?.group === 'duplicate' ? 'original issue' : 'fix'}`);
	else if (cmp === 'disagree') parts.push(op?.informed ? 'judge still disagrees after seeing Sweeper\'s evidence' : 'independent judge disagrees');
	return parts.length ? `<span class="tag sev"><i class="codicon codicon-warning" aria-hidden="true"></i> ${parts.join(' · ')}</span>` : '';
}

// Lightweight GitHub-flavoured rendering of a comment: paragraphs, quotes, lists, `code`, **bold**, links.
const MD_LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
function renderInline(t) {
	const fmt = s => linkify(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
		.replace(/(^|[\s(])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\b(?![\w.-]*\/)/g, '$1<a class="mention" href="https://github.com/$2" target="_blank" rel="noopener">@$2</a>');
	let out = '';
	let last = 0;
	for (const m of String(t).matchAll(MD_LINK_RE)) {
		out += fmt(t.slice(last, m.index));
		const [, label, url] = m;
		const text = esc(label).replace(/`([^`]+)`/g, '<code>$1</code>');
		out += /^https?:\/\//.test(url)
			? `<a href="${esc(url)}" target="_blank" rel="noopener" title="${esc(url)}">${text}</a>`
			: /^agent-host-session:\/\//.test(url)
				? `<span class="session-chip" title="Chat session: ${esc(url)}"><i class="codicon codicon-comment-discussion" aria-hidden="true"></i>${text}</span>`
				: text;
		last = m.index + m[0].length;
	}
	return out + fmt(t.slice(last));
}
// GitHub-flavoured markdown for issue bodies and comments (no raw HTML; images become links).
function renderMarkdown(src) {
	let text = String(src ?? '').replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '');
	const stripTags = s => s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<\/t[dh]>/gi, '  ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
	const blocks = [];
	const hold = html => `\u0000${blocks.push(html) - 1}\u0000`;
	// <details><summary>…</summary>…</details> (e.g. System Info) → collapsed, as plain text.
	text = text.replace(/<details>\s*(?:<summary>([\s\S]*?)<\/summary>)?([\s\S]*?)<\/details>/gi, (_, sum, inner) =>
		`\n${hold(`<details class="md-details"><summary>${esc(stripTags(sum || 'Details').trim())}</summary><pre>${esc(stripTags(inner).replace(/\n{3,}/g, '\n\n').trim())}</pre></details>`)}\n`);
	text = text.replace(/```[^\n]*\n([\s\S]*?)(?:```|$)/g, (_, code) => `\n${hold(`<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`)}\n`);
	// Rendered-HTML copies use short-lived private-user-images URLs; the user-attachments form is stable.
	const stable = url => url.replace(/^https:\/\/private-user-images\.githubusercontent\.com\/\d+\/\d+-([0-9a-f-]{36})\.[a-z0-9]+\?\S*$/i, 'https://github.com/user-attachments/assets/$1');
	// Only GitHub-hosted images load inline; others would tell their host when the user views the issue.
	const trusted = url => /^https:\/\/(github\.com\/user-attachments\/|([\w-]+\.)?githubusercontent\.com\/)/i.test(url);
	const img = (raw, alt, url = stable(raw)) => !/^https:\/\//.test(url) ? esc(alt || '')
		: trusted(url)
			? hold(`<a class="md-img" href="${esc(url)}" target="_blank" rel="noopener" title="Open full size"><img src="${esc(url)}" alt="${esc(alt || 'image')}"></a>`)
			: hold(`<a class="md-media" href="${esc(url)}" target="_blank" rel="noopener" title="External image, not loaded: ${esc(url)}"><i class="codicon codicon-file-media" aria-hidden="true"></i>${esc(alt || 'External image')}</a>`);
	text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, url) => img(url, alt));
	text = text.replace(/<img[^>]*src="([^"]+)"[^>]*>/gi, (m, url) => img(url, (m.match(/alt="([^"]*)"/) || [])[1]));
	// A bare attachment URL on its own line is how GitHub embeds videos.
	text = text.replace(/^\s*(https:\/\/github\.com\/user-attachments\/assets\/[\w-]+)\s*$/gm, (_, url) => hold(`<video class="md-video" src="${esc(url)}" controls preload="metadata"></video><a class="md-media" href="${esc(url)}" target="_blank" rel="noopener"><i class="codicon codicon-file-media" aria-hidden="true"></i>Open attachment</a>`));
	text = stripTags(text);
	const inline = s => s.split(/(\u0000\d+\u0000)/).map(part => /^\u0000\d+\u0000$/.test(part) ? part : renderInline(part)
		.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>')
		.replace(/~~([^~]+)~~/g, '<s>$1</s>')).join('');
	const out = text.split(/\n{2,}/).map(block => {
		const b = block.replace(/^\n+|\n+$/g, '');
		if (!b.trim()) return '';
		if (/^\u0000\d+\u0000$/.test(b.trim())) return b.trim();
		const lines = b.split('\n');
		const h = b.match(/^(#{1,6})\s+(.*)$/);
		if (h && lines.length === 1) return `<h4 class="md-h">${inline(h[2])}</h4>`;
		if (lines.every(l => /^\s*>/.test(l))) return `<blockquote>${renderMarkdown(lines.map(l => l.replace(/^\s*> ?/, '')).join('\n'))}</blockquote>`;
		if (lines.length > 1 && lines.every(l => /^\s*\|.*\|\s*$/.test(l))) {
			const rows = lines.filter(l => !/^\s*\|[\s:|-]+\|\s*$/.test(l)).map(l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
			return `<div class="md-table"><table>${rows.map((r, i) => `<tr>${r.map(c => i ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`).join('')}</tr>`).join('')}</table></div>`;
		}
		const isItem = l => /^\s*([-*+]|\d+[.)])\s+/.test(l);
		// "Intro line\n- a\n- b": paragraph followed by a list.
		const firstItem = lines.findIndex(isItem);
		if (firstItem > 0 && lines.slice(firstItem).every(l => isItem(l) || /^\s{2,}\S/.test(l))) {
			return `<p>${inline(lines.slice(0, firstItem).join('\n')).replace(/\n/g, '<br>')}</p>${renderMarkdown(lines.slice(firstItem).join('\n'))}`;
		}
		if (isItem(lines[0])) {
			const ordered = /^\s*\d/.test(lines[0]);
			const items = [];
			for (const l of lines) {
				if (isItem(l)) items.push(l.replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
				else if (items.length) items[items.length - 1] += '\n' + l.trim();
			}
			const li = items.map(t => {
				const task = t.match(/^\[( |x|X)\]\s+/);
				return `<li${task ? ' class="task"' : ''}>${task ? `<i class="codicon codicon-${task[1] === ' ' ? 'circle-large' : 'pass'}" aria-hidden="true"></i>` : ''}${inline(task ? t.slice(task[0].length) : t).replace(/\n/g, '<br>')}</li>`;
			}).join('');
			return ordered ? `<ol>${li}</ol>` : `<ul>${li}</ul>`;
		}
		const hm = lines[0].match(/^(#{1,6})\s+(.*)$/);
		if (hm) return `<h4 class="md-h">${inline(hm[2])}</h4><p>${inline(lines.slice(1).join('\n')).replace(/\n/g, '<br>')}</p>`;
		return `<p>${inline(b).replace(/\n/g, '<br>')}</p>`;
	}).join('');
	return out.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
}

const REACTION_EMOJI = { '+1': '👍', '-1': '👎', heart: '❤️', hooray: '🎉', rocket: '🚀', eyes: '👀', laugh: '😄', confused: '😕' };
function reactionsHtml(r) {
	const e = Object.entries(r || {});
	return e.length ? `<span class="reactions">${e.map(([k, n]) => `<span class="reaction">${REACTION_EMOJI[k] || k} ${esc(n)}</span>`).join('')}</span>` : '';
}
function userLink(u) {
	return `<a class="gh-user${u.bot ? ' bot' : ''}" href="https://github.com/${encodeURIComponent(u.login.replace(/\[bot\]$/, ''))}" target="_blank" rel="noopener">${esc(u.login)}</a>`;
}
function labelHtml(l) {
	const c = /^[0-9a-f]{6}$/i.test(l.color || '') ? `#${l.color}` : 'var(--faint)';
	return `<span class="gh-label" style="--lc:${c}">${esc(l.name)}</span>`;
}

// "On GitHub" section: live description, labels, linked PRs and the latest comments.
function githubHtml(key) {
	const g = ui.gh?.[key];
	if (!g || g.loading) return `<div class="gh-loading cd"><i class="codicon codicon-loading" aria-hidden="true"></i> Loading from GitHub…</div>`;
	if (g.error) return `<div class="gh-loading cd"><i class="codicon codicon-warning" aria-hidden="true"></i> Couldn't load from GitHub: ${esc(g.error)} <button type="button" class="link-btn" data-gh-reload="${esc(key)}">Retry</button></div>`;
	const d = g.data;
	const state = d.isPr
		? (d.pr?.merged ? ['merged', 'Merged'] : d.state === 'closed' ? ['closed', 'Closed'] : d.pr?.draft ? ['draft', 'Draft'] : ['open', 'Open'])
		: d.state === 'closed' ? ['closed', d.stateReason === 'not_planned' ? 'Closed · not planned' : d.stateReason === 'duplicate' ? 'Closed · duplicate' : 'Closed'] : ['open', 'Open'];
	const prLine = d.pr ? `<span class="cd"><code>${esc(d.pr.head || '')}</code> → <code>${esc(d.pr.base || '')}</code> · ${esc(d.pr.changedFiles)} files <span class="add">+${esc(d.pr.additions)}</span> <span class="del">−${esc(d.pr.deletions)}</span></span>` : '';
	const body = d.body.trim() ? renderMarkdown(d.body) : '<p class="cd">No description provided.</p>';
	const long = d.body.length > 1200 || (d.body.match(/\n/g) || []).length > 25;
	const expanded = ui.ghExpanded?.has(key);
	const hidden = d.commentCount - d.comments.length;
	const comments = d.comments.map(c => `<article class="gh-comment${c.author.bot ? ' bot' : ''}">
			<div class="gh-c-head">${userLink(c.author)}${c.association && !['NONE', 'CONTRIBUTOR'].includes(c.association) ? `<span class="tag">${esc(c.association.toLowerCase())}</span>` : ''}<a class="cd" href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener">${esc(agoText(c.createdAt))}</a>${reactionsHtml(c.reactions)}</div>
			${c.author.bot ? `<details class="gh-bot"><summary>Bot comment</summary><div class="md">${renderMarkdown(c.body)}</div></details>` : `<div class="md">${renderMarkdown(c.body)}</div>`}
		</article>`).join('');
	return `<div class="gh-head">
			<span class="gh-state s-${state[0]}">${esc(state[1])}</span>
			<span class="cd">${userLink(d.author)} opened ${esc(agoText(d.createdAt))}</span>
			${reactionsHtml(d.reactions)}
			<button type="button" class="link-btn gh-refresh" data-gh-reload="${esc(key)}" title="Reload from GitHub (fetched ${esc(agoText(d.fetchedAt))})"><i class="codicon codicon-refresh" aria-hidden="true"></i></button>
		</div>
		${prLine ? `<div class="gh-pr">${prLine}</div>` : ''}
		${d.labels.length || d.milestone ? `<div class="gh-labels">${d.labels.map(labelHtml).join('')}${d.milestone ? `<span class="tag"><i class="codicon codicon-milestone" aria-hidden="true"></i>${esc(d.milestone)}</span>` : ''}</div>` : ''}
		${d.linkedPrs.length ? `<div class="gh-linked"><span class="section-label">Linked PRs</span>${d.linkedPrs.map(p => `<a class="gh-pr-link s-${esc(p.draft && p.state === 'open' ? 'draft' : p.state)}" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener" title="${esc(p.title)}"><i class="codicon codicon-git-pull-request" aria-hidden="true"></i>${esc(p.key.startsWith(d.key.split('#')[0] + '#') ? '#' + p.key.split('#')[1] : p.key)} <span>${esc(p.title)}</span></a>`).join('')}</div>` : ''}
		<div class="md gh-body${long && !expanded ? ' clamped' : ''}">${body}</div>
		${long ? `<button type="button" class="link-btn gh-more" data-gh-expand="${esc(key)}">${expanded ? 'Show less' : 'Show full description'}</button>` : ''}
		<div class="gh-comments-h"><span class="section-label">${d.commentCount ? `Comments · ${esc(d.commentCount)}` : 'No comments yet'}</span>${hidden > 0 ? `<a class="cd" href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener">${esc(hidden)} earlier on GitHub</a>` : ''}</div>
		${comments}`;
}

async function loadGitHub(key, fresh = false) {
	ui.gh ??= {};
	const prev = ui.gh[key];
	if (!fresh && prev && (prev.loading || (prev.data && Date.now() - prev.at < 3 * 60 * 1000))) return;
	ui.gh[key] = { ...prev, loading: !prev?.data, error: null };
	paintGitHub(key);
	try {
		const data = await api(`/api/github?key=${encodeURIComponent(key)}${fresh ? '&fresh=1' : ''}`);
		ui.gh[key] = { data, at: Date.now() };
	} catch (error) {
		ui.gh[key] = { ...prev, loading: false, error: prev?.data ? null : error.message };
		if (prev?.data) toast(`GitHub refresh failed: ${error.message}`, true);
	}
	paintGitHub(key);
}
function paintGitHub(key) {
	for (const slot of document.querySelectorAll('.gh-slot')) if (slot.dataset.key === key) slot.innerHTML = githubHtml(key);
	for (const slot of document.querySelectorAll('.reco-slot')) if (slot.dataset.key === key) slot.innerHTML = recoHtml(key);
	// Nothing to investigate or fix once it is closed on GitHub.
	const closed = ui.gh?.[key]?.data?.state === 'closed';
	for (const t of document.querySelectorAll('.issue-tools')) t.hidden = closed && ui.selected?.id === key;
}
function hydrateGitHub() {
	for (const slot of document.querySelectorAll('.reco-slot')) slot.innerHTML = recoHtml(slot.dataset.key);
	for (const slot of document.querySelectorAll('.gh-slot')) {
		slot.innerHTML = githubHtml(slot.dataset.key);
		loadGitHub(slot.dataset.key);
	}
}
function ghSlot(key) {
	return `<section class="gh" aria-label="On GitHub"><div class="gh-title section-label">On GitHub</div><div class="gh-slot" data-key="${esc(key)}"></div></section>`;
}

// ---------- Recommended next actions ----------
// Rule-based suggestions from the live GitHub state, the chat's triage, Sweeper and recorded outcomes.
// Actions either reuse a panel action (data-act) or ask the chat (which still needs approval for GitHub changes).
function recommendations(key) {
	const g = ui.gh?.[key]?.data;
	if (!g) return null;
	const sel = ui.selected;
	const n = sel?.kind === 'notification' ? ui.state.notifications.find(x => x.id === sel.id) : null;
	const det = sel?.detail?.issue?.key === key ? sel.detail : null;
	const outcome = det?.issue.outcome;
	const p = det?.proposal || {};
	const me = g.me;
	const days = iso => Math.floor((Date.now() - Date.parse(iso)) / 864e5);
	const labels = g.labels.map(l => l.name);
	const human = g.comments.filter(c => !c.author.bot);
	const lastHuman = human.at(-1);
	const myLast = [...human].reverse().find(c => c.author.login === me);
	const newSinceMe = lastHuman && lastHuman.author.login !== me && (!myLast || lastHuman.createdAt > myLast.createdAt);
	const ref = k => (k.startsWith('microsoft/vscode#') ? '#' + k.split('#')[1] : k);
	const recs = [];
	const ask = (label, text, primary) => ({ kind: 'ask', label, text, primary });
	const act = (label, a, primary) => ({ kind: 'act', label, act: a, key: n ? undefined : key, primary });
	const link = (label, url) => ({ kind: 'link', label, url });

	if (outcome?.decision === 'fixing') {
		recs.push({ icon: 'rocket', text: 'A fix session is already running for this issue.', actions: [ask('Get status', 'What is the status of the fix session for this issue? Summarize progress and what is left.')] });
	}
	if (g.state === 'closed') {
		const what = g.isPr ? (g.pr?.merged ? 'merged' : 'closed') : `closed${g.stateReason === 'not_planned' ? ' as not planned' : g.stateReason === 'completed' ? ' as completed' : ''}`;
		recs.push({ icon: 'pass', text: `Already ${what} on GitHub — nothing left to do.`, why: g.closedAt ? `${agoText(g.closedAt)}` : '', actions: n && !n.handled ? [act('Dismiss', 'dismiss', true)] : [] });
		return recs;
	}
	// Issue pages: the verdict of the user's inbox rules comes first (rules win over Sweeper).
	const rule = !n ? ruleOf(key) : null;
	if (rule && !outcome && g.state !== 'closed') {
		if (rule.group === 'route') {
			recs.push({ icon: 'person', text: `Your rules: route ${ruleLabel(rule).replace(/^→ /, 'to ')}`, why: [rule.rule, rule.reason].filter(Boolean).join(' · '), actions: [{ kind: 'act', label: rule.routeTo?.length ? 'Route' : 'Unassign me', act: 'route-issue', key, primary: true }, ask('Discuss', `My inbox rules suggest routing this issue (${rule.rule || 'routing rules'}: ${rule.reason}). Check it against the live issue and tell me whether to route it, with choices.`)] });
		} else if (rule.group === 'close') {
			recs.push({ icon: 'law', text: `Your rules: close${rule.closeAs ? ` as ${rule.closeAs}` : ''}`, why: [rule.rule, rule.reason].filter(Boolean).join(' · '), actions: [ask('Propose close', `My inbox rules say to close this issue${rule.closeAs ? ` as ${rule.closeAs}` : ''} (${rule.rule || 'rules'}: ${rule.reason}). Fetch it live, draft the closing comment following my rules, and ask me to approve with choices.`, true)] });
		} else if (rule.group === 'needs-info') {
			recs.push({ icon: 'question', text: 'Your rules: ask the reporter for info first', why: [rule.rule, rule.reason].filter(Boolean).join(' · '), actions: [ask('Ask for info', `My inbox rules say to ask the reporter for more information on this issue (${rule.rule || 'rules'}: ${rule.reason}). Draft the comment (add info-needed), and ask me to approve with choices.`, true)] });
		}
	}
	// Issue pages (Cleanup / Today): an open Sweeper close proposal is the main decision.
	if (!n && p.group && p.proposedComment && !outcome) {
		const fact = p.fixedByCommit ? `Fixed by ${p.fixedByCommit.slice(0, 7)}${p.shippedIn ? ` (${p.shippedIn})` : ''}` : p.duplicateOf ? `Duplicate of #${p.duplicateOf}` : p.closeReason || '';
		const chk = ui.checks?.[key]?.data?.summary;
		const chkText = chk ? (chk.warn + chk.fail ? `checks: ${chk.warn + chk.fail} need a look` : 'checks all clear') : '';
		const why = [`confidence ${Number(p.confidence ?? 0).toFixed(2)}`, chkText].filter(Boolean).join(' · ');
		recs.push({ icon: 'law', text: `${fact ? `${fact} — ` : ''}${APPROVE_LABEL[p.group].toLowerCase()}?`, why, actions: [{ kind: 'act', label: APPROVE_LABEL[p.group], act: 'apply', key, group: p.group, primary: true }, ask('Double-check', `Double-check Sweeper's "${APPROVE_LABEL[p.group]}" proposal for this issue against the live issue and latest comments (and the fix commit or duplicate if any), then tell me whether to approve, with choices.`)] });
	}
	if (g.isPr) {
		if (n?.reason === 'review_requested') recs.push({ icon: 'eye', text: 'Your review is requested.', why: g.pr ? `${g.pr.changedFiles} files, +${g.pr.additions} −${g.pr.deletions}` : '', actions: [link('Open PR', g.url), ask('Summarize', 'Summarize this PR: what it changes, risks, and what I should focus on in the review.', true)] });
		else if (g.author.login === me) recs.push({ icon: 'git-pull-request', text: g.pr?.draft ? 'Your draft PR — finish it or mark it ready.' : 'Your PR — check reviews and CI.', actions: [ask('Check status', 'Check the review comments and CI status of my PR and tell me what is blocking it.', true)] });
		else recs.push({ icon: 'eye', text: `${g.assignees.includes(me) ? 'Assigned to you' : 'PR'} by @${g.author.login}${g.pr?.draft ? ' (draft)' : ''} — review it.`, why: g.pr ? `${g.pr.changedFiles} files, +${g.pr.additions} −${g.pr.deletions}` : '', actions: [link('Open PR', g.url), ask('Summarize', 'Summarize this PR: what it changes, whether it is ready, risks, and what I should check in the review.', true)] });
	}
	if (n?.triage?.group === 'route') {
		recs.push({ icon: 'person', text: n.triage.routeTo?.length ? `Route to ${n.triage.routeTo.map(l => '@' + l).join(', ')}.` : 'Unassign yourself.', why: n.triage.rule || '', actions: [act('Route', 'route-one', true)] });
	}
	const suggested = (det?.owners?.suggested || []).filter(u => !g.assignees.includes(u));
	if (suggested.length && n?.triage?.group !== 'route' && !g.isPr) {
		recs.push({ icon: 'person', text: `Sweeper thinks ${suggested.map(u => '@' + u).join(', ')} owns this.`, actions: [ask('Route?', `Sweeper suggests ${suggested.join(', ')} as owner. Check the routing rules and whether that is right; if so, propose routing it (assign them, unassign me) and wait for my approval.`)] });
	}
	if (newSinceMe && me && lastHuman.body.includes('@' + me)) {
		recs.push({ icon: 'mention', text: `@${lastHuman.author.login} mentioned you and is waiting for a reply.`, why: agoText(lastHuman.createdAt), actions: [ask('Draft reply', `Draft a reply to @${lastHuman.author.login}'s latest comment on this issue. Show me the exact text for approval before posting.`, true)] });
	}
	if (labels.includes('info-needed')) {
		if (newSinceMe && lastHuman.author.login === g.author.login) {
			recs.push({ icon: 'comment', text: 'The reporter replied to your info request.', why: agoText(lastHuman.createdAt), actions: [ask('Review reply', 'The reporter replied to my info request. Summarize what they provided, whether it is enough to investigate, and propose the next step (e.g. remove info-needed). Wait for my approval before changing anything.', true)] });
		} else {
			const since = days(lastHuman?.createdAt || g.updatedAt);
			recs.push(since >= 7
				? { icon: 'clock', text: `No reply to the info request for ${since} days.`, actions: [ask('Close', 'This has had info-needed with no reply for over a week. Propose closing it as not planned (info not provided) with a short comment, and wait for my approval.', true)] }
				: { icon: 'clock', text: 'Waiting for the reporter to provide info.', why: lastHuman ? `asked ${agoText(lastHuman.createdAt)}` : '', actions: n && !n.handled ? [act('Dismiss', 'dismiss', true)] : [act('Defer', 'deferred')] });
		}
	} else if (newSinceMe && !recs.some(r => r.icon === 'mention')) {
		recs.push({ icon: 'comment', text: `New comment from @${lastHuman.author.login} since you last replied.`, why: agoText(lastHuman.createdAt), actions: [ask('Summarize', 'Summarize the new comments since my last reply and suggest what I should reply or do next.', !recs.length)] });
	}
	const merged = g.linkedPrs.filter(x => x.state === 'merged');
	const open = g.linkedPrs.filter(x => x.state === 'open');
	if (!g.isPr && merged.length) {
		recs.push({ icon: 'git-merge', text: `${merged.map(x => ref(x.key)).join(', ')} merged — close as fixed?`, actions: [ask('Verify & close', `Linked PR ${merged.map(x => x.url).join(', ')} was merged. Verify it fixes this issue and, if so, propose closing it as fixed (comment, milestone) and wait for my approval.`, !recs.length)] });
	} else if (!g.isPr && open.length) {
		recs.push({ icon: 'git-pull-request', text: `${open.map(x => ref(x.key)).join(', ')} is open for this issue.`, why: open[0].title, actions: [link('Open PR', open[0].url)] });
	}
	if (p.group && p.proposedComment && n) {
		recs.push({ icon: 'law', text: `Sweeper proposes: ${APPROVE_LABEL[p.group]}`, why: `confidence ${Number(p.confidence ?? 0).toFixed(2)}`, actions: [ask('Review proposal', `Review Sweeper's "${APPROVE_LABEL[p.group]}" proposal for this issue against the live issue, show me the comment, and ask me to approve with choices.`)] });
	}
	if (!g.isPr && !human.length && !labels.includes('info-needed') && !p.group) {
		const text = g.body.replace(/<!--[\s\S]*?-->/g, '');
		const isBug = labels.includes('bug') || det?.readiness?.itemType === 'bug' || /bug_report_template|Type:\s*\**\s*Bug\b/i.test(g.body);
		const isFeature = !isBug && (labels.includes('feature-request') || det?.readiness?.itemType === 'feature' || /feature_request_template|Type:\s*\**\s*Feature Request/i.test(g.body));
		const hasRepro = /steps to reproduce|repro|^\s*1[.)]\s/im.test(text) || /user-attachments|\.(png|gif|mp4)/i.test(text);
		if (isFeature || (!isBug && /^(?:feature|add|support|allow|option)\b|would like/i.test(g.title + ' ' + text.slice(0, 400)))) {
			recs.push({ icon: 'lightbulb', text: 'Feature request with no discussion yet.', actions: [ask('Backlog or close?', 'This is a feature request with no discussion. Check for duplicates and demand, then recommend keeping it (e.g. Backlog Candidates milestone) or closing it, with choices.', !recs.length)] });
		} else if (!hasRepro) {
			recs.push({ icon: 'question', text: 'No steps to reproduce yet.', actions: [ask('Ask for repro', 'Ask the reporter for exact steps to reproduce (and logs if relevant). Propose the comment with the info-needed label and wait for my approval.', !recs.length)] });
		}
	}
	const ready = det?.readiness?.agentReadiness;
	if (!g.isPr && (ready === 'implement' || ready === 'plan') && outcome?.decision !== 'fixing') {
		recs.push({ icon: 'rocket', text: 'Agent-ready: a fix session could take this.', actions: [n ? act('Start fix session', 'notification-start') : act('Start fix session', 'implement')] });
	}
	return recs.slice(0, 3);
}

function recoHtml(key) {
	const g = ui.gh?.[key];
	if (!g?.data) return g?.error ? '' : '<div class="reco"><div class="section-label">Recommended next</div><div class="cd reco-loading"><i class="codicon codicon-loading" aria-hidden="true"></i> Working out next steps…</div></div>';
	const recs = recommendations(key) || [];
	const btn = (a, first) => {
		const cls = `btn sm${a.primary && first ? ' primary' : ''}`;
		if (a.kind === 'link') return `<a class="${cls}" href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener">${esc(a.label)}</a>`;
		if (a.kind === 'act') return `<button type="button" class="${cls}" data-act="${esc(a.act)}"${a.key ? ` data-key="${esc(a.key)}"` : ''}${a.group ? ` data-group="${esc(a.group)}"` : ''}>${esc(a.label)}</button>`;
		return `<button type="button" class="${cls}" data-reco-ask="${esc(a.text)}" data-key="${esc(key)}" title="Asks the chat: ${esc(a.text)}"><i class="codicon codicon-comment-discussion" aria-hidden="true"></i>${esc(a.label)}</button>`;
	};
	return `<div class="reco">
		<div class="reco-h"><span class="section-label">Recommended next</span><button type="button" class="link-btn" data-reco-ask="What should I do next with this ${g.data.isPr ? 'PR' : 'issue'}? Look at the latest comments, linked PRs and my inbox rules, and reply with your recommendation and choices." data-key="${esc(key)}"><i class="codicon codicon-sparkle" aria-hidden="true"></i>Ask the chat</button></div>
		${recs.length ? `<ol class="reco-list">${recs.map((r, i) => `<li class="reco-item${i === 0 ? ' top' : ''}">
			<i class="codicon codicon-${esc(r.icon)} reco-icon" aria-hidden="true"></i>
			<div class="reco-main"><div class="reco-text">${esc(r.text)}</div>${r.why ? `<div class="reco-why cd">${esc(r.why)}</div>` : ''}</div>
			<div class="reco-acts">${r.actions.map(a => btn(a, i === 0)).join('')}</div>
		</li>`).join('')}</ol>` : '<div class="cd reco-none">Nothing stands out. Ask the chat if you want a second look.</div>'}
	</div>`;
}
function recoSlot(key) {
	return `<div class="reco-slot" data-key="${esc(key)}"></div>`;
}
async function askAboutIssue(key, text) {
	const g = ui.gh?.[key]?.data;
	try {
		await api('/api/message', { key, title: g?.title || '', text });
		toast('Asked the chat · the reply appears in the conversation below');
		if (ui.state.settings.chatCollapsed) setChatCollapsed(false);
		await load();
	} catch (error) { toast(error.message, true); }
}

function renderComment(text) {
	const inline = renderInline;
	const blocks = String(text ?? '').replace(/\r/g, '').split(/\n{2,}/);
	return blocks.map(block => {
		const lines = block.split('\n');
		if (lines.every(l => /^\s*>/.test(l))) {
			return `<blockquote>${inline(lines.map(l => l.replace(/^\s*> ?/, '')).join('\n')).replace(/\n/g, '<br>')}</blockquote>`;
		}
		if (lines.every(l => /^\s*[-*] /.test(l))) {
			return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`).join('')}</ul>`;
		}
		if (/^\/\w+/.test(block.trim())) return `<p class="cd"><code>${esc(block.trim())}</code></p>`;
		return `<p>${inline(block).replace(/\n/g, '<br>')}</p>`;
	}).join('');
}

function setCommentView(view) {
	const ta = document.getElementById('comment');
	const pv = document.getElementById('comment-preview');
	if (!ta || !pv) return;
	if (view === 'preview') pv.innerHTML = renderComment(ta.value);
	ta.hidden = view !== 'edit';
	pv.hidden = view === 'edit';
	for (const b of document.querySelectorAll('[data-cview]')) {
		const on = b.dataset.cview === view;
		b.setAttribute('aria-pressed', String(on));
		b.setAttribute('aria-selected', String(on));
	}
	if (view === 'edit') ta.focus();
}

// Per-issue conversation with the chat: what you asked from the panel and the chat's replies.
function threadHtml(key, title) {
	const entries = ui.state.threads?.[key] || [];
	const waiting = entries.length && entries[entries.length - 1].role === 'user';
	const collapsed = !!ui.state.settings.chatCollapsed;
	const height = ui.state.settings.chatHeight || 160;
	const last = entries[entries.length - 1];
	const choices = last?.role === 'agent' && last.choices?.length
		? `<div class="choices" role="group" aria-label="Quick replies">${last.choices.map((c, i) => `<button type="button" class="btn choice ${c.style === 'primary' ? 'primary' : c.style === 'danger' ? 'danger' : ''}" data-act="choice" data-key="${esc(key)}" data-i="${i}" title="${esc(c.edit ? `Edit, then send: ${c.reply}` : `Sends: ${c.reply}`)}">${c.edit ? '<i class="codicon codicon-edit" aria-hidden="true"></i>' : ''}${esc(c.label)}</button>`).join('')}</div>`
		: '';
	const bubbles = entries.map(e => `<div class="bubble ${e.role === 'user' ? 'me' : 'agent'}">
		<div class="bubble-meta">${e.role === 'user' ? 'You' : 'Chat'} · ${esc(agoText(e.at))}</div>
		<div class="bubble-text">${e.role === 'user' ? linkify(e.text).replace(/\n/g, '<br>') : `<div class="md">${renderMarkdown(e.text)}</div>`}</div>
		${e === last ? choices : ''}
	</div>`).join('');
	const count = entries.length ? `${entries.length} message${entries.length > 1 ? 's' : ''}` : 'No messages yet';
	const chat = issueChat(key);
	const openChat = chat ? `<button type="button" class="link-btn thread-chat" data-act="open-session" data-link="${esc(chat.link)}" title="${chat.stage === 'session' ? 'Open the work session for this issue (it holds this conversation)' : 'Open this issue\'s chat in the Agents window'}"><i class="codicon codicon-comment-discussion" aria-hidden="true"></i>${chat.stage === 'session' ? 'Open session' : 'Open chat'}</button>` : '';
	return `<section class="thread${collapsed ? ' collapsed' : ''}" aria-label="Ask the chat about ${esc(shortKey(key))}">
		${entries.length ? `<div class="dock-resize" role="separator" aria-orientation="horizontal" aria-label="Resize conversation" tabindex="0" title="Drag to resize"></div>` : ''}
		${entries.length ? `<button type="button" class="dock-head" data-act="toggle-chat" aria-expanded="${!collapsed}">
			<i class="codicon codicon-chevron-right" aria-hidden="true"></i><span>Conversation</span><span class="cd">· ${count}${waiting ? ' · waiting for reply' : ''}</span>
		</button>` : ''}${openChat}
		${entries.length ? `<div class="bubbles" tabindex="0" aria-label="Conversation with the chat" style="height:${height}px">${bubbles}${waiting ? '<div class="cd waiting"><i class="codicon codicon-loading" aria-hidden="true"></i> Waiting for the chat…</div>' : ''}</div>` : ''}
		<form class="composer" data-key="${esc(key)}" data-title="${esc(title || '')}">
			<textarea class="ask-input" rows="1" aria-label="Message to the chat about this issue" placeholder="${chat ? `Message the ${esc(shortKey(key))} chat…` : `Discuss ${esc(shortKey(key))} (starts its own chat)…`}" title="Enter to send · Shift+Enter for a new line"></textarea>
			<button type="submit" class="send" aria-label="Send" title="Send (Enter)"><i class="codicon codicon-send" aria-hidden="true"></i></button>
		</form>
	</section>`;
}

// Title row with an Open icon and a split button: the primary action plus a menu of the other actions.
const DECISION_LABEL = {
	closed: 'Closed', duplicate: 'Closed as duplicate', 'needs-info-sent': 'Info requested', accepted: 'Accepted',
	rejected: 'Kept open', deferred: 'Deferred', routed: 'Routed', fixing: 'Fixing', fixed: 'Fixed', 'wont-fix': "Won't fix",
};
// Assignees as GitHub handles; Sweeper's suggested owner is shown only when it differs.
function ownersHtml(owners) {
	if (!owners) return '';
	const handle = u => `<a class="owner" href="https://github.com/${encodeURIComponent(u)}" target="_blank" rel="noopener" title="${esc(u)} on GitHub"><i class="codicon codicon-account" aria-hidden="true"></i>${esc(u)}</a>`;
	const assigned = owners.assignees || [];
	const extra = (owners.suggested || []).filter(u => !assigned.includes(u));
	return `<div class="owners"><span class="owners-label">${assigned.length > 1 ? 'Owners' : 'Owner'}</span>${assigned.length ? assigned.map(handle).join('') : '<span class="cd">unassigned</span>'}${extra.length ? `<span class="owners-label suggested" title="Sweeper's suggested owner">Sweeper suggests</span>${extra.map(handle).join('')}` : ''}</div>`;
}

function decisionChip(outcome) {
	const label = DECISION_LABEL[outcome.decision] || outcome.decision;
	const detail = outcome.decision === 'closed' && /implemented-on-main|fixed/.test(outcome.note || '') ? ' · fixed' : '';
	return `<span class="decided" title="${esc(outcome.note || '')} (${esc(agoText(outcome.decidedAt))})"><i class="codicon codicon-pass" aria-hidden="true"></i>${esc(label + detail)}</span>`;
}

function titleBarHtml({ title, url, meta, primary, menu, status }) {
	if (status) {
		return `<div class="title-block">
		<h2>${esc(title)}</h2>
		<div class="title-sub">${meta}<div class="title-actions">${status}</div></div>
	</div>`;
	}
	const attrs = a => `data-act="${esc(a.act)}"${a.key ? ` data-key="${esc(a.key)}"` : ''}${a.group ? ` data-group="${esc(a.group)}"` : ''}${a.milestone ? ` data-milestone="${esc(a.milestone)}"` : ''}${a.link ? ` data-link="${esc(a.link)}"` : ''}`;
	const split = primary ? `<div class="split">
		<button type="button" class="btn primary split-main" ${attrs(primary)}>${primary.icon ? `<i class="codicon codicon-${primary.icon}" aria-hidden="true"></i>` : ''}${esc(primary.label)}</button>
		${menu?.length ? `<button type="button" class="btn primary split-toggle" aria-haspopup="menu" aria-expanded="false" aria-label="More actions"><i class="codicon codicon-chevron-down" aria-hidden="true"></i></button>
		<div class="menu" role="menu" hidden>${menu.map(m => `<button type="button" role="menuitem" ${attrs(m)}>${esc(m.label)}</button>`).join('')}</div>` : ''}
	</div>` : '';
	return `<div class="title-block">
		<h2>${esc(title)}</h2>
		<div class="title-sub">${meta}<div class="title-actions">${split}</div></div>
	</div>`;
}

function pendingHtml(key, pending, mode) {
	const m = mode === 'informed' ? ' data-mode="informed"' : '';
	const controls = `<button type="button" class="link-btn" data-act="opinion" data-key="${esc(key)}"${m}>Retry</button> · <button type="button" class="link-btn" data-act="cancel-opinion" data-key="${esc(key)}"${m}>Cancel</button>`;
	const what = mode === 'informed' ? 'Re-judging with Sweeper\'s evidence' : 'Judging blind';
	if (pending.failed) {
		return `<div class="opinion op-disagree"><span><i class="codicon codicon-error" aria-hidden="true"></i> Couldn't start the judge chat: ${esc(pending.failed)} ${controls}</span></div>`;
	}
	return pending.stalled
		? `<div class="opinion op-unsure"><span><i class="codicon codicon-warning" aria-hidden="true"></i> No verdict ${esc(ago(pending.at))} after asking. The judge chat may not have started. ${controls}</span></div>`
		: `<div class="opinion"><span class="cd"><i class="codicon codicon-loading" aria-hidden="true"></i> ${what} in a separate chat (asked ${esc(agoText(pending.at))})… ${controls}</span></div>`;
}

function verdictBody(v) {
	return `<div class="op-action"><b>${esc(ACTION_LABEL[v.action] || v.action)}</b>${v.reference ? ` · ${linkify(v.reference)}` : ''}</div>
		<div>${linkify(v.reasoning)}</div>
		${v.evidence?.length ? `<ul class="evidence">${v.evidence.map(e => `<li>${linkify(e)}</li>`).join('')}</ul>` : ''}`;
}

// The second round: the same judge question, but now shown Sweeper's claims to verify.
function informedHtml(key, op, blindCmp) {
	const pending = ui.state.informedPending?.[key];
	const inf = op.informed;
	if (inf && !pending) {
		const cmp = compareOpinion(inf, proposalFor(key));
		const cls = cmp === 'agree' ? 'op-agree' : cmp === 'partial' ? 'op-unsure' : 'op-disagree';
		const label = cmp === 'agree' ? 'Now agrees with Sweeper' : cmp === 'partial' ? 'Now same action, different reference' : 'Still disagrees with Sweeper';
		const conf = typeof inf.confidence === 'number' ? ` · ${Math.round(inf.confidence * 100)}% confident` : '';
		return `<div class="opinion ${cls} informed">
			<div><span class="verdict">${label}</span> <span class="cd">· after checking Sweeper's evidence ${esc(agoText(inf.judgedAt))}${conf} · </span><button type="button" class="link-btn" data-act="opinion" data-mode="informed" data-key="${esc(key)}">re-judge again</button></div>
			${verdictBody(inf)}
		</div>`;
	}
	if (pending) return pendingHtml(key, pending, 'informed');
	if (blindCmp === 'agree' || !blindCmp) return '';
	return `<button type="button" class="btn" data-act="opinion" data-mode="informed" data-key="${esc(key)}"><i class="codicon codicon-law" aria-hidden="true"></i>Re-judge with Sweeper's evidence</button>
		<p class="hint">Starts a separate chat that sees the blind verdict and Sweeper's claims, verifies each claim, and says whether it now agrees.</p>`;
}

function opinionHtml(key) {
	const op = ui.state.opinions[key];
	const pending = ui.state.opinionPending?.[key];
	const again = `<button type="button" class="link-btn" data-act="opinion" data-key="${esc(key)}">judge again</button>`;
	if (op) {
		const cmp = compareOpinion(op, proposalFor(key));
		const cls = cmp === 'agree' ? 'op-agree' : cmp === 'partial' ? 'op-unsure' : cmp === 'disagree' ? 'op-disagree' : '';
		const verdict = cmp === 'agree' ? 'Agrees with Sweeper' : cmp === 'partial' ? 'Same action, different reference' : cmp === 'disagree' ? 'Disagrees with Sweeper' : 'Independent judgement';
		const conf = typeof op.confidence === 'number' ? ` · ${Math.round(op.confidence * 100)}% confident` : '';
		return `<div class="opinion ${cls}">
			<div><span class="verdict">${verdict}</span> <span class="cd">· judged blind ${esc(agoText(op.judgedAt))}${conf} · </span>${pending ? '<span class="cd">re-judging…</span>' : again}</div>
			${verdictBody(op)}
		</div>
		<div class="informed-slot">${informedHtml(key, op, cmp)}</div>`;
	}
	if (pending) return pendingHtml(key, pending, 'blind');
	return `<button type="button" class="btn" data-act="opinion" data-key="${esc(key)}"><i class="codicon codicon-law" aria-hidden="true"></i>Get an independent judgement</button>
		<p class="hint">Starts a separate chat that judges this issue without seeing Sweeper's verdict.</p>`;
}

// PRs and issues outside the index (e.g. not assigned to you, or filed after the last refresh):
// title and details come straight from GitHub; the conversation still works.
// Planning actions for an issue shown from My Work or Browse: local moves, GitHub milestones, untriage.
function workMenu(key, opts) {
	const localPin = (ui.work?.data?.pinnedIssues || []).find(p => p.key === key);
	const here = opts.work.group || (localPin ? localPin.bucket || 'current' : opts.work.milestone?.role);
	const browseAdds = opts.browse && !inMyWork(key) ? ['current', 'next'].map(b => ({ act: 'issue-move', key, milestone: b, label: `Add to ${groupLabel(b)} (local)` })) : [];
	const localMoves = localPin || here === 'priorities' ? ['current', 'next'].filter(b => b !== here).map(b => ({ act: 'issue-move', key, milestone: b, label: `Move to ${groupLabel(b)} (local)` })) : [];
	// Issues planned on GitHub for current/next can go back to untriaged (milestone cleared on GitHub).
	const planned = !localPin && (here === 'current' || here === 'next') && opts.work.milestone?.title;
	const unplan = planned ? [{ act: 'move-milestone', key, milestone: 'none', label: `Remove from ${opts.work.milestone.title} (untriaged)` }] : [];
	return [...browseAdds, ...localMoves, ...planMenu(key, opts.work.milestone?.title), ...unplan, ...(localPin ? [{ act: 'issue-unpin', key, label: 'Remove from My Work' }] : [])];
}

async function renderUnindexedInto(el, key, opts = {}) {
	let g = ui.gh?.[key]?.data;
	if (!g) {
		try { g = await api(`/api/github?key=${encodeURIComponent(key)}`); ui.gh ??= {}; ui.gh[key] = { data: g, at: Date.now() }; } catch { g = null; }
	}
	const url = g?.url || `https://github.com/${key.split('#')[0]}/issues/${key.split('#')[1]}`;
	const meta = `<div class="meta"><a class="num-link" href="${esc(safeUrl(url))}" target="_blank" rel="noopener">${esc(shortKey(key))}</a><span class="sep">·</span><span>${g?.isPr ? 'Pull request' : 'Issue'}</span><span class="sep">·</span><span class="cd">not in your issue index</span></div>`;
	const live = liveSession(key);
	const primary = opts.work ? (live ? { act: 'open-session', link: live.link, label: 'Open session', icon: 'comment-discussion' } : { act: 'work-session', key, label: 'Start session', icon: 'rocket' }) : null;
	const menu = opts.work ? [...(live ? [{ act: 'work-session-new', key, label: 'Start another session' }] : []), ...workMenu(key, opts)] : [];
	el.innerHTML = `<div class="detail-head">${titleBarHtml({ title: g?.title || key, url, meta, primary, menu })}</div>
		<div class="detail-body">${recoSlot(key)}${sessionsHtml(sessionsOf(key))}${ghSlot(key)}</div>
		<div class="footer">${threadHtml(key, g?.title || '')}</div>`;
	hydrateGitHub();
}

async function renderIssueInto(el, key, fetchDetail, nested, silent = false, opts = {}) {
	const sel = ui.selected;
	if (fetchDetail || !sel.detail || sel.detail.issue.key !== key) {
		if (!(silent && sel.detail?.issue.key === key)) el.innerHTML = '<div class="empty">Loading…</div>';
		try { sel.detail = await api(`/api/issue?key=${encodeURIComponent(key)}`); } catch (error) {
			if (!nested && /not in your issue index/.test(error.message)) { await renderUnindexedInto(el, key, opts); return; }
			el.innerHTML = `<div class="callout bad">${esc(error.message)}</div>`;
			return;
		}
	}
	const { issue, proposal, review, readiness, owners } = sel.detail;
	const p = proposal || {};
	const isCleanup = !!(p.group && p.proposedComment);
	const isImplement = !isCleanup && (readiness?.agentReadiness === 'implement' || readiness?.agentReadiness === 'plan');
	const safeKey = esc(key);
	const outcome = outcomeHtml(issue.outcome);
	const summary = p.summary || review?.Summary;
	const meta = `<div class="meta-col"><div class="meta"><a class="num-link" href="${esc(safeUrl(issue.url))}" target="_blank" rel="noopener" title="Open ${esc(issue.key)} (⌘-click for the other target)">${esc(shortKey(issue.key))}</a><span>·</span><span>${esc(issue.area)}</span><span>·</span><span>updated ${esc(agoText(issue.updatedAt))}</span></div>${ownersHtml(owners)}</div>`;
	let body = '';
	let primary = null;
	let menu = [];
	const skip = nested ? [] : [{ act: 'skip-issue', key, label: 'Skip' }];
	// Top-level views mirror the notification view: a context card (why it's here), recommended next,
	// issue actions, then grouped cards, then On GitHub. `body` is the flat variant used inside a notification.
	let ctx = null;
	let cards = '';
	const card = (label, inner, cls = '', aside = '') => `<section class="linked dcard ${cls}"><div class="linked-head"><span class="section-label">${label}</span>${aside}</div>${inner}</section>`;
	const sevTag = issue.sweeper?.severity ? `<span class="tag sev">${esc(issue.sweeper.severity)}</span>` : '';
	if (isCleanup) {
		const fact = p.fixedByCommit ? `<span class="tag acc">Fixed by <a href="https://github.com/microsoft/vscode/commit/${esc(p.fixedByCommit)}" target="_blank" rel="noopener"><code>${esc(p.fixedByCommit.slice(0, 7))}</code></a>${p.shippedIn ? ` · ${esc(p.shippedIn)}` : ''}</span>`
			: p.duplicateOf ? `<span class="tag acc">Duplicate of <a href="https://github.com/microsoft/vscode/issues/${esc(p.duplicateOf)}" target="_blank" rel="noopener">#${esc(p.duplicateOf)}</a></span>`
				: p.closeReason ? `<span class="tag acc">${esc(p.closeReason)}</span>` : '';
		const recheck = `<button type="button" class="link-btn" data-act="recheck" data-key="${safeKey}"><i class="codicon codicon-refresh" aria-hidden="true"></i>Re-check</button>`;
		const seg = `<div class="seg seg-2 mini" role="tablist" aria-label="Comment view">
					<button type="button" role="tab" data-cview="preview" aria-pressed="true" aria-selected="true">Preview</button>
					<button type="button" role="tab" data-cview="edit" aria-pressed="false" aria-selected="false">Edit</button>
				</div>`;
		const comment = `<div class="comment-preview pending-only" id="comment-preview">${renderComment(p.proposedComment)}</div>
			<textarea id="comment" aria-label="Comment to post" hidden>${esc(p.proposedComment)}</textarea>`;
		const evidence = p.evidence?.length ? `<details><summary>Sweeper's evidence</summary><div class="inner"><ul class="evidence">${p.evidence.map(e => `<li>${linkify(e.replace(/\*\*/g, ''))}</li>`).join('')}</ul></div></details>` : '';
		const plan = `<details class="pending-only"><summary>What will run</summary><div class="inner"><ol class="plan">${(p.plan || []).map(st => `<li>${esc(st)}</li>`).join('')}</ol></div></details>`;
		body = `<div class="facts"><span class="tag">Sweeper ${esc(Number(p.confidence ?? 0).toFixed(2))}</span>${fact}</div>
			<h3>Why</h3><p class="lead">${linkify(summary)}</p>
			<div class="checks-block" style="display:flex;align-items:center;gap:8px"><h3 style="flex:1">Your checks</h3>${recheck}</div>
			<div id="checks-${safeKey}" class="checks-block">${checksHtml(key)}</div>
			<h3>Independent judgement</h3><div id="opinion-${safeKey}">${opinionHtml(key)}</div>
			<div class="comment-head pending-only"><h3>Comment</h3>${seg}</div>${comment}${evidence}${plan}`;
		ctx = { tone: 't-cleanup', icon: 'law', head: `Sweeper proposes: ${APPROVE_LABEL[p.group]}`, tags: `<span class="tag">confidence ${esc(Number(p.confidence ?? 0).toFixed(2))}</span>${fact}${sevTag}`, text: summary };
		cards = card('Comment to post', `${comment}${plan}`, 'pending-only comment-card', seg)
			+ card('Your checks', `<div id="checks-${safeKey}">${checksHtml(key)}</div>`, 'checks-block', recheck)
			+ card('Independent judgement', `<div id="opinion-${safeKey}">${opinionHtml(key)}</div>`)
			+ (p.evidence?.length ? card("Sweeper's evidence", `<ul class="evidence">${p.evidence.map(e => `<li>${linkify(e.replace(/\*\*/g, ''))}</li>`).join('')}</ul>`) : '');
		primary = { act: 'apply', key, group: p.group, label: APPROVE_LABEL[p.group] };
		menu = [{ act: 'rejected', key, label: 'Keep open' }, { act: 'deferred', key, label: 'Defer' }, ...skip];
		body = `<div id="attention-${safeKey}" class="attention-slot">${attentionHtml(key)}</div>` + body;
		if (!issue.outcome && (!ui.checks[key] || (fetchDetail && ui.checks[key].error))) loadChecks(key);
	} else if (isImplement) {
		const tags = `<span class="tag">${esc(readiness.itemType || 'issue')}</span>${sevTag}<span class="tag acc">agent: ${esc(readiness.agentReadiness)}</span>${readiness.upvotes ? `<span class="tag"><i class="codicon codicon-thumbsup" aria-hidden="true"></i>${esc(readiness.upvotes)}</span>` : ''}`;
		body = `<div class="facts">${tags}</div>
			${review?.['Change summary'] ? `<h3>The change</h3><p class="lead">${linkify(review['Change summary'])}</p>` : ''}
			${review?.['Best solution'] ? `<h3>Suggested approach</h3><p class="lead">${linkify(review['Best solution'])}</p>` : ''}
			${summary ? `<details><summary>Sweeper's assessment</summary><div class="inner">${linkify(summary)}</div></details>` : ''}`;
		ctx = { tone: 't-ok', icon: 'rocket', head: 'Agent-ready', tags, text: review?.['Change summary'] || summary };
		cards = (review?.['Best solution'] ? card('Suggested approach', `<p class="lead">${linkify(review['Best solution'])}</p>`) : '')
			+ (summary && review?.['Change summary'] ? card("Sweeper's assessment", `<p class="lead">${linkify(summary)}</p>`) : '');
		primary = nested ? null : { act: 'implement', key, label: 'Start fix session', icon: 'rocket' };
		menu = [{ act: 'deferred', key, label: 'Defer' }, ...skip];
	} else {
		const action = issue.sweeper?.action;
		const actionTag = action ? `<span class="tag ${action === 'keep-open' ? '' : 'acc'}">${esc(action.replace(/-/g, ' '))}</span>` : '';
		body = summary ? `<h3>Sweeper${action ? ` suggests ${actionTag}` : ''}</h3><p class="lead">${linkify(summary)}</p>` : '<p class="cd">No Sweeper proposal for this issue.</p>';
		const section = (ui.state.sections || []).find(sec => sec.items.some(i => i.key === key));
		const sectionTitle = section?.title.replace(/:.*$/, '');
		ctx = section
			? { tone: /severe/i.test(section.title) ? 't-action' : 't-info', icon: 'calendar', head: sectionTitle, tags: `${actionTag}${sevTag}`, text: section.why || section.title.replace(/^[^:]*:\s*/, '') }
			: { tone: 't-info', icon: 'info', head: 'Your issue', tags: `${actionTag}${sevTag}`, text: '' };
		cards = summary ? card(`Sweeper${action ? ` suggests ${actionTag}` : ''}`, `<p class="lead">${linkify(summary)}</p>`) : '';
		primary = { act: 'rejected', key, label: 'Keep open' };
		menu = [{ act: 'deferred', key, label: 'Defer' }, ...skip];
	}
	if (opts.work) {
		// My Work: the work session is the main action; planning moves are in the menu.
		const live = liveSession(key);
		primary = live ? { act: 'open-session', link: live.link, label: 'Open session', icon: 'comment-discussion' } : { act: 'work-session', key, label: 'Start session', icon: 'rocket' };
		menu = [...(live ? [{ act: 'work-session-new', key, label: 'Start another session' }] : []), ...workMenu(key, opts)];
	} else if (!nested && ui.work?.data) {
		menu = [...menu, ...planMenu(key, sel.detail?.milestone)];
	}
	// In My Work the plan is what matters: an earlier triage decision doesn't hide the actions.
	const decided = !opts.work && issue.outcome && issue.outcome.decision !== 'fixing' ? issue.outcome : null;
	if (nested) {
		// Inside a notification: no repeated title, and only secondary buttons (the notification owns the primary action).
		const attrs = a => `data-act="${esc(a.act)}"${a.key ? ` data-key="${esc(a.key)}"` : ''}${a.group ? ` data-group="${esc(a.group)}"` : ''}${a.milestone ? ` data-milestone="${esc(a.milestone)}"` : ''}${a.link ? ` data-link="${esc(a.link)}"` : ''}`;
		const buttons = decided ? '' : [primary, ...menu].filter(Boolean).map(a => `<button type="button" class="btn" ${attrs(a)}>${a.icon ? `<i class="codicon codicon-${a.icon}" aria-hidden="true"></i>` : ''}${esc(a.label)}</button>`).join('');
		// A fix session is already running: don't offer to start another.
		if (issue.outcome?.decision === 'fixing' && opts.extras) opts.extras = opts.extras.replace(/<button[^>]*data-act="notification-start"[\s\S]*?<\/button>\s*/, '');
		const toolbar = (opts.extras || buttons) ? `<div class="toolbar">${opts.extras || ''}${opts.extras && buttons ? '<span class="tb-sep" aria-hidden="true"></span>' : ''}${buttons}</div>` : '';
		el.innerHTML = `<section class="linked${decided ? ' is-decided' : ''}" aria-label="Your issue ${esc(shortKey(key))}">
			<div class="linked-head"><span class="section-label">Your issue</span>${decided ? decisionChip(decided) : ''}</div>
			${opts.sameTitle ? '' : `<div class="linked-title">${esc(issue.title)}</div>`}
			${meta}
			${outcome}
			${toolbar}
			${sessionsHtml(sessionsOf(key))}
			<div class="linked-body">${body}</div>
		</section>`;
		return;
	}
	const head = titleBarHtml({ title: issue.title, url: issue.url, meta, primary, menu, status: decided ? decisionChip(decided) : null });
	const rule = ruleOf(key);
	const rp = ui.state.issueRulesPending;
	const ruleTone = { route: 't-route', close: 't-action', 'needs-info': 't-route', keep: 't-ok' };
	const ruleHead = { route: () => `Your rules: route ${ruleLabel(rule).replace(/^→ /, 'to ')}`, close: () => `Your rules: close${rule.closeAs ? ` as ${rule.closeAs}` : ''}`, 'needs-info': () => 'Your rules: ask for info first', keep: () => 'Your rules: keep it' };
	const ruleHtml = rule
		? `<div class="triage-card ${ruleTone[rule.group] || 't-none'}"><div class="tc-head"><i class="codicon codicon-law" aria-hidden="true"></i>${esc(ruleHead[rule.group]?.() || rule.group)}${rule.rule ? `<span class="tag">${esc(rule.rule)}</span>` : ''}</div><p>${linkify(rule.reason)}</p></div>`
		: rp && !rp.stalled && rp.keys?.includes(key)
			? '<div class="triage-card t-none"><div class="tc-head"><i class="codicon codicon-loading" aria-hidden="true"></i>Checking your inbox rules…</div></div>'
			: '';
	const ctxHtml = ruleHtml + (ctx ? `<div class="triage-card ${ctx.tone}">
		<div class="tc-head"><i class="codicon codicon-${ctx.icon}" aria-hidden="true"></i>${esc(ctx.head)}${ctx.tags || ''}</div>
		${ctx.text ? `<p>${linkify(ctx.text)}</p>` : ''}
	</div>` : '');
	const fixing = issue.outcome?.decision === 'fixing';
	const tools = decided ? '' : [
		`<button type="button" class="btn" data-act="issue-investigate" data-key="${safeKey}"><i class="codicon codicon-search" aria-hidden="true"></i>Investigate</button>`,
		!isImplement && !fixing ? `<button type="button" class="btn" data-act="implement" data-key="${safeKey}"><i class="codicon codicon-rocket" aria-hidden="true"></i>Start fix session</button>` : '',
	].join('');
	const attention = isCleanup ? `<div id="attention-${safeKey}" class="attention-slot">${attentionHtml(key)}</div>` : '';
	el.innerHTML = `<div class="detail-head">${head}</div><div class="detail-body${decided ? ' is-decided' : ''}">${outcome}${ctxHtml}${attention}${recoSlot(key)}${tools ? `<div class="toolbar issue-tools">${tools}</div>` : ''}${sessionsHtml(sessionsOf(key))}${cards}${ghSlot(key)}</div><div class="footer">${threadHtml(key, issue.title)}</div>`;
}

// ---------- MSRC ----------
// Deadline label: "Jul 14 · overdue 105d" / "Nov 3 · in 7d" / "no deadline".
function msrcDue(c) {
	const t = Date.parse(c.resolveBy || '');
	if (isNaN(t)) return { text: 'no deadline', cls: '' };
	const days = Math.round((t - Date.now()) / 864e5);
	const date = new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
	return days < 0 ? { text: `${date} · overdue ${-days}d`, cls: 'bad' } : { text: `${date} · in ${days}d`, cls: days <= 7 ? 'sev' : '' };
}
// MSRC items pasted into My Work: the user's own IcM link, title, deadline and description.
function renderMsrcItemInto(el, id) {
	const saved = (ui.work?.data?.msrcItems || []).find(x => x.incidentId === id);
	const x = saved || (ui.msrcDraft?.incidentId === id ? ui.msrcDraft : null);
	if (!x) { el.innerHTML = '<div class="empty">This MSRC item is no longer in My Work.</div>'; return; }
	const link = x.link || `https://portal.microsofticm.com/imp/v5/incidents/details/${id}/summary`;
	if (!saved || ui.msrcEditing === id) {
		el.innerHTML = `<div class="detail-head">${titleBarHtml({ title: saved ? `Edit IcM ${id}` : `Add MSRC item · IcM ${id}`, url: link, meta: `<div class="meta"><a class="num-link" href="${esc(safeUrl(link))}" target="_blank" rel="noopener">IcM ${esc(id)}</a></div>` })}</div>
			<div class="detail-body"><form class="msrc-form dcard" data-msrc-form data-id="${esc(id)}" data-link="${esc(link)}">
				<label for="msrc-title">Title</label><input id="msrc-title" name="title" type="text" maxlength="200" value="${esc(saved ? x.title : '')}" placeholder="Short title, e.g. RCE via …" required>
				<label for="msrc-due">Resolve by</label><input id="msrc-due" name="resolveBy" type="date" value="${esc(x.resolveBy || '')}">
				<label for="msrc-desc">Description</label><textarea id="msrc-desc" name="description" rows="14" maxlength="20000" placeholder="Paste the case description">${esc(x.description || '')}</textarea>
				<div class="msrc-form-actions"><button type="submit" class="btn primary">Save</button><button type="button" class="btn" data-msrc-cancel>Cancel</button></div>
				<p class="cd msrc-note"><i class="codicon codicon-lock" aria-hidden="true"></i> Saved only on this machine (your My Work data folder). Never posted to GitHub.</p>
			</form></div>`;
		el.querySelector('#msrc-title')?.focus();
		return;
	}
	const sessions = ui.work?.data?.msrcSessions?.[id] || [];
	const live = sessions.find(z => !z.archived);
	const due = msrcDue(x);
	const meta = `<div class="meta"><a class="num-link" href="${esc(safeUrl(link))}" target="_blank" rel="noopener" title="Open in IcM">IcM ${esc(id)}</a><span class="sep">·</span><span class="tag ${due.cls}"><i class="codicon codicon-clock" aria-hidden="true"></i>${esc(x.resolveBy ? `Resolve by ${due.text}` : 'No deadline set')}</span><span class="sep">·</span><span class="cd">added ${esc(agoText(x.addedAt))}</span></div>`;
	const primary = live ? { act: 'open-session', link: live.link, label: 'Open session', icon: 'comment-discussion' } : { act: 'msrc-item-session', key: id, label: 'Start session', icon: 'rocket' };
	const menu = [...(live ? [{ act: 'msrc-item-session', key: id, label: 'Start another session' }] : []), { act: 'msrc-item-edit', key: id, label: 'Edit' }, { act: 'msrc-item-remove', key: id, label: 'Remove from My Work' }];
	el.innerHTML = `<div class="detail-head">${titleBarHtml({ title: x.title || `IcM ${id}`, url: link, meta, primary, menu })}</div>
		<div class="detail-body">
			${sessionsHtml(sessions)}
			<section class="linked dcard"><div class="linked-head"><span class="section-label">Description</span></div><div class="msrc-desc">${x.description ? esc(x.description) : '<span class="cd">No description. Use Edit to paste it.</span>'}</div></section>
			<p class="cd msrc-note"><i class="codicon codicon-lock" aria-hidden="true"></i> Security fix: the session follows your private fix workflow (msrc.fixWorkflow in my-work.config.json) and never uses a public repo, branch, PR or issue. Saved only on this machine.</p>
		</div>`;
}
// My Work home: the My Work chat and the recently active sessions that can be pinned.
function renderWorkHomeInto(el) {
	const recent = ui.work?.data?.recentSessions || [];
	const rows = recent.map(z => `<li class="sess-row">
		<div class="sess-main">
			<div class="sess-title">${esc(z.title || 'Untitled session')}${!z.read ? ' <span class="tag acc">unread</span>' : ''}</div>
			<div class="sess-meta cd">${[z.project ? esc(z.project) : '', z.branch ? `<code>${esc(z.branch)}</code>` : '', z.modified ? `active ${esc(agoText(new Date(z.modified).toISOString()))}` : ''].filter(Boolean).join(' · ')}</div>
		</div>
		<button type="button" class="btn sm" data-act="pin-session" data-key="${esc(z.id)}" title="Add this session to My Work"><i class="codicon codicon-add" aria-hidden="true"></i>Add</button>
	</li>`).join('');
	el.innerHTML = `<div class="detail-head">${titleBarHtml({ title: 'Add a session to My Work', meta: '<div class="meta"><span class="cd">Your most recently active sessions. Or ask the My Work chat below the list: "add the session I\'m in".</span></div>' })}</div>
		<div class="detail-body">
			<section class="linked dcard sess-card"><div class="linked-head"><span class="section-label">Active sessions</span></div>
				${rows ? `<ul class="sess-list">${rows}</ul>` : '<p class="cd" style="padding:8px 12px">No active sessions.</p>'}
			</section>
		</div>`;
}

// Find work: pull candidates into My Work from live GitHub searches.
const FIND_SOURCES = [['bugs', 'Bugs', 'bug'], ['features', 'Features', 'lightbulb'], ['area', 'Area', 'tag'], ['reviews', 'Reviews', 'git-pull-request'], ['mine', 'All', 'issues']];
// The filter narrows the selected source and applies on Enter. GitHub search syntax (author:x, label:"y") is used
// as is; anything else goes to the chat, which turns it into qualifiers using the user's memory.
const looksLikeQuery = text => /(^|\s)-?[a-z][a-z-]*:\S/i.test(text);
function findSourceParams() {
	const src = ui.findSource || 'bugs';
	const area = ui.findArea || ui.state.areas?.find(a => a.labels?.length)?.id || '';
	return `source=${src}${src === 'area' ? `&area=${encodeURIComponent(area)}` : ''}`;
}
function findQueryString() {
	return `${findSourceParams()}${ui.findRefine ? `&refine=${encodeURIComponent(ui.findRefine.query)}` : ''}`;
}
async function loadFindWork(fresh = false) {
	const q = findQueryString();
	ui.find = { q, loading: true, items: ui.find?.q === q ? ui.find.items : null };
	if (ui.selected?.kind === 'worksrc') renderDetail(false, true);
	try { ui.find = { q, items: (await api(`/api/work-source?${q}${fresh ? '&fresh=1' : ''}`)).items }; }
	catch (error) { ui.find = { q, error: error.message }; }
	if (ui.selected?.kind === 'worksrc') renderDetail(false, true);
}
function setFindRefine(refine) {
	ui.findRefine = refine;
	ui.findAsking = null;
	ui.findFilter = refine?.text || refine?.query || '';
	if (ui.selected?.kind === 'worksrc') renderDetail(false, true);
	else select('worksrc', 'find').then(() => renderAreaBar());
}
async function applyFindFilter(text) {
	if (!text) { setFindRefine(null); return; }
	if (looksLikeQuery(text)) { setFindRefine({ query: text }); return; }
	ui.findAsking = text;
	renderDetail(false, true);
	try { await api('/api/browse-ask', { text, ...Object.fromEntries(new URLSearchParams(findSourceParams())) }); }
	catch (error) { ui.findAsking = null; renderDetail(false, true); toast(`Could not ask the chat: ${error.message}`, true); }
}
function renderFindWorkInto(el) {
	const src = ui.findSource || 'bugs';
	const areas = (ui.state.areas || []).filter(a => a.labels?.length);
	const area = ui.findArea || areas[0]?.id || '';
	const q = findQueryString();
	if (ui.find?.q !== q && !ui.find?.loading) setTimeout(loadFindWork);
	const filter = ui.findRefine;
	const items = ui.find?.q === q ? ui.find.items || [] : [];
	const cur = ui.work?.data?.milestones?.find(m => m.role === 'current');
	const nxt = ui.work?.data?.milestones?.find(m => m.role === 'next');
	const tips = { bugs: 'My open bugs', features: 'My open feature requests', area: 'My open issues in a feature area', reviews: 'Open PRs that request my review', mine: 'All my open issues' };
	const pills = FIND_SOURCES.map(([id, label, icon]) => `<button type="button" class="seg-btn${src === id ? ' on' : ''}" data-find-src="${id}" aria-pressed="${src === id}" title="${esc(tips[id])}"><i class="codicon codicon-${icon}" aria-hidden="true"></i>${esc(label)}</button>`).join('');
	const areaSel = src === 'area' ? `<label class="sr-only" for="find-area">Feature area</label><select id="find-area" class="find-area">${areas.map(a => `<option value="${esc(a.id)}"${a.id === area ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` : '';
	const row = i => {
		const has = inMyWork(i.key);
		const isBug = i.labels.includes('bug');
		const icon = i.isPr ? 'git-pull-request' : isBug ? 'bug' : i.labels.includes('feature-request') ? 'lightbulb' : 'issue-opened';
		const chips = i.labels.filter(l => !['bug', 'feature-request'].includes(l)).slice(0, 2).map(l => `<span class="chip">${esc(l)}</span>`).join('');
		const add = (b, label, title) => `<button type="button" class="find-btn" data-act="issue-move" data-key="${esc(i.key)}" data-milestone="${b}" title="${esc(title)}">${esc(label)}</button>`;
		return `<li class="find-row${has ? ' has' : ''}"${has ? '' : ` draggable="true" data-new-issue="${esc(i.key)}"`}>
			<span class="find-grip" aria-hidden="true">${has ? '' : '<i class="codicon codicon-gripper"></i>'}</span>
			<i class="codicon codicon-${icon} find-icon${isBug ? ' bug' : i.isPr ? ' pr' : ''}" aria-hidden="true"></i>
			<div class="find-main">
				<button type="button" class="find-title" data-browse-open="${esc(i.key)}" title="Open ${esc(shortKey(i.key))} here">${esc(i.title)}</button>
				<div class="find-meta"><span class="find-num">${esc(shortKey(i.key))}</span>${i.isPr ? `<span>@${esc(i.author)}</span>` : ''}${i.milestone ? `<span>${esc(i.milestone)}</span>` : ''}${chips}<span class="find-age">${esc(ago(i.updatedAt))}</span></div>
			</div>
			<div class="find-add">${has ? '<span class="find-in"><i class="codicon codicon-pass-filled" aria-hidden="true"></i>In My Work</span>'
				: `${add('current', `+ ${cur?.title || 'Current'}`, `Add to ${cur?.title || 'current'} (local)`)}${add('next', 'Next', `Add to ${nxt?.title || 'next'} (local)`)}${add('priorities', 'Priorities', 'Add to the end of My priorities')}`}</div>
		</li>`;
	};
	const queryBar = filter ? `<div class="find-query">
				<span class="find-query-label cd">Filter</span><label class="sr-only" for="find-query">Filter as GitHub search qualifiers</label><input id="find-query" type="text" spellcheck="false" value="${esc(filter.query)}" title="Added to this list's GitHub search. Edit and press Enter to apply.">
				<button type="button" class="link-btn" data-find-query-clear title="Clear the filter"><i class="codicon codicon-close" aria-hidden="true"></i></button>
				${filter.note ? `<div class="find-query-note cd">${esc(filter.note)}</div>` : ''}
			</div>` : '';
	const asking = ui.findAsking ? `<p class="cd find-asking"><i class="codicon codicon-loading spin" aria-hidden="true"></i> Asking the chat to turn “${esc(ui.findAsking)}” into a GitHub search… <button type="button" class="link-btn" data-find-ask-cancel>Cancel</button></p>` : '';
	el.innerHTML = `<div class="detail-head">${titleBarHtml({ title: 'Browse issues & PRs', meta: '<div class="meta"><span class="cd">Live from GitHub (org:microsoft, newest first). Type a filter and press Enter: GitHub syntax or plain words (e.g. “created by alexdima”). Click a title to open it here, drag a row into a group on the left, or use its buttons. Added locally: GitHub milestones stay unchanged.</span></div>' })}</div>
		<div class="detail-body find-view">
			<div class="find-tools">
				<div class="seg" role="group" aria-label="Source">${pills}</div>${areaSel}
				<div class="find-search"><i class="codicon codicon-search" aria-hidden="true"></i><label class="sr-only" for="find-filter">Filter, press Enter to apply</label><input id="find-filter" type="search" placeholder="Filter, press Enter to apply (e.g. created by alexdima)" value="${esc(ui.findFilter || '')}"></div>
			</div>
			${queryBar}${asking}
			${ui.find?.error ? `<p class="cd" style="color:var(--bad)">${esc(ui.find.error)}</p>` : ui.find?.loading && !items.length ? '<p class="cd"><i class="codicon codicon-loading spin" aria-hidden="true"></i> Searching GitHub…</p>'
				: `<p class="find-count">${items.length}${items.length >= 100 ? '+' : ''} ${src === 'reviews' ? (items.length === 1 ? 'pull request' : 'pull requests') : (items.length === 1 ? 'issue' : 'issues')}${filter ? ' matching' : ''} · ${items.filter(i => inMyWork(i.key)).length} already in My Work</p><ul class="find-list">${items.map(row).join('')}</ul>`}
		</div>`;

}

// An issue or PR opened from Browse: the normal issue view (discussion, Start session, planning) plus a way back.
async function renderBrowseItemInto(el, key, fetchDetail, silent) {
	const item = flatItems().find(i => i.kind === 'work' && i.id === key);
	const found = (ui.find?.items || []).find(i => i.key === key);
	await renderIssueInto(el, key, fetchDetail, false, silent, { work: item || { milestone: { title: found?.milestone || null } }, browse: true });
	if (ui.selected?.kind !== 'browseitem' || ui.selected.id !== key) return;
	el.querySelector('.detail-head')?.insertAdjacentHTML('afterbegin', '<button type="button" class="link-btn browse-back" data-browse-back><i class="codicon codicon-arrow-left" aria-hidden="true"></i>Back to results</button>');
	hydrateGitHub();
}

// The My Work chat, docked at the bottom of the My Work list. Messages go to the nested "My Work chat".
function renderWorkChat() {
	const box = $('workchat');
	if (ui.tab !== 'work') { box.hidden = true; box.innerHTML = ''; return; }
	box.hidden = false;
	const ta = box.querySelector('.ask-input');
	const keep = ta ? { value: ta.value, focused: document.activeElement === ta, start: ta.selectionStart, end: ta.selectionEnd } : null;
	const link = ui.work?.data?.myWorkChat;
	box.innerHTML = `<div class="wc-head"><i class="codicon codicon-comment-discussion" aria-hidden="true"></i><span>My Work chat</span>${link ? `<button type="button" class="link-btn" data-open-session="${esc(link)}" title="Open the nested My Work chat">Open chat</button>` : '<span class="cd">· created with your first message</span>'}</div>${threadHtml('my-work', 'My Work')}`;
	box.querySelector('.dock-resize')?.remove();
	box.querySelector('.thread')?.classList.remove('collapsed');
	box.classList.toggle('collapsed', !!ui.workChatCollapsed);
	const t = box.querySelector('.ask-input');
	if (t) {
		t.placeholder = 'Paste #123, an issue / IcM / session link, or ask: "add the session I\'m in"';
		t.setAttribute('aria-label', 'Message to the My Work chat');
		if (keep) { t.value = keep.value; autoGrow(t); if (keep.focused) { t.focus(); t.setSelectionRange(keep.start, keep.end); } }
	}
	const b = box.querySelector('.bubbles');
	if (b) { b.style.height = ''; b.scrollTop = b.scrollHeight; }
}
function renderPinnedSessionInto(el, id) {
	const link = `agent-host-session://ahp-session/${id}`;
	const p = (ui.work?.data?.pinnedSessions || []).find(x => x.id === id);
	if (!p) {
		const z = (ui.work?.data?.recentSessions || []).find(x => x.id === id);
		if (!z) { el.innerHTML = '<div class="empty">This session is no longer active.</div>'; return; }
		const meta = `<div class="meta">${z.project ? `<span>${esc(z.project)}</span><span class="sep">·</span>` : ''}<span class="cd">not in My Work yet</span></div>`;
		el.innerHTML = `<div class="detail-head">${titleBarHtml({ title: z.title || 'Session', meta, primary: { act: 'pin-session', key: id, label: 'Add to My Work', icon: 'add' }, menu: [{ act: 'open-session', link, label: 'Open session' }, { act: 'hide-session', key: id, label: 'Hide from Active sessions' }] })}</div>
			<div class="detail-body">${sessionInsightsHtml(id, false)}${sessionsHtml([{ ...z, link }], 'Session')}</div>`;
		return;
	}
	const z = p.session;
	const meta = `<div class="meta">${z?.info?.repo || z?.project ? `<span>${esc(z.info?.repo || z.project)}</span><span class="sep">·</span>` : ''}<span class="cd">added ${esc(agoText(p.addedAt))}</span>${p.note ? `<span class="sep">·</span><span>${esc(p.note)}</span>` : ''}</div>`;
	const pending = p.summaryRequestedAt && !p.summary && Date.now() - Date.parse(p.summaryRequestedAt) < 15 * 60 * 1000;
	const about = p.summary
		? `<section class="linked dcard"><div class="linked-head"><span class="section-label">What it is doing</span><span class="cd">· ${esc(agoText(p.summaryAt))}</span><button type="button" class="link-btn" data-act="describe-session" data-key="${esc(id)}" style="margin-left:auto">Refresh</button></div><div class="md" style="padding:4px 12px 10px">${renderMarkdown(p.summary)}</div></section>`
		: `<section class="linked dcard"><div class="linked-head"><span class="section-label">What it is doing</span></div><p class="cd" style="padding:4px 12px 10px">${pending ? '<i class="codicon codicon-loading spin" aria-hidden="true"></i> The My Work chat is reading the session…' : `No summary yet. <button type="button" class="link-btn" data-act="describe-session" data-key="${esc(id)}">Ask the My Work chat</button>`}</p></section>`;
	const i = z?.info || {};
	const fact = (label, value) => value ? `<div class="kv"><span class="cd">${esc(label)}</span><span>${value}</span></div>` : '';
	const facts = z ? `<section class="linked dcard"><div class="linked-head"><span class="section-label">Session</span></div><div class="kvs">
		${fact('Branch', z.branch ? `<code>${esc(z.branch)}</code>${i.baseBranch ? ` <span class="cd">from ${esc(i.baseBranch)}</span>` : ''}` : '')}
		${fact('Changes', z.changes ? `<span class="add">+${esc(z.changes.additions)}</span> <span class="del">−${esc(z.changes.deletions)}</span> <span class="cd">in ${esc(z.changes.files)} file${z.changes.files === 1 ? '' : 's'}</span>` : '')}
		${fact('Git', i.outgoing != null || i.uncommitted != null ? esc([i.outgoing ? `${i.outgoing} unpushed commit${i.outgoing === 1 ? '' : 's'}` : '', i.uncommitted ? `${i.uncommitted} uncommitted file${i.uncommitted === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') || 'clean') : '')}
		${fact('Pull requests', (z.prs || []).map(pr => `<a href="${esc(safeUrl(pr.url))}" target="_blank" rel="noopener">${esc(pr.label)}</a>`).join(' · '))}
		${fact('Chats', (i.chats || []).length > 1 ? esc(i.chats.join(' · ')) : '')}
		${fact('Last active', z.modified ? esc(agoText(new Date(z.modified).toISOString())) : '')}
		${fact('Folder', i.workingDirectory ? `<code>${esc(i.workingDirectory.replace(/^\/Users\/[^/]+/, '~'))}</code>` : '')}
	</div></section>` : '';
	const moves = ['current', 'next', 'priorities'].filter(b => b !== (p.bucket || 'current')).map(b => ({ act: 'sess-move', key: id, milestone: b, label: `Move to ${groupLabel(b)}` }));
	el.innerHTML = `<div class="detail-head">${titleBarHtml({ title: z?.title || p.note || 'Session', meta, primary: { act: 'open-session', link, label: 'Open session', icon: 'comment-discussion' }, menu: [...moves, { act: 'unpin-session', key: id, label: 'Remove from My Work' }] })}</div>
		<div class="detail-body">${sessionInsightsHtml(id, true)}${p.summary ? about : ''}${z ? facts : '<p class="cd" style="padding:12px">This session is not in the Agents window\'s session store anymore.</p>'}
			<p class="cd" style="padding:0 12px">In ${esc(groupLabel(p.bucket || 'current'))}. Drag it to another group or use the menu; marking the session done (archiving it) removes it from My Work.</p></div>`;
}
// Session insights read from its local transcript (what it was asked, its latest reply, files, activity).
async function loadSessionInfo(id) {
	const cur = ui.sessInfo?.[id];
	if (cur?.loading) return;
	ui.sessInfo ??= {};
	ui.sessInfo[id] = { ...(cur || {}), loading: true };
	try { ui.sessInfo[id] = { data: await api(`/api/session-info?id=${encodeURIComponent(id)}`), at: Date.now() }; }
	catch (error) { ui.sessInfo[id] = { error: error.message, at: Date.now() }; }
	if ((ui.selected?.id === id && (ui.selected.kind === 'pinsess' || ui.selected.kind === 'recentsess')) || document.querySelector('#detail .sess-row')) renderDetail(false, true);
}
function sessionInsightsHtml(id, pinned) {
	const st = ui.sessInfo?.[id];
	if (!st || (!st.data && !st.error) || Date.now() - (st.at || 0) > 30_000) setTimeout(() => loadSessionInfo(id));
	if (!st?.data) return st?.error ? `<p class="cd" style="padding:0 12px">Couldn't read the session: ${esc(st.error)}</p>` : '<p class="cd" style="padding:0 12px"><i class="codicon codicon-loading spin" aria-hidden="true"></i> Reading the session…</p>';
	const { transcript: t, issue } = st.data;
	const banner = pinned && issue ? `<div class="triage-card t-info"><div class="tc-head"><i class="codicon codicon-info" aria-hidden="true"></i>Works on ${esc(shortKey(issue.key))}<span class="tag">from its ${esc(issue.via)}</span></div>
		<p>${esc(issue.title)}</p><p><button type="button" class="btn sm" data-act="session-to-issue" data-key="${esc(id)}" data-issue="${esc(issue.key)}">Show the issue instead</button> <span class="cd">The session stays linked to it.</span></p></div>` : '';
	if (!t) return `${banner}<p class="cd" style="padding:0 12px">No conversation found for this session on this machine.</p>`;
	const status = `<div class="sess-status cd">${t.working ? '<span class="tag acc"><i class="codicon codicon-loading spin" aria-hidden="true"></i>working now</span>' : `<span>idle since ${esc(agoText(t.lastAt))}</span>`}
		${t.model ? `<span>· ${esc(t.model)}</span>` : ''}<span>· ${t.turns} turns · ${t.tools} tool calls${t.subagents ? ` · ${t.subagents} subagent${t.subagents === 1 ? '' : 's'}` : ''}</span>
		${t.skills?.length ? `<span class="sess-skills">${t.skills.map(k => `<span class="tag">${esc(k)}</span>`).join('')}</span>` : ''}</div>`;
	const latest = t.latest ? `<section class="linked dcard"><div class="linked-head"><span class="section-label">Latest reply</span><span class="cd">· ${esc(agoText(t.latest.at))}</span></div>
		<div class="md sess-latest">${renderMarkdown(t.latest.text)}</div></section>` : '';
	const req = (r, i) => `<details class="sess-req"${i === 0 ? ' open' : ''}><summary><span class="cd">${esc(agoText(r.at))}${r.auto ? ' · sent by the agent' : i === 0 ? ' · first request' : ''}</span> ${esc(r.text.split('\n')[0].slice(0, 140))}</summary><div class="sess-req-body">${esc(r.text)}${r.text.length >= 1500 ? '…' : ''}</div></details>`;
	const requests = t.requests?.length ? `<section class="linked dcard"><div class="linked-head"><span class="section-label">Requests · ${t.requestCount}</span></div>${t.requests.map(req).join('')}</section>` : '';
	const files = t.edits?.length ? `<section class="linked dcard"><div class="linked-head"><span class="section-label">Files edited · ${t.edits.length}</span></div><ul class="sess-files">${t.edits.map(f => `<li><code>${esc(f.path)}</code>${f.type !== 'edit' ? ` <span class="tag">${esc(f.type)}</span>` : ''}</li>`).join('')}</ul></section>` : '';
	const cps = t.checkpoints?.length ? `<section class="linked dcard"><div class="linked-head"><span class="section-label">Checkpoints</span></div><ol class="sess-files">${t.checkpoints.map(c => `<li>${esc(c.title)}</li>`).join('')}</ol></section>` : '';
	return `${banner}${status}${latest}${requests}${files}${cps}`;
}
function parseSessionRef(text) {
	const m = String(text || '').trim().match(/^agent-host-session:\/\/[\w-]+\/([\w-]{8,80})/);
	return m ? m[1] : null;
}
function parseIncident(text) {
	const t = String(text || '').trim();
	const m = t.match(/incidents?\/(?:details\/)?(\d{5,20})/i) || t.match(/^icm\s*#?(\d{5,20})$/i);
	return m ? { incidentId: m[1], link: /^https:\/\//.test(t) ? t : '' } : null;
}

async function updatePriority(key, op, to) {
	const r = await api('/api/priorities', { op, key, ...(to !== undefined ? { to } : {}) });
	if (ui.work?.data) ui.work.data.priorityKeys = r.priorities;
	await loadWork();
}

// Accepts "#123", "123", "owner/repo#123" or a GitHub issue/PR URL.
function parseIssueRef(text) {
	const t = String(text || '').trim();
	let m = t.match(/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)/);
	if (m) return `${m[1]}#${m[2]}`;
	if ((m = t.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/))) return `${m[1]}#${m[2]}`;
	if ((m = t.match(/^#?(\d+)$/))) return `microsoft/vscode#${m[1]}`;
	return null;
}

async function loadWork(fresh = false) {
	ui.work = { ...(ui.work || {}), loading: true, error: null };
	if (ui.tab === 'work') { renderAreaBar(); renderBatchBar(); }
	try {
		ui.work = { data: await api(`/api/work${fresh ? '?fresh=1' : ''}`), loading: false };
	} catch (error) { ui.work = { ...ui.work, loading: false, error: error.message }; }
	if (ui.state) render();
}

// ---------- actions ----------
// Select the next unfinished item after the current one. `before` is the list as it was before a
// reload, so the position is kept even when the finished item has dropped out of the list.
function advance(before) {
	const items = flatItems();
	const same = i => i.kind === ui.selected?.kind && i.id === ui.selected?.id;
	let idx = items.findIndex(same);
	if (idx < 0 && before) {
		const later = before.slice(before.findIndex(same) + 1);
		idx = later.map(b => items.findIndex(i => i.kind === b.kind && i.id === b.id)).find(x => x >= 0) ?? items.length;
		idx -= 1;
	}
	const next = [...items.slice(idx + 1), ...items.slice(0, Math.max(idx + 1, 0))].find(i => !isHandled(i) && !same(i));
	if (next) select(next.kind, next.id);
	else { ui.selected = null; $('detail').innerHTML = '<div class="empty"><i class="codicon codicon-check-all" aria-hidden="true"></i>Batch done. Click <b>Next</b> for more.</div>'; renderList(); }
}

async function act(button) {
	const act = button.dataset.act;
	const key = button.dataset.key;
	if (act === 'recheck') { loadChecks(key, true); return; }
	if (act === 'msrc-item-edit') { closeMenus(); ui.msrcEditing = key; renderDetail(false); return; }
	if (act === 'cancel-opinion') {
		try { await api('/api/cancel-opinion', { key, mode: button.dataset.mode || 'blind' }); toast('Judgement request cancelled'); await load(); } catch (error) { toast(error.message, true); }
		return;
	}
	if (ui.busy) return;
	const id = ui.selected?.kind === 'notification' ? ui.selected.id : undefined;
	ui.busy = true;
	document.querySelectorAll('.title-actions .btn, .menu button, .toolbar .btn, [data-act="opinion"]').forEach(b => { b.disabled = true; });
	toast('Working…');
	let move = true;
	const before = flatItems();
	try {
		let msg;
		if (act === 'apply') {
			const comment = document.getElementById('comment')?.value ?? '';
			const r = await api('/api/apply', { key, comment, group: button.dataset.group });
			msg = `${shortKey(key)}: ${r.done.join(', ')}`;
		} else if (act === 'rejected' || act === 'deferred') {
			const note = act === 'rejected' ? 'kept open from triage board' : 'deferred from triage board';
			await api('/api/record', { key, decision: act, note });
			msg = `${shortKey(key)}: ${act === 'rejected' ? 'kept open' : 'deferred'}`;
		} else if (act === 'skip-issue') {
			await api('/api/skip-issue', { key });
			msg = `${shortKey(key)}: skipped`;
		} else if (act === 'dismiss' || act === 'done') {
			await api('/api/dismiss', { id, unsubscribe: act === 'done' });
			msg = act === 'done' ? 'Done and unsubscribed' : 'Dismissed';
		} else if (act === 'route-one') {
			const r = await api('/api/route-many', { ids: [id] });
			if (r.failed.length) throw new Error(`Routing failed: ${r.failed[0].error}`);
			const to = r.results[0]?.to || [];
			msg = to.length ? `Routed to ${to.map(l => `@${l}`).join(', ')} and dismissed` : 'Unassigned and dismissed';
		} else if (act === 'dismiss-selected' || act === 'route-selected') {
			const routing = act === 'route-selected';
			const ids = ui.notifFilter
				? bulkItems(ui.notifFilter).map(n => n.id).filter(id => !ui.unchecked?.has(id))
				: [...ui.picked];
			if (!ids.length) throw new Error('Nothing selected');
			const run = ui.bulkRun = { ids, done: new Set(), failed: new Set(), errors: [], verb: routing ? 'Routing' : 'Dismissing' };
			const sync = () => { renderBatchBar(); renderList(); if (!ui.notifFilter) toast(`${run.verb}… ${run.done.size + run.failed.size}/${ids.length}`); };
			sync();
			try {
				const step = routing ? 3 : 4;
				for (let i = 0; i < ids.length; i += step) {
					const r = await api(routing ? '/api/route-many' : '/api/dismiss-many', { ids: ids.slice(i, i + step) });
					r.done.forEach(id => run.done.add(id));
					r.failed.forEach(f => { run.failed.add(f.id); run.errors.push(f.error); });
					sync();
				}
			} finally {
				ui.bulkRun = null;
			}
			msg = `${routing ? 'Routed and dismissed' : 'Dismissed'} ${run.done.size}${run.failed.size ? ` · ${run.failed.size} failed (still selected)${run.errors[0] ? `: ${run.errors[0]}` : ''}` : ''}`;
			ui.unchecked = new Set(ui.notifFilter ? bulkItems(ui.notifFilter).map(n => n.id).filter(id => !run.failed.has(id)) : []);
			ui.picked = new Set(ui.notifFilter ? [] : run.failed);
			move = !!(ui.selected && ids.includes(ui.selected.id) && !ui.picked.has(ui.selected.id));
		} else if (act === 'skip-notification') {
			await api('/api/skip-notification', { id });
			msg = 'Skipped';
		} else if (act === 'opinion') {
			const informed = button.dataset.mode === 'informed';
			await api('/api/ask', { kind: 'opinion', keys: [key], mode: informed ? 'informed' : 'blind' });
			ui.asked[key] = true;
			msg = informed ? 'Starting a re-judge chat with Sweeper\'s evidence' : 'Starting a separate judge chat';
			move = false;
		} else if (act === 'implement') {
			await api('/api/ask', { kind: 'implement', key });
			msg = 'Asked the chat to start a fix session';
		} else if (act === 'open-session') {
			await api('/api/open-session', { link: button.dataset.link });
			msg = 'Opening the session in the Agents window';
			move = false;
		} else if (act === 'work-session' || act === 'work-session-new') {
			const w = ui.work?.data?.milestones.flatMap(m => m.items.map(i => ({ ...i, milestone: m.title }))).find(i => i.key === key);
			const d = ui.selected?.detail?.issue?.key === key ? ui.selected.detail.issue : null;
			const r = await api('/api/work-session', { key, another: act === 'work-session-new', title: w?.title || d?.title || ui.gh?.[key]?.data?.title || '', url: w?.url || d?.url || `https://github.com/${key.split('#')[0]}/issues/${key.split('#')[1]}`, milestone: w?.milestone || '' });
			msg = r.via === 'issue-chat' ? `Starting work in the ${shortKey(key)} chat: confirm the workspace there` : `Asked the chat to start a session for ${shortKey(key)}`;
			move = false;
		} else if (act === 'sess-move') {
			await api('/api/work-pin', { op: 'move', id: key, bucket: button.dataset.milestone, ...(button.dataset.milestone === 'priorities' ? { to: 'top' } : {}) });
			msg = `Moved to ${groupLabel(button.dataset.milestone)}`;
			move = false;
			await loadWork();
		} else if (act === 'hide-session') {
			await api('/api/work-pin', { op: 'hide', id: key });
			msg = 'Hidden from Active sessions';
			move = false;
			if (ui.selected?.id === key) { ui.selected = null; $('detail').innerHTML = '<div class="empty">Select an item to see details and actions.</div>'; }
			await loadWork();
		} else if (act === 'issue-move' || act === 'issue-unpin') {
			await api('/api/work-issue', act === 'issue-move' ? { op: 'move', key, bucket: button.dataset.milestone } : { op: 'remove', key });
			msg = act === 'issue-move' ? `${shortKey(key)} → ${groupLabel(button.dataset.milestone)}` : `${shortKey(key)} removed from My Work`;
			move = false;
			if (act === 'issue-unpin') { ui.selected = null; $('detail').innerHTML = '<div class="empty">Select an item to see details and actions.</div>'; }
			await loadWork();
		} else if (act === 'session-to-issue') {
			const issue = button.dataset.issue;
			await api('/api/work-pin', { op: 'to-issue', id: key, key: issue });
			msg = `Showing ${shortKey(issue)} instead; the session stays linked`;
			move = false;
			ui.selected = { kind: 'work', id: issue, detail: null };
			await loadWork();
		} else if (act === 'describe-session') {
			await api('/api/describe-session', { id: key });
			msg = 'Asked the My Work chat to describe this session';
			move = false;
			await loadWork();
		} else if (act === 'pin-session' || act === 'unpin-session') {
			const r = await api('/api/work-pin', { op: act === 'pin-session' ? 'add' : 'remove', id: key });
			msg = act === 'pin-session' ? (r.issue ? `Added ${shortKey(r.issue)}: this session works on it (from its ${r.via})` : 'Session added; the My Work chat will describe what it is doing') : 'Session removed from My Work';
			move = false;
			if (act === 'pin-session') ui.selected = r.issue ? { kind: 'work', id: r.issue, detail: null } : { kind: 'pinsess', id: key, detail: null };
			if (act === 'unpin-session') { ui.selected = null; $('detail').innerHTML = '<div class="empty">Select an item to see details and actions.</div>'; }
			await loadWork();
		} else if (act === 'msrc-item-session') {
			await api('/api/msrc-item-session', { incidentId: key });
			msg = `Asked the chat to start a session for IcM ${key} (private repo)`;
			move = false;
		} else if (act === 'msrc-item-remove') {
			await api('/api/msrc-item', { op: 'remove', incidentId: key });
			msg = `IcM ${key} removed from My Work`;
			move = false;
			ui.selected = null;
			$('detail').innerHTML = '<div class="empty">Select an item to see details and actions.</div>';
			await loadWork();
		} else if (act.startsWith('prio-')) {
			const op = { 'prio-add': ['add'], 'prio-add-top': ['add', 'top'], 'prio-remove': ['remove'], 'prio-up': ['move', 'up'], 'prio-down': ['move', 'down'], 'prio-top': ['move', 'top'] }[act];
			await updatePriority(key, op[0], op[1]);
			msg = op[0] === 'add' ? `${shortKey(key)} added to your priorities` : op[0] === 'remove' ? `${shortKey(key)} removed from your priorities` : '';
			move = false;
		} else if (act === 'move-milestone') {
			const title = button.dataset.milestone;
			await api('/api/move-milestone', { key, title: title === 'none' ? null : title });
			if (title === 'none') {
				// Untriaged: it leaves My Work entirely (also from My priorities) until it's found again.
				await api('/api/work-issue', { op: 'remove', key }).catch(() => { });
				msg = `${shortKey(key)} is untriaged (milestone removed on GitHub)`;
				if (ui.selected?.id === key && ui.selected.kind === 'work') { ui.selected = null; $('detail').innerHTML = '<div class="empty">Select an item to see details and actions.</div>'; }
			} else {
				msg = `${shortKey(key)} → ${title}`;
			}
			move = false;
			await loadWork(true);
		} else if (act === 'route-issue') {
			const r = await api('/api/route-issues', { keys: [key] });
			if (r.failed.length) throw new Error(`Routing failed: ${r.failed[0].error}`);
			const to = r.results[0]?.to || [];
			msg = to.length ? `${shortKey(key)}: routed to ${to.map(l => `@${l}`).join(', ')}` : `${shortKey(key)}: unassigned you`;
		} else if (act === 'route-issues') {
			ui.confirmRoute = false;
			clearTimeout(ui.confirmRouteTimer);
			const ids = routeItems().filter(x => !isHandled(x)).map(x => x.id);
			if (!ids.length) throw new Error('Nothing to route');
			const run = ui.bulkRun = { ids, done: new Set(), failed: new Set(), errors: [], verb: 'Routing' };
			const sync = () => { renderBatchBar(); renderList(); };
			sync();
			try {
				for (let i = 0; i < ids.length; i += 3) {
					const r = await api('/api/route-issues', { keys: ids.slice(i, i + 3) });
					r.done.forEach(k => run.done.add(k));
					r.failed.forEach(f => { run.failed.add(f.key); run.errors.push(f.error); });
					sync();
				}
			} finally { ui.bulkRun = null; }
			msg = `Routed ${run.done.size}${run.failed.size ? ` · ${run.failed.size} failed${run.errors[0] ? `: ${run.errors[0]}` : ''}` : ''}`;
			move = false;
		} else if (act === 'issue-investigate') {
			await api('/api/ask', { kind: 'issue-investigate', key });
			msg = 'Asked the chat to start an investigation chat';
			move = false;
		} else if (act === 'notification-start' || act === 'notification-investigate') {
			const starting = act === 'notification-start';
			await api('/api/ask', { kind: starting ? 'notification-start' : 'notification-investigate', id });
			msg = starting ? 'Asked the chat to start a fix / implementation session' : 'Asked the chat to investigate this issue';
			move = false;
		}
		toast(`✓ ${msg}`);
		await load();
		if (move) advance(before);
	} catch (error) {
		toast(error.message, true);
		document.querySelectorAll('.title-actions .btn, .menu button, .toolbar .btn, [data-act="opinion"]').forEach(b => { b.disabled = false; });
	} finally {
		ui.busy = false;
	}
}

// ---------- events ----------
function switchTab(tab) {
	ui.tab = tab;
	ui.notifFilter = null;
	ui.routeFilter = false;
	ui.picked = new Set();
	ui.selected = null;
	$('detail').innerHTML = '<div class="empty">Select an item to see details and actions.</div>';
	render();
}
document.querySelector('.rail-nav').addEventListener('click', e => {
	const b = e.target.closest('button[data-tab]');
	if (b) switchTab(b.dataset.tab);
});
document.querySelector('.rail-nav').addEventListener('keydown', e => {
	if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
	e.preventDefault();
	const tabs = [...document.querySelectorAll('.rail-nav button')];
	const i = tabs.findIndex(t => t.dataset.tab === ui.tab);
	const next = tabs[(i + (e.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length];
	switchTab(next.dataset.tab);
	next.focus();
});
$('areabar').addEventListener('change', e => {
	if (e.target.id === 'area-filter') setAreaFilter(e.target.value);
});
$('areabar').addEventListener('click', e => {
	if (e.target.closest('#area-clear')) setAreaFilter('');
	if (e.target.closest('[data-pick-session]')) { select('workhome', 'home'); return; }
	if (e.target.closest('[data-find-work]')) {
		if (['worksrc', 'browseitem'].includes(ui.selected?.kind)) { ui.selected = null; $('detail').innerHTML = '<div class="empty">Select an item to see details and actions.</div>'; render(); return; }
		select('worksrc', 'find').then(() => { renderAreaBar(); $('detail').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
		return;
	}
	if (e.target.closest('[data-list-refresh]') && !ui.refreshing) refreshNow();
});
$('subtabs').addEventListener('click', e => {
	if (e.target.closest('[data-route-filter]')) {
		ui.routeFilter = !ui.routeFilter;
		ui.confirmRoute = false;
		ui.selected = null;
		$('detail').innerHTML = '<div class="empty">Select an item to see details and actions.</div>';
		render();
		return;
	}
	const rb = e.target.closest('button[data-rules]');
	if (rb) {
		rb.disabled = true;
		const keys = (ui.routeFilter ? routeItems() : flatItems()).filter(x => x.kind === 'issue' && !isHandled(x)).map(x => x.id).slice(0, 30);
		requestRules(keys, true, 'Asked the chat to re-check your rules on');
		return;
	}
});
$('subtabs').addEventListener('click', e => {
	const cls = e.target.closest('button[data-classify]');
	if (cls) {
		cls.disabled = true;
		const recompute = cls.dataset.classify === 'recompute';
		requestClassify(recompute ? { recompute: true, count: 50 } : { count: 50 }, recompute ? 'Asked the chat to re-check' : 'Asked the chat to classify');
		return;
	}
	const bulk = e.target.closest('button[data-bulk]');
	if (bulk) {
		ui.notifFilter = ui.notifFilter === bulk.dataset.bulk ? null : bulk.dataset.bulk;
		ui.unchecked = new Set();
		ui.picked = new Set();
		ui.selected = null;
		$('detail').innerHTML = '<div class="empty">Select a notification to see why it can be dismissed.</div>';
		render();
		return;
	}
	const b = e.target.closest('button[data-sub]');
	if (!b) return;
	ui.sub[ui.tab] = b.dataset.sub;
	ui.routeFilter = false;
	ui.selected = null;
	$('detail').innerHTML = '<div class="empty">Select an item to see details and actions.</div>';
	render();
});
$('batchbar').addEventListener('click', async e => {
	const go = e.target.closest('[data-act="dismiss-selected"], [data-act="route-selected"], [data-act="route-issues"]');
	if (go?.dataset.act === 'route-issues' && !ui.confirmRoute) {
		// First click arms it; a second click within 6s routes everything listed.
		ui.confirmRoute = true;
		renderBatchBar();
		clearTimeout(ui.confirmRouteTimer);
		ui.confirmRouteTimer = setTimeout(() => { ui.confirmRoute = false; renderBatchBar(); }, 6000);
		return;
	}
	if (go) { act(go); return; }
	if (e.target.closest('#pick-clear')) { ui.picked = new Set(); renderBatchBar(); renderList(); return; }
	const more = e.target.closest('#triage-more');
	if (more) {
		more.disabled = true;
		try {
			const r = await api('/api/triage-more', { count: 25 });
			toast(r.sent ? `Asked the chat to triage ${r.count} more notifications` : 'Every notification is already triaged');
			await load();
		} catch (error) { toast(error.message, true); more.disabled = false; }
		return;
	}
	if (e.target.closest('#judge-batch')) {
		const st = ui.state;
		const handled = new Set(st.cleanup[ui.sub.cleanup].items.filter(i => i.handled).map(i => i.key));
		const busy = k => st.opinionPending?.[k] && !st.opinionPending[k].stalled && !st.opinionPending[k].failed;
		const keys = batchIds(batchKey()).filter(k => !handled.has(k) && !st.opinions[k] && !busy(k));
		if (!keys.length) { toast('Everything in this batch is already judged or being judged'); return; }
		try {
			await api('/api/ask', { kind: 'opinion', keys });
			keys.forEach(k => { ui.asked[k] = true; });
			toast(`Starting a judge chat for ${keys.length} issue${keys.length > 1 ? 's' : ''}`);
			await load();
		} catch (error) { toast(error.message, true); }
		return;
	}
	if (!e.target.closest('#next-batch')) return;
	try {
		const r = await api('/api/next-batch', { tab: batchKey() });
		if (r?.triageRequested) toast(`Asked the chat to triage ${r.triageRequested} notification${r.triageRequested > 1 ? 's' : ''} in this batch`);
		ui.selected = null;
		$('detail').innerHTML = '<div class="empty">Select an item to see details and actions.</div>';
		await load();
	} catch (error) { toast(error.message, true); }
});
function syncBulkBar() {
	renderBatchBar();
}
function pickableIds() {
	return flatItems().filter(i => i.kind === 'notification' && !isHandled(i)).map(i => i.id);
}
function setPicked(id, on) {
	if (on) ui.picked.add(id); else ui.picked.delete(id);
}
$('list').addEventListener('change', e => {
	const c = e.target.closest('.row-check');
	if (!c) return;
	if (ui.notifFilter) {
		ui.unchecked ??= new Set();
		if (c.checked) ui.unchecked.delete(c.dataset.id); else ui.unchecked.add(c.dataset.id);
		syncBulkBar();
		return;
	}
	const ids = pickableIds();
	const to = ids.indexOf(c.dataset.id);
	const from = ui.shiftPick ? ids.indexOf(ui.lastPick) : -1;
	if (from >= 0 && to >= 0) {
		ids.slice(Math.min(from, to), Math.max(from, to) + 1).forEach(id => setPicked(id, c.checked));
		document.querySelectorAll('.row-check').forEach(x => { x.checked = ui.picked.has(x.dataset.id); });
	} else {
		setPicked(c.dataset.id, c.checked);
	}
	ui.lastPick = c.dataset.id;
	ui.shiftPick = false;
	syncBulkBar();
});
$('batchbar').addEventListener('change', e => {
	if (e.target.id !== 'bulk-all') return;
	if (ui.notifFilter) {
		const ids = bulkItems(ui.notifFilter).map(n => n.id);
		ui.unchecked = e.target.checked ? new Set() : new Set(ids);
	} else {
		ui.picked = e.target.checked ? new Set(pickableIds()) : new Set();
		if (!ui.picked.size) { renderBatchBar(); renderList(); return; }
	}
	document.querySelectorAll('.row-check').forEach(c => { c.checked = e.target.checked; });
	syncBulkBar();
});
$('list').addEventListener('click', e => {
	if (e.target.closest('[data-done-toggle]')) { ui.showDone = !ui.showDone; renderList(); return; }
	if (e.target.closest('[data-group-toggle="recent"]')) { ui.state.settings.recentCollapsed = !ui.state.settings.recentCollapsed; renderList(); saveSettings({ recentCollapsed: ui.state.settings.recentCollapsed }); return; }
	if (e.target.closest('.row-check')) { ui.shiftPick = e.shiftKey; return; }
	const b = e.target.closest('.row');
	if (b) select(b.dataset.kind, b.dataset.id);
});
$('list').addEventListener('keydown', e => {
	if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
	const prioRow = e.altKey && e.target.closest?.('[data-prio]');
	if (prioRow) {
		e.preventDefault();
		const key = prioRow.dataset.prio;
		updatePriority(key, 'move', e.key === 'ArrowUp' ? 'up' : 'down')
			.then(() => document.querySelector(`[data-prio="${CSS.escape(key)}"]`)?.focus())
			.catch(error => toast(error.message, true));
		return;
	}
	const rows = [...document.querySelectorAll('.row')];
	const i = rows.indexOf(document.activeElement);
	const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
	if (next) { e.preventDefault(); next.focus(); }
});
// My priorities: drag rows to reorder.
// Drag: reorder My priorities (issues and sessions) and move pinned sessions between groups.
// Issues are not dragged into milestones (that would change GitHub); use Plan for… instead.
let drag = null;
const clearDrop = () => { for (const r of document.querySelectorAll('.drop-before, .drop-after, .drop-into')) r.classList.remove('drop-before', 'drop-after', 'drop-into'); };
function dropTarget(e) {
	const t = e.target.closest?.('[data-group], [data-drop-group]');
	if (!t || !drag) return null;
	const group = t.dataset.group || t.dataset.dropGroup;
	if (!['current', 'next', 'priorities'].includes(group)) return null;
	if (!drag.sess && !drag.pinIssue && group !== 'priorities') return null;
	return { el: t, group, row: t.matches('[data-prio]') ? t : null };
}
$('list').addEventListener('dragstart', e => {
	const row = e.target.closest?.('[data-prio], [data-sess], [data-pin-issue]');
	if (!row) return;
	drag = { prio: row.dataset.prio || null, sess: row.dataset.sess || null, pinIssue: row.dataset.pinIssue || null, from: row.dataset.group || null };
	e.dataTransfer.effectAllowed = 'move';
	e.dataTransfer.setData('text/plain', drag.prio || drag.sess);
	row.classList.add('dragging');
});
$('list').addEventListener('dragover', e => {
	const t = dropTarget(e);
	if (!t) return;
	e.preventDefault();
	clearDrop();
	if (t.row) t.row.classList.add(e.clientY > t.row.getBoundingClientRect().top + t.row.offsetHeight / 2 ? 'drop-after' : 'drop-before');
	else (t.el.matches('.row') ? document.querySelector(`[data-drop-group="${t.group}"]`) : t.el)?.classList.add('drop-into');
});
$('list').addEventListener('dragleave', e => { if (!e.relatedTarget || !$('list').contains(e.relatedTarget)) clearDrop(); });
$('list').addEventListener('drop', e => {
	const t = dropTarget(e);
	if (!t) return;
	e.preventDefault();
	const d = drag;
	let idx;
	if (t.group === 'priorities' && t.row) {
		const keys = (ui.work?.data?.priorityKeys || []).filter(k => k !== d.prio);
		idx = keys.indexOf(t.row.dataset.prio);
		if (idx >= 0 && t.row.classList.contains('drop-after')) idx++;
		if (idx < 0) idx = undefined;
	}
	clearDrop();
	const run = d.prio && t.group === 'priorities' && d.from === 'priorities'
		? updatePriority(d.prio, 'move', idx ?? 'top')
		: d.pinIssue && t.group !== d.from
			? api('/api/work-issue', { op: 'move', key: d.pinIssue, bucket: t.group, ...(t.group === 'priorities' ? { to: idx ?? 'top' } : {}) }).then(() => loadWork())
		: d.sess && (t.group !== d.from || t.group === 'priorities')
			? api('/api/work-pin', { op: 'move', id: d.sess, bucket: t.group, ...(t.group === 'priorities' ? { to: idx ?? 'top' } : {}) }).then(() => loadWork())
			: null;
	run?.then(() => { if ((d.sess || d.pinIssue) && t.group !== d.from) toast(`Moved to ${groupLabel(t.group)}`); }).catch(error => toast(error.message, true));
});
$('list').addEventListener('dragend', () => {
	drag = null;
	clearDrop();
	for (const r of document.querySelectorAll('.dragging')) r.classList.remove('dragging');
});
function groupLabel(role) {
	if (role === 'priorities') return 'My priorities';
	const m = ui.work?.data?.milestones?.find(x => x.role === role);
	return m ? `${m.title} (${role})` : role;
}
$('areabar').addEventListener('submit', async e => {
	const form = e.target.closest('[data-prio-add]');
	if (!form) return;
	e.preventDefault();
	const input = form.querySelector('input');
	const sid = parseSessionRef(input.value);
	if (sid) {
		try { await api('/api/work-pin', { op: 'add', id: sid }); input.value = ''; await loadWork(); select('pinsess', sid); toast('Session added to My Work'); } catch (error) { toast(error.message, true); }
		return;
	}
	const inc = parseIncident(input.value);
	if (inc) {
		input.value = '';
		const existing = (ui.work?.data?.msrcItems || []).some(x => x.incidentId === inc.incidentId);
		if (!existing) ui.msrcDraft = { incidentId: inc.incidentId, link: inc.link, addedAt: new Date().toISOString() };
		ui.msrcEditing = null;
		select('msrcitem', inc.incidentId);
		return;
	}
	const key = parseIssueRef(input.value);
	if (!key) { toast('Enter #123, owner/repo#123, an issue URL or an IcM link', true); return; }
	try {
		await updatePriority(key, 'add');
		toast(`${shortKey(key)} added to your priorities`);
		select('work', key);
		$('prio-input')?.focus();
	} catch (error) { toast(error.message, true); }
});

async function sendIssueMessage(form, preset) {
	const ta = form.querySelector('.ask-input');
	const text = (preset ?? ta.value).trim();
	if (!text) return;
	const btn = form.querySelector('.send');
	btn.disabled = true;
	try {
		await api('/api/message', { key: form.dataset.key, title: form.dataset.title, text });
		if (preset === undefined) { ta.value = ''; autoGrow(ta); }
		toast('Sent to the chat');
		await load();
	} catch (error) {
		toast(error.message, true);
	} finally {
		btn.disabled = false;
	}
}
function closeMenus() {
	for (const t of document.querySelectorAll('.split-toggle[aria-expanded="true"]')) openMenu(t, false);
}
function openMenu(toggle, open) {
	if (open) closeMenus();
	const menu = toggle.parentElement.querySelector('.menu');
	toggle.setAttribute('aria-expanded', String(open));
	menu.hidden = !open;
	if (open) menu.querySelector('button')?.focus();
}
document.addEventListener('click', e => { if (!e.target.closest('.split')) closeMenus(); });
// j / k (or ↓ / ↑ outside the list) move through the list; x toggles the current item's checkbox.
document.addEventListener('keydown', e => {
	if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable], .menu')) return;
	if (!$('settings').hidden) return;
	const key = e.key.toLowerCase();
	if (key !== 'j' && key !== 'k' && key !== 'x') return;
	const items = flatItems().filter(i => ui.showDone || !isHandled(i) || keepInPlace(i));
	const idx = items.findIndex(i => i.kind === ui.selected?.kind && i.id === ui.selected?.id);
	if (key === 'x') {
		const c = idx >= 0 && document.querySelector(`.row-check[data-id="${CSS.escape(items[idx].id)}"]`);
		if (c) { e.preventDefault(); c.click(); }
		return;
	}
	const next = items[Math.max(0, Math.min(items.length - 1, idx + (key === 'j' ? 1 : -1)))];
	if (!next || (idx >= 0 && next === items[idx])) return;
	e.preventDefault();
	select(next.kind, next.id).then(() => document.querySelector('#list .row[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }));
});
document.addEventListener('keydown', e => {
	const menu = e.target.closest?.('.menu');
	if (e.key === 'Escape' && document.querySelector('.split-toggle[aria-expanded="true"]')) {
		const t = document.querySelector('.split-toggle[aria-expanded="true"]');
		closeMenus();
		t.focus();
		return;
	}
	if (menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
		e.preventDefault();
		const items = [...menu.querySelectorAll('button')];
		const i = items.indexOf(document.activeElement);
		items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
	}
});

function setChatCollapsed(collapsed) {
	ui.state.settings.chatCollapsed = collapsed;
	for (const t of document.querySelectorAll('.thread')) t.classList.toggle('collapsed', collapsed);
	for (const h of document.querySelectorAll('.dock-head')) h.setAttribute('aria-expanded', String(!collapsed));
	if (!collapsed) scrollThreadToEnd();
	api('/api/settings', { chatCollapsed: collapsed }).catch(() => {});
}
function clampChatHeight(h) {
	const max = Math.max(80, Math.round($('detail').clientHeight * 0.7));
	return Math.round(Math.min(max, Math.max(48, h)));
}
function setChatHeight(h, save) {
	h = clampChatHeight(h);
	ui.state.settings.chatHeight = h;
	for (const b of document.querySelectorAll('.footer .bubbles')) b.style.height = `${h}px`;
	if (save) api('/api/settings', { chatHeight: h }).catch(() => {});
}
$('detail').addEventListener('pointerdown', e => {
	const handle = e.target.closest('.dock-resize');
	if (!handle) return;
	e.preventDefault();
	if (ui.state.settings.chatCollapsed) setChatCollapsed(false);
	const startY = e.clientY;
	const startH = document.querySelector('.footer .bubbles')?.offsetHeight ?? 160;
	handle.setPointerCapture(e.pointerId);
	document.body.classList.add('resizing');
	const move = ev => setChatHeight(startH + (startY - ev.clientY), false);
	const up = () => {
		handle.removeEventListener('pointermove', move);
		handle.removeEventListener('pointerup', up);
		document.body.classList.remove('resizing');
		setChatHeight(ui.state.settings.chatHeight, true);
	};
	handle.addEventListener('pointermove', move);
	handle.addEventListener('pointerup', up);
});
$('detail').addEventListener('keydown', e => {
	if (!e.target.classList?.contains('dock-resize') || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
	e.preventDefault();
	setChatHeight((ui.state.settings.chatHeight || 160) + (e.key === 'ArrowUp' ? 24 : -24), true);
});
$('detail').addEventListener('click', e => {
	const open = e.target.closest('[data-browse-open]');
	if (open) { ui.browseScroll = document.querySelector('#detail .detail-body')?.scrollTop ?? 0; select('browseitem', open.dataset.browseOpen); return; }
	if (e.target.closest('[data-browse-back]')) {
		select('worksrc', 'find').then(() => { const b = document.querySelector('#detail .detail-body'); if (b) b.scrollTop = ui.browseScroll || 0; renderAreaBar(); });
		return;
	}
	const p = e.target.closest('[data-find-src]');
	if (p) { ui.findSource = p.dataset.findSrc; renderDetail(false, true); document.querySelector(`[data-find-src="${p.dataset.findSrc}"]`)?.focus(); return; }
	if (e.target.closest('[data-find-query-clear]')) { setFindRefine(null); document.getElementById('find-filter')?.focus(); return; }
	if (e.target.closest('[data-find-ask-cancel]')) { ui.findAsking = null; renderDetail(false, true); }
});
$('detail').addEventListener('keydown', e => {
	if (e.key !== 'Enter' || e.isComposing || !['find-filter', 'find-query'].includes(e.target.id)) return;
	const text = e.target.value.replace(/\s+/g, ' ').trim();
	e.preventDefault();
	if (!text && e.target.id === 'find-query') { setFindRefine(null); return; }
	if (e.target.id === 'find-query') {
		const same = text === ui.findRefine?.query;
		setFindRefine({ query: text, text: same ? ui.findRefine.text : '', note: same ? ui.findRefine.note : '' });
	} else applyFindFilter(text.slice(0, 300));
});
$('detail').addEventListener('change', e => {
	if (e.target.id === 'find-area') { ui.findArea = e.target.value; renderDetail(false, true); document.getElementById('find-area')?.focus(); }
});
// The filter applies on Enter; clearing the search box (its × button) removes it.
$('detail').addEventListener('input', e => {
	if (e.target.id !== 'find-filter') return;
	ui.findFilter = e.target.value;
	if (!e.target.value && ui.findRefine) setFindRefine(null);
});
// Drag issues from Browse into a group on the left.
$('detail').addEventListener('dragstart', e => {
	const row = e.target.closest?.('[data-new-issue]');
	if (!row) return;
	drag = { prio: null, sess: null, pinIssue: row.dataset.newIssue, from: null };
	e.dataTransfer.effectAllowed = 'copy';
	e.dataTransfer.setData('text/plain', row.dataset.newIssue);
	row.classList.add('dragging');
	$('list').classList.add('drop-ready');
});
$('detail').addEventListener('dragend', () => {
	drag = null;
	clearDrop();
	$('list').classList.remove('drop-ready');
	for (const r of document.querySelectorAll('.dragging')) r.classList.remove('dragging');
});
$('detail').addEventListener('submit', async e => {
	const form = e.target.closest('[data-msrc-form]');
	if (!form) return;
	e.preventDefault();
	const f = new FormData(form);
	const btn = form.querySelector('[type="submit"]');
	btn.disabled = true;
	try {
		await api('/api/msrc-item', { op: 'save', incidentId: form.dataset.id, link: form.dataset.link, title: f.get('title'), resolveBy: f.get('resolveBy'), description: f.get('description') });
		ui.msrcDraft = null; ui.msrcEditing = null;
		await loadWork();
		select('msrcitem', form.dataset.id);
		toast(`IcM ${form.dataset.id} saved in My Work`);
	} catch (error) { toast(error.message, true); btn.disabled = false; }
});
$('detail').addEventListener('click', e => {
	if (!e.target.closest('[data-msrc-cancel]')) return;
	const id = ui.selected?.id;
	const saved = (ui.work?.data?.msrcItems || []).some(x => x.incidentId === id);
	ui.msrcEditing = null;
	if (!saved) { ui.msrcDraft = null; ui.selected = null; render(); } else renderDetail(false);
});
$('detail').addEventListener('submit', e => {
	const form = e.target.closest('.composer');
	if (!form) return;
	e.preventDefault();
	sendIssueMessage(form);
});
$('detail').addEventListener('keydown', e => {
	if (!e.target.classList?.contains('ask-input') || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
	e.preventDefault();
	sendIssueMessage(e.target.closest('.composer'));
});
$('detail').addEventListener('input', e => {
	if (e.target.classList?.contains('ask-input')) autoGrow(e.target);
});
$('detail').addEventListener('click', e => {
	const os = e.target.closest('[data-open-session]');
	if (os) { api('/api/open-session', { link: os.dataset.openSession }).then(() => toast('Opening the session in the Agents window'), error => toast(error.message, true)); return; }
	const toggle = e.target.closest('.split-toggle');
	if (toggle) { e.stopPropagation(); openMenu(toggle, toggle.getAttribute('aria-expanded') !== 'true'); return; }
	if (e.target.closest('.menu [data-act]')) closeMenus();
	if (e.target.closest('[data-act="toggle-chat"]')) { setChatCollapsed(!ui.state.settings.chatCollapsed); return; }
	const recoAsk = e.target.closest('[data-reco-ask]');
	if (recoAsk) { recoAsk.disabled = true; askAboutIssue(recoAsk.dataset.key, recoAsk.dataset.recoAsk); return; }
	const ghReload = e.target.closest('[data-gh-reload]');
	if (ghReload) { loadGitHub(ghReload.dataset.ghReload, true); return; }
	const ghExpand = e.target.closest('[data-gh-expand]');
	if (ghExpand) {
		const k = ghExpand.dataset.ghExpand;
		ui.ghExpanded ??= new Set();
		if (ui.ghExpanded.has(k)) ui.ghExpanded.delete(k); else ui.ghExpanded.add(k);
		paintGitHub(k);
		return;
	}
	const choice = e.target.closest('[data-act="choice"]');
	if (choice) {
		const c = (ui.state.threads?.[choice.dataset.key] || []).at(-1)?.choices?.[Number(choice.dataset.i)];
		const form = choice.closest('.thread')?.querySelector('.composer');
		if (!c || !form) return;
		if (c.edit) {
			const ta = form.querySelector('.ask-input');
			ta.value = c.reply;
			autoGrow(ta);
			ta.focus();
			ta.setSelectionRange(ta.value.length, ta.value.length);
			return;
		}
		choice.closest('.choices').querySelectorAll('button').forEach(x => { x.disabled = true; });
		sendIssueMessage(form, c.reply);
		return;
	}
	const cv = e.target.closest('[data-cview]');
	if (cv) { setCommentView(cv.dataset.cview); return; }
	const b = e.target.closest('[data-act]');
	if (b) { e.preventDefault(); act(b); }
});
// Links and issue numbers are added at once; anything else goes to the My Work chat.
async function sendWorkChat(form) {
	const ta = form.querySelector('.ask-input');
	const text = ta.value.trim();
	if (!text) return;
	const [first, ...rest] = text.split(/\s+/);
	const restText = text.slice(text.indexOf(first) + first.length).trim();
	try {
		const sid = parseSessionRef(first);
		if (sid && !rest.length) {
			const r = await api('/api/work-pin', { op: 'add', id: sid });
			ta.value = ''; autoGrow(ta);
			await loadWork();
			if (r.issue) { select('work', r.issue); toast(`Added ${shortKey(r.issue)}: this session works on it (from its ${r.via})`); }
			else { select('pinsess', sid); toast('Session added; the My Work chat will describe what it is doing'); }
			return;
		}
		const inc = ui.work?.data?.msrcEnabled === false ? null : parseIncident(first);
		if (inc) {
			// IcM link (optionally followed by the pasted description): open the MSRC form prefilled.
			ta.value = ''; autoGrow(ta);
			const existing = (ui.work?.data?.msrcItems || []).find(x => x.incidentId === inc.incidentId);
			if (!existing) ui.msrcDraft = { incidentId: inc.incidentId, link: inc.link, description: restText, addedAt: new Date().toISOString() };
			ui.msrcEditing = existing ? inc.incidentId : null;
			select('msrcitem', inc.incidentId);
			return;
		}
		const keys = text.split(/[\s,]+/).map(parseIssueRef);
		if (keys.length && keys.every(Boolean)) {
			for (const k of keys) await updatePriority(k, 'add');
			ta.value = ''; autoGrow(ta);
			toast(`${keys.map(shortKey).join(', ')} added to your priorities`);
			if (keys.length === 1) select('work', keys[0]);
			return;
		}
	} catch (error) { toast(error.message, true); return; }
	sendIssueMessage(form);
}
$('workchat').addEventListener('submit', e => {
	const form = e.target.closest('.composer');
	if (!form) return;
	e.preventDefault();
	sendWorkChat(form);
});
$('workchat').addEventListener('keydown', e => {
	if (!e.target.classList?.contains('ask-input') || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
	e.preventDefault();
	sendWorkChat(e.target.closest('.composer'));
});
$('workchat').addEventListener('click', e => {
	const b = e.target.closest('[data-act="pin-session"]');
	if (b) { e.preventDefault(); act(b); }
});
$('list').addEventListener('click', e => {
	const b = e.target.closest('.row-pin[data-act]');
	if (b) { e.stopPropagation(); act(b); }
}, true);
$('workchat').addEventListener('input', e => { if (e.target.classList?.contains('ask-input')) autoGrow(e.target); });
$('workchat').addEventListener('click', e => {
	const os = e.target.closest('[data-open-session]');
	if (os) { api('/api/open-session', { link: os.dataset.openSession }).then(() => toast('Opening the My Work chat'), error => toast(error.message, true)); return; }
	if (e.target.closest('[data-act="toggle-chat"]')) { ui.workChatCollapsed = !ui.workChatCollapsed; $('workchat').classList.toggle('collapsed', ui.workChatCollapsed); return; }
	const choice = e.target.closest('[data-act="choice"]');
	if (!choice) return;
	const c = (ui.state.threads?.['my-work'] || []).at(-1)?.choices?.[Number(choice.dataset.i)];
	const form = $('workchat').querySelector('.composer');
	if (!c || !form) return;
	if (c.edit) { const ta = form.querySelector('.ask-input'); ta.value = c.reply; autoGrow(ta); ta.focus(); return; }
	choice.closest('.choices').querySelectorAll('button').forEach(x => { x.disabled = true; });
	sendIssueMessage(form, c.reply);
});
$('settings-btn').addEventListener('click', () => toggleSettings());
document.addEventListener('keydown', e => {
	if (e.key !== 'Escape') return;
	if (!$('settings').hidden) { toggleSettings(false); $('settings-btn').focus(); }
});
document.addEventListener('click', e => {
	if (!$('settings').hidden && !e.target.closest('#settings, #settings-btn')) toggleSettings(false);
});
$('theme-seg').addEventListener('click', e => {
	const b = e.target.closest('button[data-theme]');
	if (b) saveSettings({ theme: b.dataset.theme });
});
$('link-seg').addEventListener('click', e => {
	const b = e.target.closest('button[data-link]');
	if (b) saveSettings({ linkTarget: b.dataset.link });
});
$('density-seg').addEventListener('click', e => {
	const b = e.target.closest('button[data-density]');
	if (b) saveSettings({ density: b.dataset.density });
});
$('accent-seg').addEventListener('click', e => {
	const b = e.target.closest('button[data-accent]');
	if (b) saveSettings({ accent: b.dataset.accent });
});
$('batch-size').addEventListener('change', async e => {
	const n = Number(e.target.value);
	if (!Number.isInteger(n) || n < 1 || n > 50) { toast('Batch size must be 1–50', true); return; }
	if (await saveSettings({ batchSize: n })) {
		toast(`Batch size ${n} — applies from the next batch`);
		await load();
	}
});
// The canvas frame blocks new windows, so external links are opened by the extension in the default browser.
document.addEventListener('click', e => {
	const a = e.target.closest('a[href]');
	if (!a || !/^https?:\/\//.test(a.getAttribute('href'))) return;
	e.preventDefault();
	e.stopPropagation();
	api('/api/open', { url: a.href, browser: e.metaKey || e.ctrlKey }).then(r => {
		if (r.via === 'vscode') toast('Opening in VS Code (GitHub Pull Requests)…');
	}).catch(error => toast(/not found/i.test(error.message)
		? 'This panel runs an older version of the extension. Ask the chat to reload extensions and reopen the canvas.'
		: `Could not open link: ${error.message}`, true));
}, true);
document.addEventListener('auxclick', e => {
	const a = e.target.closest('a[href]');
	if (e.button !== 1 || !a || !/^https?:\/\//.test(a.getAttribute('href'))) return;
	e.preventDefault();
	api('/api/open', { url: a.href }).catch(error => toast(`Could not open link: ${error.message}`, true));
}, true);
async function refreshNow() {
	ui.refreshing = true;
	renderAreaBar();
	try {
		if (ui.tab === 'work') { await Promise.all([loadWork(true), ui.selected?.kind === 'worksrc' ? loadFindWork(true) : null]); toast('My Work refreshed'); }
		else { await load(true); toast('Refreshed from GitHub'); }
	} finally { ui.refreshing = false; if (ui.state) renderAreaBar(); }
}
$('refresh').addEventListener('click', () => { if (!ui.refreshing) refreshNow(); });
// Keep the "Updated … ago" label current.
setInterval(() => { if (ui.state && !ui.refreshing && ui.tab === 'notifications' && document.activeElement?.id !== 'area-filter') renderAreaBar(); }, 30_000);

const events = new EventSource(`/api/events?t=${encodeURIComponent(TOKEN)}`);
events.addEventListener('changed', e => {
	load();
	if (ui.work) loadWork();
	// A chat changed something (e.g. closed an issue): re-run the Browse search so the list matches GitHub.
	if (ui.selected?.kind === 'worksrc' && JSON.parse(e.data || '{}').by === 'agent') loadFindWork(true);
});
// The panel's files changed: reload, keeping the current view and selection.
events.addEventListener('reload', () => {
	// A burst of file events can trigger a second reload before the view was restored: keep the saved view then.
	if (!ui.restorePending) {
		try { sessionStorage.setItem('triage-restore', JSON.stringify({ tab: ui.tab, sub: ui.sub, selected: ui.selected && { kind: ui.selected.kind, id: ui.selected.id } })); } catch { }
	}
	location.reload();
});
events.addEventListener('theme', e => applyVsCodeTheme(JSON.parse(e.data).theme ?? null));
// The chat turned a Browse search into a GitHub query.
events.addEventListener('browse-query', e => {
	const f = JSON.parse(e.data);
	if (!ui.state || typeof f.query !== 'string') return;
	setFindRefine({ query: f.query, text: f.text || '', note: f.note || '' });
});
events.addEventListener('focus', e => {
	const f = JSON.parse(e.data);
	if (!ui.state) { ui.pendingFocus = f; return; }
	applyFocus(f);
});

function applyFocus(f) {
	const sel = ui.selected;
	// Already showing it (e.g. the open notification is about this issue/PR): don't move.
	if (sel && ((sel.kind === f.kind && sel.id === f.id) || (f.kind === 'issue' && sel.kind === 'notification' && ui.state.notifications.find(n => n.id === sel.id)?.issueKey === f.id))) return;
	if (f.kind === 'notification') {
		ui.tab = 'notifications';
	} else {
		const inCleanup = Object.entries(ui.state.cleanup).find(([, g]) => g.items.some(i => i.key === f.id));
		const inQueue = ui.state.sections.some(s => s.items.some(i => i.key === f.id));
		const notif = ui.state.notifications.find(n => n.issueKey === f.id && !n.handled);
		if (inCleanup) { ui.tab = 'cleanup'; ui.sub.cleanup = inCleanup[0]; }
		else if (ui.state.implement.items.some(i => i.key === f.id)) ui.tab = 'implement';
		else if (inQueue) ui.tab = 'queue';
		else if (notif) { ui.tab = 'notifications'; f = { kind: 'notification', id: notif.id }; }
		// Not in any list (e.g. a PR the chat just finished): don't pull you back right after moving on.
		else if (Date.now() - (ui.autoAdvancedAt || 0) < 60_000) return;
		// Otherwise show it without switching tabs.
	}
	render();
	select(f.kind, f.id, true);
}

try { ui.restorePending = !!sessionStorage.getItem('triage-restore'); } catch { }
load().then(() => {
	let r = null;
	try { r = JSON.parse(sessionStorage.getItem('triage-restore') || 'null'); sessionStorage.removeItem('triage-restore'); } catch { }
	ui.restorePending = false;
	// Milestones for the Plan menu (and the My Work badge) load in the background.
	if (!ui.work) loadWork();
	if (!r || !ui.state) return;
	ui.tab = r.tab && document.getElementById(`tab-${r.tab}`) ? r.tab : ui.tab;
	Object.assign(ui.sub, r.sub || {});
	render();
	if (r.selected) select(r.selected.kind, r.selected.id);
});

// Bare attachment URLs may be images rather than videos: fall back to an image if the video can't load.
document.addEventListener('error', e => {
	const v = e.target;
	if (!(v instanceof HTMLVideoElement) || !v.classList.contains('md-video')) return;
	const a = document.createElement('a');
	a.className = 'md-img';
	a.href = v.src;
	a.target = '_blank';
	a.rel = 'noopener';
	const img = document.createElement('img');
	img.src = v.src;
	img.alt = 'attachment';
		a.append(img);
	v.nextElementSibling?.classList.contains('md-media') && v.nextElementSibling.remove();
	v.replaceWith(a);
}, true);

// ⌘V / Ctrl+V fallback: some hosts don't deliver paste to the embedded page. If no native paste event
// follows the shortcut, read the clipboard through the panel's server and insert it at the cursor.
{
	let pending = null;
	const isField = el => el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|url|email|number)$/.test(el.type));
	document.addEventListener('paste', () => { if (pending) pending.native = true; }, true);
	document.addEventListener('keydown', e => {
		const mod = navigator.platform.includes('Mac') ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
		if (!mod || e.altKey || e.key.toLowerCase() !== 'v' || !isField(e.target) || e.target.readOnly || e.target.disabled) return;
		const el = e.target;
		const state = pending = { el, value: el.value, start: el.selectionStart, end: el.selectionEnd, native: false };
		setTimeout(async () => {
			if (pending !== state) return;
			pending = null;
			if (state.native || el.value !== state.value) return;
			try {
				const { text } = await api('/api/clipboard-read', {});
				if (!text || !el.isConnected) return;
				el.focus();
				el.setRangeText(text, state.start ?? el.value.length, state.end ?? el.value.length, 'end');
				el.dispatchEvent(new Event('input', { bubbles: true }));
			} catch (error) { toast(`Paste failed: ${error.message}`, true); }
		}, 120);
	}, true);
}
