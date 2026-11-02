// Copyright (c) Microsoft Corporation. Licensed under the MIT license.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TimelineSource } from '../com.github.copilot/extensions/session-timeline/source.mjs';
import { requestToolsFile } from '../com.github.copilot/extensions/session-timeline/request-tools.mjs';

const event = (id, type = 'user.message', data = { content: id }) => ({ id, type, data, timestamp: '2026-10-21T12:00:00Z', parentId: null });

function fixture(history, files = new Map()) {
	let handler;
	const logs = [];
	const session = {
		sessionId: 'fixture-session',
		getEvents: async () => history,
		rpc: {
			tools: { getCurrentMetadata: async () => ({ tools: null }) },
			workspaces: {
				ensure: async () => ({}),
				listFiles: async () => ({ files: [...files.keys()] }),
				readFile: async ({ path }) => ({ content: files.get(path) }),
				createFile: async ({ path, content }) => { files.set(path, content); },
			},
		},
		on(callback) { handler = callback; return () => { handler = undefined; }; },
		log: async message => { logs.push(message); },
	};
	const source = new TimelineSource(session);
	return { source, session, logs, files, emit: record => handler?.(record), subscribed: () => !!handler };
}

test('subscribes before fetching, merging buffered events and deduplicating by stable ID', async t => {
	const fixtureSource = fixture([]);
	const { source, session, emit } = fixtureSource;
	t.after(() => source.dispose());
	session.getEvents = async () => {
		assert.equal(fixtureSource.subscribed(), true);
		emit(event('a'));
		emit(event('b'));
		return [event('a')];
	};
	await source.start();
	assert.deepEqual([source.snapshot().totalRecords, [...source.records.keys()]], [2, ['a', 'b']]);
});

test('updates live, ignores ephemeral records, and disposes the subscription', async () => {
	const { source, emit, subscribed } = fixture([event('a')]);
	await source.start();
	emit({ ...event('delta', 'assistant.message_delta'), ephemeral: true });
	emit(event('b', 'assistant.message', { content: 'Reply' }));
	await setTimeout(150);
	const result = [source.snapshot().totalRecords, source.snapshot().events.map(e => e.id)];
	source.dispose();
	assert.deepEqual([result, subscribed()], [[2, ['a', 'b']], false]);
});

test('surfaces a failed refresh while retaining events arriving during the request', async t => {
	const { source, session, emit, logs } = fixture([event('a')]);
	t.after(() => source.dispose());
	await source.start();
	session.getEvents = async () => {
		emit(event('b'));
		throw new Error('History unavailable');
	};
	await assert.rejects(source.refresh(), /History unavailable/);
	assert.deepEqual([source.snapshot().totalRecords, source.snapshot().error, logs], [2, 'History unavailable', ['Session timeline: History unavailable']]);
});

test('replaces removed history on truncation and recovers from errors', async t => {
	const { source, session, emit } = fixture([event('a'), event('b')]);
	t.after(() => source.dispose());
	await source.start();
	session.getEvents = async () => [event('a')];
	emit(event('truncated', 'session.truncation', {}));
	await setTimeout(250);
	assert.deepEqual([...source.records.keys()], ['a']);
});

test('reports invalid live records without inserting them', async t => {
	const { source, emit } = fixture([]);
	t.after(() => source.dispose());
	await source.start();
	emit({ type: 'broken' });
	assert.deepEqual([source.snapshot().totalRecords, source.snapshot().error], [0, 'The SDK returned an invalid session event envelope.']);
});

