// Copyright (c) Microsoft Corporation. Licensed under the MIT license.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const script = await readFile(new URL('../extensions/session-timeline/public/find-worker.mjs', import.meta.url), 'utf8');

function worker(clock = performance) {
	const results = [];
	const tasks = [];
	const self = { postMessage: data => results.push(data) };
	runInNewContext(script, { self, performance: clock, setTimeout: resolve => tasks.push(resolve) });
	return {
		results, tasks,
		send: data => self.onmessage({ data }),
		async flush() {
			while (tasks.length) {
				tasks.shift()();
				await Promise.resolve();
			}
		},
	};
}

test('background Find counts section occurrences and falls back to raw records', async () => {
	const w = worker();
	w.send({ type: 'index', events: [
		{ id: 'readable', sections: [{ content: 'Needle needle' }], rawRecords: [{ content: 'needle' }] },
		{ id: 'raw', sections: [{ content: 'other' }], rawRecords: [{ content: 'needle' }] },
	] });
	w.send({ type: 'find', id: 1, query: 'NEEDLE' });
	await w.flush();
	assert.deepEqual(JSON.parse(JSON.stringify(w.results)), [{
		id: 1, query: 'NEEDLE', matches: [
			{ id: 'readable', section: 0, occurrence: 0 },
			{ id: 'readable', section: 0, occurrence: 1 },
			{ id: 'raw', section: 1, occurrence: 0 },
		],
	}]);
});

test('cancels work at a yield and never publishes stale results', async () => {
	let time = 0;
	const w = worker({ now: () => time += 10 });
	w.send({ type: 'index', events: [{ id: 'large', sections: [{ content: 'needle '.repeat(1000) }], rawRecords: [] }] });
	w.send({ type: 'find', id: 1, query: 'needle' });
	assert.ok(w.tasks.length > 0);
	w.send({ type: 'cancel' });
	await w.flush();
	assert.equal(w.results.length, 0);
	w.send({ type: 'find', id: 2, query: 'absent' });
	await w.flush();
	assert.equal(w.results[0].id, 2);
	assert.equal(w.results[0].matches.length, 0);
});
