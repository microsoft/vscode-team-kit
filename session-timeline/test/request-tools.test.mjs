// Copyright (c) Microsoft Corporation. Licensed under the MIT license.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestToolsStore, requestToolsFile } from '../com.github.copilot/extensions/session-timeline/request-tools.mjs';

const ready = {
	status: 'ready', capturedAt: '2026-10-29T10:00:00Z', error: '',
	tools: [{ name: 'view', description: 'Read files', deferLoading: true, inputSchema: { type: 'object' } }],
};

async function fixture(t) {
	const directory = await mkdtemp(join(tmpdir(), 'timeline-tools-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const session = {
		sessionId: 'disk-session',
		rpc: { workspaces: {
			ensure: async () => ({}),
			listFiles: async () => ({ files: await readdir(directory) }),
			readFile: async ({ path }) => ({ content: await readFile(join(directory, path), 'utf8') }),
			createFile: async ({ path, content }) => { await writeFile(join(directory, path), content); },
		} },
	};
	return { session, store: new RequestToolsStore(session) };
}

test('persists completed snapshots on disk and restores them in a new store', async t => {
	const { session, store } = await fixture(t);
	assert.deepEqual(await store.load(), new Map());
	const snapshots = new Map([
		['ready', ready],
		['uninitialized', { ...ready, status: 'uninitialized', tools: null }],
		['failed', { status: 'error', tools: null, capturedAt: '', error: 'Capture failed' }],
		['pending', { status: 'loading', tools: null, capturedAt: '', error: '' }],
	]);
	await store.save(snapshots);
	const restored = await new RequestToolsStore(session).load();
	assert.deepEqual(restored, new Map([...snapshots].filter(([id]) => id !== 'pending')));
	const data = JSON.parse((await session.rpc.workspaces.readFile({ path: requestToolsFile })).content);
	assert.equal(data.sessionId, session.sessionId);
	assert.equal(data.version, 1);
});

test('rejects corrupt, foreign-session, unsupported-version and invalid snapshot data', async t => {
	const { session, store } = await fixture(t);
	const valid = { version: 1, sessionId: session.sessionId, requests: [['request', ready]] };
	const invalid = [
		'{',
		JSON.stringify({ ...valid, version: 2 }),
		JSON.stringify({ ...valid, sessionId: 'another-session' }),
		JSON.stringify({ ...valid, requests: [null] }),
		JSON.stringify({ ...valid, requests: [['request', ready], ['request', ready]] }),
		...[
			{ ...ready, status: 'loading' },
			{ ...ready, capturedAt: 'invalid' },
			{ ...ready, tools: null },
			{ ...ready, tools: [{ name: 'invalid' }] },
			{ ...ready, tools: [{ name: 'invalid', description: '', deferLoading: 'yes' }] },
		].map(snapshot => JSON.stringify({ ...valid, requests: [['request', snapshot]] })),
	];
	for (const content of invalid) {
		await session.rpc.workspaces.createFile({ path: requestToolsFile, content });
		await assert.rejects(store.load());
		assert.equal((await session.rpc.workspaces.readFile({ path: requestToolsFile })).content, content);
	}
});

test('reports unsupported storage and workspace read/write failures', async t => {
	await assert.rejects(new RequestToolsStore({}).load(), /does not support session-workspace storage/);
	const { session, store } = await fixture(t);
	session.rpc.workspaces.listFiles = async () => { throw new Error('Read denied'); };
	await assert.rejects(store.load(), /Read denied/);
	session.rpc.workspaces.createFile = async () => { throw new Error('Write denied'); };
	await assert.rejects(store.save(new Map()), /Write denied/);
});