test('loads full current tool metadata separately from durable events and refreshes it manually', async t => {
	const { source, session } = fixture([event('a')]);
	t.after(() => source.dispose());
	const tools = [
		{ name: 'view', description: 'Read files', input_schema: { type: 'object', properties: { path: { type: 'string' } } } },
		{ name: 'remote_search', description: 'Search', deferLoading: true, mcpServerName: 'remote', mcpToolName: 'search' },
	];
	session.rpc.tools.getCurrentMetadata = async () => ({ tools });
	await source.start();
	assert.deepEqual(source.snapshot().tools, tools);
	assert.ok(!Number.isNaN(Date.parse(source.snapshot().toolsUpdatedAt)));
	assert.equal(source.snapshot().toolsError, '');
	assert.equal(source.snapshot().totalRecords, 1);
	assert.equal(source.raw(), `${JSON.stringify(event('a'))}\n`);
	session.rpc.tools.getCurrentMetadata = async () => ({ tools: [] });
	await source.refresh();
	assert.deepEqual(source.snapshot().tools, []);
});

test('refreshes current tools on main-agent invalidations, including ephemeral notifications', async t => {
	const { source, session, emit } = fixture([]);
	t.after(() => source.dispose());
	let calls = 0;
	session.rpc.tools.getCurrentMetadata = async () => {
		calls++;
		return { tools: [{ name: `tool${calls}`, description: 'A tool' }] };
	};
	await source.start();
	emit({ ...event('child-tools', 'session.tools_updated', { model: 'child-model' }), ephemeral: true, agentId: 'child' });
	await setTimeout(150);
	assert.equal(calls, 1);
	emit({ ...event('tools', 'session.tools_updated', { model: 'model' }), ephemeral: true });
	await setTimeout(150);
	assert.equal(calls, 2);
	assert.equal(source.snapshot().tools[0].name, 'tool2');
	assert.equal(source.snapshot().totalRecords, 0);
});

test('re-fetches when tools change during an in-flight metadata request', async t => {
	const { source, session, emit } = fixture([]);
	t.after(() => source.dispose());
	await source.start();
	let complete;
	let calls = 0;
	session.rpc.tools.getCurrentMetadata = () => {
		calls++;
		return calls === 1 ? new Promise(resolve => { complete = resolve; })
			: Promise.resolve({ tools: [{ name: 'new', description: 'New tool' }] });
	};
	const pending = source.refreshTools();
	emit({ ...event('tools', 'session.tools_updated', { model: 'model' }), ephemeral: true });
	complete({ tools: [{ name: 'old', description: 'Old tool' }] });
	await pending;
	assert.equal(calls, 2);
	assert.equal(source.snapshot().tools[0].name, 'new');
});

test('reports inventory failures without losing history or retaining a stale inventory, then recovers', async t => {
	const { source, session, logs } = fixture([event('a')]);
	t.after(() => source.dispose());
	session.rpc.tools.getCurrentMetadata = async () => ({ tools: [{ name: 'view', description: 'Read files' }] });
	await source.start();
	session.rpc.tools.getCurrentMetadata = async () => { throw new Error('Inventory unavailable'); };
	await source.refresh();
	assert.equal(source.snapshot().error, '');
	assert.equal(source.snapshot().totalRecords, 1);
	assert.equal(source.snapshot().tools, null);
	assert.equal(source.snapshot().toolsUpdatedAt, '');
	assert.equal(source.snapshot().toolsError, 'Inventory unavailable');
	assert.deepEqual(logs, ['Session timeline: Inventory unavailable']);
	session.rpc.tools.getCurrentMetadata = async () => ({ tools: null });
	await source.refresh();
	assert.equal(source.snapshot().toolsError, '');
	assert.equal(source.snapshot().tools, null);
});

test('reports unsupported hosts and invalid metadata explicitly while preserving history', async t => {
	const { source, session } = fixture([event('a')]);
	t.after(() => source.dispose());
	delete session.rpc;
	await source.start();
	assert.match(source.snapshot().toolsError, /does not support session.tools.getCurrentMetadata/);
	assert.equal(source.snapshot().events.length, 1);
	for (const tools of [undefined, {}, [null], [{ name: 'view' }], [{ name: 'view', description: 'Read', deferLoading: 'yes' }]]) {
		session.rpc = { tools: { getCurrentMetadata: async () => ({ tools }) } };
		await source.refreshTools();
		assert.equal(source.snapshot().toolsError, 'The SDK returned an invalid current tool inventory.');
	}
});

