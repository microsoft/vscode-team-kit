// Copyright (c) Microsoft Corporation. Licensed under the MIT license.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createTimelineServer } from '../extensions/session-timeline/server.mjs';

async function fixture(t) {
	const source = {
		revision: 1,
		snapshot: () => ({ sessionId: 'fixture', totalRecords: 1, events: [], error: '' }),
		raw: () => '{"type":"user.message","data":{"content":"fixture"}}\n',
		refresh: async () => { source.revision++; },
		fail: error => { throw error; },
	};
	const server = await createTimelineServer(source);
	t.after(() => server.close());
	const page = await fetch(server.url);
	const cookie = page.headers.get('set-cookie').split(';')[0];
	const get = path => fetch(server.url + path, { headers: { Cookie: cookie } });
	const post = (path, body, origin = server.url) => fetch(server.url + path, {
		method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
	});
	return { server, page, get, post };
}

test('serves canvas assets with CSP, requires a cookie for private data, and rejects foreign origins', async t => {
	const { server, page, get, post } = await fixture(t);
	const unauthenticated = await fetch(server.url + '/api/state');
	const state = await get('/api/state');
	const worker = await fetch(server.url + '/find-worker.mjs');
	assert.equal(worker.status, 200);
	assert.match(worker.headers.get('content-type'), /javascript/);
	const foreign = await post('/api/view', { query: 'secret' }, 'https://example.com');
	assert.deepEqual([page.status, page.headers.get('content-security-policy').includes("script-src 'self'"), unauthenticated.status, state.status, foreign.status], [200, true, 403, 200, 403]);
});

test('preserves view state, applies action filters, and returns 204 for unchanged revisions', async t => {
	const { server, get, post } = await fixture(t);
	await post('/api/view', { query: 'needle', categories: ['tool'], expanded: ['example'], follow: true });
	const initial = await (await get('/api/state')).json();
	const unchanged = await get(`/api/state?revision=${encodeURIComponent(initial.revision)}`);
	server.setFilter({ query: 'changed' });
	const updated = await (await get('/api/state')).json();
	assert.deepEqual([initial.view, unchanged.status, updated.view], [
		{ query: 'needle', categories: ['tool'], expanded: ['example'], follow: true, announcements: true },
		204,
		{ query: 'changed', categories: ['tool'], expanded: ['example'], follow: true, announcements: true },
	]);
});

test('validates inputs and exports raw SDK records as a download', async t => {
	const { get, post, server } = await fixture(t);
	const invalid = await post('/api/view', { categories: ['invalid'] });
	const oversized = await post('/api/view', { query: 'x'.repeat(2001) });
	const unknown = await post('/api/view', { arbitrary: true });
	const raw = await get('/api/raw');
	assert.throws(() => server.setFilter({ categories: 'tool' }), /Expected query/);
	assert.deepEqual([invalid.status, oversized.status, unknown.status, raw.headers.get('content-disposition'), await raw.text()], [
		400, 400, 400, 'attachment; filename="session-events.jsonl"', '{"type":"user.message","data":{"content":"fixture"}}\n',
	]);
});

test('manual refresh changes revision while preserving filters', async t => {
	const { get, post } = await fixture(t);
	await post('/api/view', { query: 'keep' });
	const before = await (await get('/api/state')).json();
	await post('/api/refresh', {});
	const after = await (await get('/api/state')).json();
	assert.deepEqual([before.revision !== after.revision, after.view.query], [true, 'keep']);
});

test('plugin manifest and marketplace registration agree', async () => {
	const root = new URL('../../', import.meta.url);
	const manifest = JSON.parse(await readFile(new URL('session-timeline/.plugin/plugin.json', root), 'utf8'));
	const marketplace = JSON.parse(await readFile(new URL('marketplace.json', root), 'utf8'));
	const entry = marketplace.plugins.find(plugin => plugin.name === manifest.name);
	assert.deepEqual([entry.version, entry.description, manifest.extensions], [manifest.version, manifest.description, 'extensions/']);
});
