import { getMyWork, cleanRefine } from './work.mjs';
import { listSections, listNotes, saveNote, sectionForLink, isGroup } from './sections.mjs';
import { listPinned, pinSession, unpinSessions, parseSessionRef, getMyWorkChat, setMyWorkChat, setIssueChat, MY_WORK_DIR, setSessionBucket, setSessionSummary, pinIssue, setIssueBucket, recordSessionSummary } from './workSessions.mjs';
import { watch as fsWatch, mkdirSync } from 'node:fs';
import { sessionsById, recentSessions } from './sessions.mjs';
import { TriageServer } from './server.mjs';
import * as data from './data.mjs';
import { config, PRINCIPLES } from './config.mjs';

const GROUPS = data.BUILTIN_GROUPS;
const GROUP_ID = { type: 'string', pattern: '^[a-z][a-z0-9-]{1,30}$' };

export const actionDefinitions = [
	{
		name: 'refresh',
		description: 'Reload index, queue, cleanup candidates and live notifications, and update the panel.',
	},
	{
		name: 'setNotificationTriage',
		description: 'Store the agent\'s classification of notifications (group + reason) so the panel shows them. Use after triaging a batch.',
		inputSchema: {
			type: 'object',
			properties: {
				items: {
					type: 'array', minItems: 1, maxItems: 200,
					items: {
						type: 'object',
						properties: {
							id: { type: 'string', pattern: '^\\d+$', description: 'Notification thread id' },
							group: { ...GROUP_ID, description: 'Built-in: action = needs the user; route = belongs to another owner (set routeTo); auto = matches one of the user\'s Inbox auto-dismiss rules (set rule); cleanup = Sweeper cleanup offer; dismiss = safe to dismiss; fyi = informational. Or the id of a custom group from getConfig (use it whenever its criteria match).' },
							rule: { type: 'string', maxLength: 120, description: 'For auto: the auto-dismiss rule that matched, e.g. "A1. Merged own PR" from the triage principles or a numbered rule of the user. For route: the routing rule, e.g. "12. Settings owners"' },
							routeTo: { type: 'array', maxItems: 5, items: { type: 'string', pattern: '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$' }, description: 'For route: GitHub logins to assign. Routing from the panel adds them, removes the current user, records `routed`, and dismisses the notification. Empty = only unassign the current user.' },
							reason: { type: 'string', maxLength: 400, description: 'One-line reason shown to the user (required for dismiss)' },
							issueKey: { type: 'string', description: 'owner/repo#number of the notification\'s issue/PR (always set it for route)' },
						},
						required: ['id', 'group', 'reason'],
						additionalProperties: false,
					},
				},
				keepBatch: { type: 'boolean', description: 'true = only store the classification; do not replace the panel\'s current notification batch (use for "triage more" requests from the panel)' },
			},
			required: ['items'],
			additionalProperties: false,
		},
	},
	{
		name: 'getActivity',
		description: 'What the user did in the panel (dismissed, applied, recorded, skipped). Call before each batch so you do not redo or re-ask those items.',
		inputSchema: {
			type: 'object',
			properties: { since: { type: 'string', description: 'ISO timestamp; defaults to start of today' } },
			additionalProperties: false,
		},
	},
	{
		name: 'setBrowseQuery',
		description: 'Apply a filter to the panel\'s Browse list (answer to a "turn my Browse filter into GitHub search qualifiers" panel request): GitHub search qualifiers added to the list\'s own query. The panel shows them so the user can edit them.',
		inputSchema: {
			type: 'object',
			properties: {
				text: { type: 'string', maxLength: 300, description: 'The user\'s original words' },
				query: { type: 'string', minLength: 1, maxLength: 300, description: 'Qualifiers to add to the list\'s query, e.g. "author:alexdima created:>=2026-10-01"' },
				note: { type: 'string', maxLength: 300, description: 'Optional: how names were resolved, or what was guessed' },
			},
			required: ['query'],
			additionalProperties: false,
		},
	},
	{
		name: 'focus',
		description: 'Select an item in the panel so the user sees its details.',
		inputSchema: {
			type: 'object',
			properties: {
				kind: { type: 'string', enum: ['notification', 'issue'] },
				id: { type: 'string', description: 'Notification thread id, or issue key owner/repo#number' },
			},
			required: ['kind', 'id'],
			additionalProperties: false,
		},
	},
	{
		name: 'setBatch',
		description: 'Make the panel show exactly these items as the current batch of a tab (keep the panel in step with the batch you are working on in the chat). setNotificationTriage already does this for notifications.',
		inputSchema: {
			type: 'object',
			properties: {
				tab: { type: 'string', enum: ['notifications', 'cleanup:fixed', 'cleanup:duplicate', 'cleanup:reason', 'cleanup:needs-info', 'implement'] },
				ids: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string' }, description: 'Notification thread ids, or issue keys owner/repo#number' },
			},
			required: ['tab', 'ids'],
			additionalProperties: false,
		},
	},
	{
		name: 'setOpinion',
		description: 'Record an independent (blind) judgement for an issue. Normally judge chats run `my_issues.py opinion` instead; never base this on Sweeper data.',
		inputSchema: {
			type: 'object',
			properties: {
				key: { type: 'string', pattern: '^[\\w.-]+/[\\w.-]+#\\d+$' },
				action: { type: 'string', enum: ['keep-open', 'fixed', 'duplicate', 'not-planned', 'needs-info'] },
				reference: { type: 'string', maxLength: 300, description: 'Fix commit/PR for fixed, original issue for duplicate' },
				confidence: { type: 'number', minimum: 0, maximum: 1 },
				reasoning: { type: 'string', minLength: 1, maxLength: 1500 },
				evidence: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 300 } },
			},
			required: ['key', 'action', 'reasoning'],
			additionalProperties: false,
		},
	},
	{
		name: 'judgeFailed',
		description: 'Report that a panel-requested judge chat could not be created, so the panel shows the error and offers Retry.',
		inputSchema: {
			type: 'object',
			properties: {
				keys: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', pattern: '^[\\w.-]+/[\\w.-]+#\\d+$' } },
				error: { type: 'string', maxLength: 500 },
			},
			required: ['keys', 'error'],
			additionalProperties: false,
		},
	},
	{
		name: 'replyToIssue',
		description: 'Post your answer to a "Panel message about <issue>" back into that issue\'s thread in the panel (markdown; links are rendered).',
		inputSchema: {
			type: 'object',
			properties: {
				key: { type: 'string', pattern: '^([\\w.-]+/[\\w.-]+#\\d+|my-work)$', description: 'The issue key, or "my-work" for a My Work chat message' },
				text: { type: 'string', minLength: 1, maxLength: 4000 },
				choices: {
					type: 'array', maxItems: 5,
					description: 'Buttons shown under this reply so the user can answer in one click. Use them whenever you ask for approval or a decision. Each click sends `reply` back to you as the user\'s message about this issue.',
					items: {
						type: 'object',
						properties: {
							label: { type: 'string', minLength: 1, maxLength: 40, description: 'Button text, e.g. "Approve & dismiss"' },
							reply: { type: 'string', minLength: 1, maxLength: 400, description: 'Exact message sent to you when clicked, e.g. "approve and dismiss"' },
							style: { type: 'string', enum: ['primary', 'secondary', 'danger'], description: 'primary = recommended (at most one); danger = destructive' },
							edit: { type: 'boolean', description: 'true = put `reply` into the input box for the user to finish instead of sending it (e.g. "Edit comment…")' },
						},
						required: ['label', 'reply'],
						additionalProperties: false,
					},
				},
			},
			required: ['key', 'text'],
			additionalProperties: false,
		},
	},
	{
		name: 'setMyWorkChat',
		description: 'Register the nested "My Work chat" that handles messages from the My Work chat box (null to forget it, e.g. when it was deleted).',
		inputSchema: {
			type: 'object',
			properties: { link: { type: ['string', 'null'], pattern: '^agent-host-session://', maxLength: 300 } },
			required: ['link'],
			additionalProperties: false,
		},
	},
	{
		name: 'setIssueChat',
		description: 'Register the chat for an issue (its own session where the panel\'s messages about the issue go), or forget it with link null. Stage "session" once Start session turned that chat into the work session.',
		inputSchema: {
			type: 'object',
			properties: {
				key: { type: 'string', pattern: '^[\\w.-]+/[\\w.-]+#\\d+$', description: 'Issue key owner/repo#number' },
				link: { type: ['string', 'null'], pattern: '^agent-host-session://', maxLength: 300 },
				stage: { type: 'string', enum: ['discuss', 'session'], description: 'discuss (default) or session' },
			},
			required: ['key', 'link'],
			additionalProperties: false,
		},
	},
	{
		name: 'getMyWork',
		description: 'What is on the user\'s My Work board: the user\'s custom sections (id, name) with their notes, pinned sessions, current/next milestone issues, My priorities (in order), and the most recently active Agents window sessions that are not pinned yet.',
	},
	{
		name: 'updateMyWork',
		description: 'Change the user\'s local My Work board (never GitHub). Ops: addIssue (key owner/repo#N, optional group: current (default) | next | priorities | a custom section id from getMyWork; local, GitHub milestone unchanged), pinSession / unpinSession (session: an agent-host-session:// link or id, optional note, optional group as for addIssue), moveSession (session, group), describeSession (session, summary, optional issue owner/repo#N to replace the session with that issue), addPriority (key, optional position "top"), movePriority (key, position "top" | "bottom" | "up" | "down" | 0-based index), removePriority (key), addNote (section: a custom section id, title, optional link, optional due YYYY-MM-DD, optional description; a link matching a section\'s link pattern picks that section and its reference).',
		inputSchema: {
			type: 'object',
			properties: {
				op: { type: 'string', enum: ['addIssue', 'pinSession', 'unpinSession', 'moveSession', 'describeSession', 'addPriority', 'movePriority', 'removePriority', 'addNote'] },
				session: { type: 'string', maxLength: 300 },
				note: { type: 'string', maxLength: 200 },
				group: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,30}$' },
				section: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,30}$' },
				link: { type: 'string', maxLength: 1000 },
				due: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
				key: { type: 'string', pattern: '^[\\w.-]+/[\\w.-]+#\\d+$' },
				position: { oneOf: [{ type: 'string', enum: ['top', 'bottom', 'up', 'down'] }, { type: 'integer', minimum: 0, maximum: 9999 }] },
				title: { type: 'string', maxLength: 200 },
				description: { type: 'string', maxLength: 20000 },
				summary: { type: 'string', maxLength: 1500 },
				issue: { type: 'string', pattern: '^[\\w.-]+/[\\w.-]+#\\d+$' },
			},
			required: ['op'],
			additionalProperties: false,
		},
	},
	{
		name: 'getSummary',
		description: 'Counts shown in the panel: unread notifications, queue sections, cleanup groups, and today\'s tally.',
	},
	{
		name: 'dismissNotifications',
		description: 'Dismiss (mark done) GitHub notifications and update the panel immediately. Always use this instead of calling the GitHub notifications API yourself: GitHub keeps listing a dismissed thread for a while, so the panel only knows it is done when dismissed through here. Use it after the user approved the dismissal (or clicked a choice that includes dismissing).',
		inputSchema: {
			type: 'object',
			properties: {
				ids: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', pattern: '^\\d+$' }, description: 'Notification thread ids' },
				unsubscribe: { type: 'boolean', description: 'Also unsubscribe from the thread (the panel\'s "Done & unsubscribe")' },
			},
			required: ['ids'],
			additionalProperties: false,
		},
	},
	{
		name: 'setIssueRules',
		description: 'Store the verdict of the user\'s inbox rules (the rules file in my-work.config.json, default ~/.copilot/github-inbox-rules.md) for issues in the panel\'s Cleanup / Implement / Today views. Answer each "Panel request: apply my inbox rules" with one call.',
		inputSchema: {
			type: 'object',
			properties: {
				items: {
					type: 'array', minItems: 1, maxItems: 100,
					items: {
						type: 'object',
						properties: {
							key: { type: 'string', pattern: '^[\\w.-]+/[\\w.-]+#\\d+$' },
							group: { type: 'string', enum: data.ISSUE_RULE_GROUPS, description: 'route = a rule says another owner (set routeTo, rule); close = a rule says close (set closeAs, rule); needs-info = a rule says ask the reporter first; keep = no rule applies' },
							reason: { type: 'string', minLength: 1, maxLength: 400 },
							rule: { type: 'string', maxLength: 120, description: 'e.g. "12. Settings owners"' },
							routeTo: { type: 'array', maxItems: 5, items: { type: 'string', pattern: '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$' } },
							closeAs: { type: 'string', maxLength: 60, description: 'fixed | duplicate #N | not-planned | as-designed' },
						},
						required: ['key', 'group', 'reason'],
						additionalProperties: false,
					},
				},
			},
			required: ['items'],
			additionalProperties: false,
		},
	},
	{
		name: 'getConfig',
		description: 'Persistent panel configuration that outlives this chat: the notification groups (built-in plus the user\'s custom groups with their classification criteria). Call at the start of every triage chat and classify notifications into custom groups whenever their criteria match.',
	},
	{
		name: 'defineGroup',
		description: 'Create or update a persistent custom notification group (its own section and bulk-select list in the panel, kept for all future triage chats). Use when the user asks for a new grouping "from now on". Confirm the label and criteria with the user first.',
		inputSchema: {
			type: 'object',
			properties: {
				id: { ...GROUP_ID, description: 'Stable kebab-case id, e.g. "codenotify"' },
				label: { type: 'string', minLength: 1, maxLength: 40, description: 'Section/pill label, e.g. "CODENOTIFY"' },
				criteria: { type: 'string', minLength: 1, maxLength: 600, description: 'Exactly which notifications belong here, written so a future chat can classify without asking, e.g. "Open PRs where the only reason I was notified is a CODENOTIFY mention (rule 4)."' },
				bulk: { type: 'string', enum: ['dismiss', 'none'], description: 'dismiss (default) = the pill opens a bulk list with "Dismiss N"; none = section only' },
				order: { type: 'integer', minimum: -100, maximum: 100, description: 'Sort order among custom groups (lower first)' },
			},
			required: ['id', 'label', 'criteria'],
			additionalProperties: false,
		},
	},
	{
		name: 'removeGroup',
		description: 'Delete a custom notification group. Notifications already classified into it show under "Not triaged yet" until re-triaged.',
		inputSchema: {
			type: 'object',
			properties: { id: GROUP_ID },
			required: ['id'],
			additionalProperties: false,
		},
	},
];