test('ignores inventory responses and invalidations after disposal', async () => {
	const { source, session, emit, logs } = fixture([]);
	await source.start();
	let complete;
	session.rpc.tools.getCurrentMetadata = () => new Promise(resolve => { complete = resolve; });
	const pending = source.refreshTools();
	emit({ ...event('tools', 'session.tools_updated', {}), ephemeral: true });
	source.dispose();
	const revision = source.revision;
	complete({ tools: [] });
	await pending;
	assert.equal(source.revision, revision);
	assert.deepEqual(logs, []);
});

test('captures live request catalogs independently of Current tools without backfilling history', async t => {
	const { source, session, emit } = fixture([event('historical')]);
	t.after(() => source.dispose());
	const tools = [{ name: 'view', description: 'Read files', input_schema: { type: 'object' }, deferLoading: true }];
	session.rpc.tools.getCurrentMetadata = async () => ({ tools });
	await source.start();
	emit(event('first'));
	await setTimeout(150);
	const first = source.snapshot().events.find(e => e.id === 'tool-catalog:first');
	const captured = first.sections.find(s => s.label === 'Tool catalog snapshot');
	assert.equal(captured.count, 1);
	assert.match(captured.content, /not the exact tools sent to the model/);
	assert.match(first.sections.find(s => s.toolName === 'view').content, /"deferLoading": true/);
	assert.ok(!Number.isNaN(Date.parse(source.requestTools.get('first').capturedAt)));
	assert.equal(source.requestTools.has('historical'), false);

	tools[0].description = 'Changed description';
	session.rpc.tools.getCurrentMetadata = async () => ({ tools: [] });
	await source.refreshTools();
	emit(event('second'));
	await setTimeout(150);
	assert.deepEqual(source.snapshot().tools, []);
	assert.equal(source.requestTools.get('first').tools[0].description, 'Read files');
	assert.deepEqual(source.requestTools.get('second').tools, []);
	assert.equal(source.snapshot().events.find(e => e.id === 'tool-catalog:second').sections.at(-1).count, 0);
	assert.ok(!source.raw().includes('Tool catalog snapshot'));
});

test('keeps snapshots on history refresh, deduplicates delivery, and prunes truncated requests', async t => {
	const { source, session, emit } = fixture([]);
	t.after(() => source.dispose());
	let calls = 0;
	session.rpc.tools.getCurrentMetadata = async () => {
		calls++;
		return { tools: [] };
	};
	await source.start();
	emit(event('live'));
	emit(event('live'));
	await setTimeout(150);
	assert.equal(calls, 2);
	const snapshot = source.requestTools.get('live');
	session.getEvents = async () => [event('live')];
	await source.refresh();
	assert.equal(source.requestTools.get('live'), snapshot);
	assert.equal(source.snapshot().events[1].sections.at(-1).count, 0);
	session.getEvents = async () => [];
	await source.refresh();
	assert.equal(source.requestTools.size, 0);
});

test('shows request capture failures and uninitialized inventories without altering the sidebar', async t => {
	const { source, session, emit, logs } = fixture([]);
	t.after(() => source.dispose());
	await source.start();
	session.rpc.tools.getCurrentMetadata = async () => { throw new Error('Capture unavailable'); };
	emit(event('failed'));
	await setTimeout(150);
	assert.match(source.snapshot().events[1].sections.at(-1).content, /capture failed: Capture unavailable/);
	assert.equal(source.snapshot().toolsError, '');
	assert.deepEqual(logs, ['Session timeline: Request tool snapshot: Capture unavailable']);
	session.rpc.tools.getCurrentMetadata = async () => ({ tools: null });
	emit(event('uninitialized'));
	await setTimeout(150);
	assert.match(source.snapshot().events[3].sections.at(-1).content, /not initialized/);
	assert.equal(source.snapshot().events[3].sections.at(-1).count, undefined);
});

test('does not capture subagent or ephemeral requests', async t => {
	const { source, emit } = fixture([]);
	t.after(() => source.dispose());
	await source.start();
	emit({ ...event('child'), agentId: 'child' });
	emit({ ...event('ephemeral'), ephemeral: true });
	await setTimeout(150);
	assert.equal(source.requestTools.size, 0);
});

test('captures requests arriving during history load without substituting the sidebar response', async t => {
	const { source, session, emit } = fixture([]);
	t.after(() => source.dispose());
	let completeSidebar;
	let completeHistory;
	let calls = 0;
	session.getEvents = () => new Promise(resolve => { completeHistory = resolve; });
	session.rpc.tools.getCurrentMetadata = () => ++calls === 1
		? new Promise(resolve => { completeSidebar = resolve; })
		: Promise.resolve({ tools: [{ name: 'live', description: 'Live catalog' }] });
	const startup = source.start();
	emit(event('live'));
	await setTimeout(0);
	completeHistory([]);
	completeSidebar({ tools: [{ name: 'old', description: 'Older catalog' }] });
	await startup;
	assert.equal(source.requestTools.get('live').tools[0].name, 'live');
	assert.equal(source.snapshot().tools[0].name, 'old');
	assert.match(source.snapshot().events[1].sections.at(-1).content, /Live catalog/);
});

test('ignores late request snapshots after truncation or disposal', async t => {
	for (const dispose of [false, true]) {
		const { source, session, emit } = fixture([]);
		t.after(() => source.dispose());
		await source.start();
		let complete;
		session.rpc.tools.getCurrentMetadata = () => new Promise(resolve => { complete = resolve; });
		emit(event('live'));
		await setTimeout(150);
		if (dispose) {
			source.dispose();
		} else {
			await source.load();
		}
		const revision = source.revision;
		complete({ tools: [] });
		await setTimeout(150);
		assert.equal(source.revision, revision);
		assert.equal(source.requestTools.has('live'), dispose);
	}
});

test('restores persisted request tools after reopening without backfilling older requests', async t => {
	const first = fixture([event('historical')]);
	const directory = await mkdtemp(join(tmpdir(), 'timeline-source-'));
	let second;
	t.after(async () => {
		await first.source.dispose();
		await second?.source.dispose();
		await rm(directory, { recursive: true, force: true });
	});
	first.session.rpc.workspaces = {
		ensure: async () => ({}),
		listFiles: async () => ({ files: await readdir(directory) }),
		readFile: async ({ path }) => ({ content: await readFile(join(directory, path), 'utf8') }),
		createFile: async ({ path, content }) => { await writeFile(join(directory, path), content); },
	};
	await first.source.start();
	first.session.rpc.tools.getCurrentMetadata = async () => ({ tools: [{ name: 'saved', description: 'Original catalog' }] });
	first.emit(event('live'));
	await setTimeout(0);
	await first.source.dispose();
	const saved = JSON.parse(await readFile(join(directory, requestToolsFile), 'utf8'));
	assert.equal(saved.requests[0][0], 'live');
	second = fixture([event('historical'), event('live')]);
	second.session.rpc.workspaces = first.session.rpc.workspaces;
	await second.source.start();
	assert.equal(second.source.requestTools.has('historical'), false);
	assert.equal(second.source.requestTools.get('live').tools[0].name, 'saved');
	assert.equal(second.source.requestTools.get('live').capturedAt, saved.requests[0][1].capturedAt);
	assert.ok(second.source.snapshot().events.some(e => e.id === 'tool-catalog:live'));
	assert.equal(second.source.snapshot().persistenceError, '');
	assert.ok(!second.source.raw().includes('Original catalog'));
});