export class TriageRuntime {
	constructor({ log, sendToChat }) {
		this.log = log;
		this.sendToChat = sendToChat;
		this.instances = new Map();
	}

	async open(instanceId) {
		let inst = this.instances.get(instanceId);
		if (!inst) {
			const server = new TriageServer(this.log, this.sendToChat);
			const url = await server.start();
			const unwatchOpinions = await data.watchOpinions(() => server.push('changed', { by: 'judge' }));
			const unwatchDecisions = data.watchDecisions(() => server.push('changed', { by: 'decision' }));
			const unwatchShared = watchShared(() => server.push('changed', { by: 'shared', work: true }));
			inst = { server, url, unwatch: () => { unwatchOpinions(); unwatchDecisions(); unwatchShared(); } };
			this.instances.set(instanceId, inst);
		}
		await data.getTriage();
		return { url: inst.url, title: 'My Work' };
	}

	instance(instanceId) {
		const inst = this.instances.get(instanceId);
		if (!inst) {
			throw Object.assign(new Error(`Canvas instance ${instanceId} is not open; call open_canvas first.`), { code: 'not_open' });
		}
		return inst;
	}

	async invoke(instanceId, name, input = {}) {
		switch (name) {
			case 'refresh': {
				const state = await data.getState({ forceNotifications: true });
				this.instances.get(instanceId)?.server.push('changed', { by: 'agent' });
				return summarize(state);
			}
			case 'setNotificationTriage': {
				const result = await data.setNotificationTriage(input.items);
				if (!input.keepBatch) {
					const { batchSize } = await data.getSettings();
					await data.setBatch('notifications', input.items.slice(0, batchSize).map(i => i.id));
				}
				this.instances.get(instanceId)?.server.push('changed', { by: 'agent' });
				return result;
			}
			case 'setBatch': {
				const result = await data.setBatch(input.tab, input.ids);
				this.instances.get(instanceId)?.server.push('changed', { by: 'agent' });
				return result;
			}
			case 'setOpinion': {
				const result = await data.setOpinion(input);
				this.instances.get(instanceId)?.server.push('changed', { by: 'agent' });
				return result;
			}
			case 'replyToIssue': {
				const entries = await data.appendThread(input.key, 'agent', input.text, input.choices);
				for (const inst of this.instances.values()) inst.server.push('changed', { by: 'agent', thread: input.key });
				return { key: input.key, messages: entries.length };
			}
			case 'judgeFailed': {
				for (const key of input.keys) await data.logActivity({ kind: 'opinion-failed', key, error: input.error });
				this.instances.get(instanceId)?.server.push('changed', { by: 'agent' });
				return { recorded: input.keys.length };
			}
			case 'getActivity': {
				const since = input.since ?? (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); })();
				return { since, entries: await data.getActivity(since) };
			}
			case 'focus':
				this.instance(instanceId).server.setFocus({ kind: input.kind, id: input.id });
				return { focused: input };
			case 'setBrowseQuery': {
				const query = cleanRefine(input.query);
				if (!query) throw Object.assign(new Error('query is empty'), { code: 'bad_input' });
				const payload = { query, text: String(input.text || '').slice(0, 300), note: String(input.note || '').slice(0, 300) };
				for (const inst of this.instances.values()) inst.server.push('browse-query', payload);
				return { query, shown: this.instances.size > 0 };
			}
			case 'getSummary':
				return summarize(await data.getState());
			case 'getConfig':
				return {
					builtinGroups: GROUPS,
					customGroups: await data.getCustomGroups(),
					standingRules: `Classification and handling rules live in ${config().rulesFile}; append new "from now on" rules there (after confirming the exact text with the user). Baseline principles: ${PRINCIPLES}. Facts such as people's GitHub logins, owners and teams live in ${config().memoryFile}.`,
				};
			case 'setMyWorkChat': {
				await setMyWorkChat(input.link);
				for (const inst of this.instances.values()) inst.server.push('changed', { by: 'agent', work: true });
				return { link: input.link };
			}
			case 'setIssueChat': {
				const chat = await setIssueChat(input.key, input.link, input.stage || 'discuss');
				for (const inst of this.instances.values()) inst.server.push('changed', { by: 'agent', work: true });
				return { key: input.key, chat };
			}
			case 'getMyWork': {
				const [work, sections, notes, pinned, recent] = await Promise.all([getMyWork(), listSections(), listNotes(), listPinned(), recentSessions(15)]);
				const byId = await sessionsById(pinned.map(p => p.id));
				return {
					sections: sections.map(x => ({ id: x.id, name: x.name, hasInstructions: !!x.instructions, linkPattern: x.linkPattern || null })),
					notes: notes.map(({ description, ...x }) => ({ ...x, hasDescription: !!description })),
					pinnedSessions: pinned.map(p => ({ ...p, title: byId[p.id]?.title ?? null, link: `agent-host-session://ahp-session/${p.id}` })),
					milestones: work.milestones.map(m => ({ role: m.role, title: m.title, items: m.items.map(i => ({ key: i.key, title: i.title })) })),
					recentSessions: recent.filter(r => !pinned.some(p => p.id === r.id)).map(r => ({ id: r.id, title: r.title, link: r.link, modified: new Date(r.modified).toISOString(), project: r.project })),
				};
			}
			case 'updateMyWork': {
				const need = (v, what) => { if (!v) throw Object.assign(new Error(`${input.op} needs ${what}`), { code: 'bad_input' }); return v; };
				let result;
				if (input.op === 'addIssue') {
					const group = input.group || 'current';
					if (!(await isGroup(group))) throw Object.assign(new Error(`Unknown group "${group}": use current, next, priorities or a custom section id from getMyWork`), { code: 'bad_input' });
					await data.updatePriorities({ op: 'remove', key: need(input.key, 'key') });
					result = await setIssueBucket(input.key, group);
					if (group === 'priorities') await data.updatePriorities({ op: 'add', key: input.key });
				} else if (input.op === 'describeSession') {
					const id = need(parseSessionRef(input.session), 'a session link or id');
					const item = (await listPinned()).find(p => p.id === id);
					const summary = need(input.summary, 'summary');
					result = await recordSessionSummary(id, summary);
					if (item) result = await setSessionSummary(id, summary);
					if (input.issue && item) {
						await pinIssue(input.issue, item.bucket || 'current', id);
						if ((item.bucket || 'current') === 'priorities') await data.updatePriorities({ op: 'add', key: input.issue });
						await data.updatePriorities({ op: 'remove', key: `session:${id}` });
						await unpinSessions([id]);
						result = { replacedBy: input.issue };
					}
				} else if (['pinSession', 'unpinSession', 'moveSession'].includes(input.op)) {
					const id = need(parseSessionRef(input.session), 'a session link or id');
					const group = input.group || 'current';
					if (!(await isGroup(group))) throw Object.assign(new Error(`Unknown group "${group}": use current, next, priorities or a custom section id from getMyWork`), { code: 'bad_input' });
					await data.updatePriorities({ op: 'remove', key: `session:${id}` });
					if (input.op === 'unpinSession') result = await unpinSessions([id]);
					else {
						result = input.op === 'pinSession' ? await pinSession(id, input.note || '', group) : await setSessionBucket(id, need(input.group, 'group'));
						if (result.bucket !== group) result = await setSessionBucket(id, group);
						if (group === 'priorities') await data.updatePriorities({ op: 'add', key: `session:${id}` });
					}
				} else if (input.op === 'addNote') {
					const hit = input.link ? await sectionForLink(input.link) : null;
					const section = need(input.section || hit?.section, 'a section id');
					result = await saveNote({ section, title: input.title || '', link: input.link || '', ref: hit?.section === section ? hit.ref : '', description: input.description || '', due: input.due || '' });
				} else {
					need(input.key, 'key');
					const op = { addPriority: 'add', movePriority: 'move', removePriority: 'remove' }[input.op];
					if (op === 'move') need(input.position !== undefined, 'position');
					result = { priorities: (await data.updatePriorities({ op, key: input.key, to: input.position })).map(p => p.key) };
				}
				await data.logActivity({ kind: 'work-update', op: input.op, by: 'agent' });
				for (const inst of this.instances.values()) inst.server.push('changed', { by: 'agent', work: true });
				return { op: input.op, result };
			}
			case 'dismissNotifications': {
				const done = [];
				const failed = [];
				for (const id of input.ids) {
					try { await data.dismissNotification({ id, unsubscribe: !!input.unsubscribe }); done.push(id); } catch (error) { failed.push({ id, error: error.message }); }
				}
				for (const inst of this.instances.values()) inst.server.push('changed', { by: 'agent' });
				return { dismissed: done.length, done, failed };
			}
			case 'setIssueRules': {
				const result = await data.setIssueRules(input.items);
				for (const inst of this.instances.values()) inst.server.push('changed', { by: 'agent' });
				return result;
			}
			case 'defineGroup':
			case 'removeGroup': {
				const result = name === 'defineGroup' ? await data.defineGroup(input) : await data.removeGroup(input.id);
				for (const inst of this.instances.values()) inst.server.push('changed', { by: 'agent' });
				return result;
			}
			default:
				throw Object.assign(new Error(`Unknown action ${name}`), { code: 'unknown_action' });
		}
	}

	async close(instanceId) {
		const inst = this.instances.get(instanceId);
		this.instances.delete(instanceId);
		inst?.unwatch?.();
		await inst?.server.stop();
	}

	async dispose() {
		await Promise.all([...this.instances.keys()].map(id => this.close(id)));
	}
}

function summarize(state) {
	const triaged = state.notifications.filter(n => n.triage);
	return {
		refreshedAt: state.refreshedAt,
		unreadNotifications: state.notifications.length,
		notificationsTriaged: triaged.length,
		notificationsByGroup: Object.fromEntries([...GROUPS, ...state.customGroups.map(g => g.id)].map(g => [g, triaged.filter(n => n.triage.group === g).length])),
		customGroups: state.customGroups.map(g => ({ id: g.id, label: g.label, criteria: g.criteria })),
		queue: Object.fromEntries(state.sections.map(s => [s.id, s.total])),
		cleanup: Object.fromEntries(Object.entries(state.cleanup).map(([g, v]) => [g, v.total])),
		implement: { total: state.implement.total, bugs: state.implement.bugs },
		batchSize: state.settings.batchSize,
		currentBatches: Object.fromEntries(Object.entries(state.batches).map(([k, v]) => [k, { number: v.number, ids: v.ids, open: v.open, remaining: v.remaining }])),
		today: state.today,
		notificationsError: state.notificationsError,
	};
}

// Chats other than the panel's own (e.g. the nested My Work chat) write threads and My Work data
// from their own extension host; watch those folders so the panel refreshes.
// Files other panels and chats write (a classification stored from another chat, a dismissal in another panel).
const SHARED_DATA_FILES = new Set(['priorities.json', 'notification-triage.json', 'issue-rules.json', 'activity.json', 'notification-groups.json']);
function watchShared(onChange) {
	let timer;
	const fire = () => { clearTimeout(timer); timer = setTimeout(onChange, 300); };
	const watchers = [];
	for (const [dir, filter] of [[data.THREADS_DIR, () => true], [MY_WORK_DIR, n => !String(n).startsWith('.tmp-')], [data.DATA_DIR, n => SHARED_DATA_FILES.has(String(n))]]) {
		try { mkdirSync(dir, { recursive: true }); watchers.push(fsWatch(dir, (_, name) => { if (filter(name)) fire(); })); } catch { /* best effort */ }
	}
	return () => { clearTimeout(timer); for (const w of watchers) w.close(); };
}