test('prunes persisted snapshots when their requests disappear from history', async t => {
	const { source, session, files, emit } = fixture([]);
	t.after(() => source.dispose());
	await source.start();
	emit(event('keep'));
	emit(event('removed'));
	await setTimeout(0);
	await source.pendingSave;
	session.getEvents = async () => [event('keep')];
	await source.refresh();
	await source.pendingSave;
	assert.deepEqual(JSON.parse(files.get(requestToolsFile)).requests.map(([id]) => id), ['keep']);
	assert.deepEqual([...source.requestTools.keys()], ['keep']);
});

test('keeps new live captures when persisted snapshots arrive during startup', async t => {
	const { source, session, files, emit } = fixture([event('live')]);
	t.after(() => source.dispose());
	const saved = { status: 'ready', capturedAt: '2026-10-29T10:00:00Z', error: '', tools: [{ name: 'old', description: 'Old catalog' }] };
	files.set(requestToolsFile, JSON.stringify({ version: 1, sessionId: session.sessionId, requests: [['live', saved]] }));
	let complete;
	session.rpc.workspaces.readFile = () => new Promise(resolve => { complete = resolve; });
	session.rpc.tools.getCurrentMetadata = async () => ({ tools: [{ name: 'new', description: 'Live catalog' }] });
	const startup = source.start();
	await setTimeout(0);
	emit(event('live'));
	await setTimeout(0);
	complete({ content: files.get(requestToolsFile) });
	await startup;
	await source.pendingSave;
	assert.equal(source.requestTools.get('live').tools[0].name, 'new');
	assert.equal(JSON.parse(files.get(requestToolsFile)).requests[0][1].tools[0].name, 'new');
});

test('serializes snapshot writes and flushes them before disposal completes', async () => {
	const { source, session, files, emit } = fixture([]);
	await source.start();
	let complete;
	let writes = 0;
	session.rpc.workspaces.createFile = async ({ path, content }) => {
		writes++;
		if (writes === 1) {
			await new Promise(resolve => { complete = resolve; });
		}
		files.set(path, content);
	};
	emit(event('first'));
	await setTimeout(0);
	emit(event('second'));
	await setTimeout(0);
	assert.equal(writes, 1);
	let disposed = false;
	const closing = source.dispose().then(() => { disposed = true; });
	await setTimeout(0);
	assert.equal(disposed, false);
	complete();
	await closing;
	assert.deepEqual(JSON.parse(files.get(requestToolsFile)).requests.map(([id]) => id), ['first', 'second']);
});

test('surfaces persistence failures while preserving history and recovers after a successful write', async t => {
	const { source, session, emit, logs } = fixture([event('historical')]);
	t.after(() => source.dispose());
	await source.start();
	const createFile = session.rpc.workspaces.createFile;
	session.rpc.workspaces.createFile = async () => { throw new Error('Disk full'); };
	emit(event('live'));
	await setTimeout(0);
	await source.pendingSave;
	assert.match(source.snapshot().persistenceError, /Disk full/);
	assert.ok(logs.some(message => message.includes('Disk full')));
	assert.equal(source.records.size, 2);
	session.rpc.workspaces.createFile = createFile;
	await source.persistRequestTools();
	assert.equal(source.snapshot().persistenceError, '');
});

test('does not overwrite a corrupt snapshot file and leaves history available', async t => {
	const { source, files, emit } = fixture([event('historical')]);
	t.after(() => source.dispose());
	files.set(requestToolsFile, '{invalid');
	await source.start();
	assert.match(source.snapshot().persistenceError, /Request tool snapshot storage/);
	assert.equal(source.snapshot().totalRecords, 1);
	emit(event('live'));
	await setTimeout(0);
	await source.pendingSave;
	assert.equal(files.get(requestToolsFile), '{invalid');
	assert.ok(source.requestTools.has('live'));
});
