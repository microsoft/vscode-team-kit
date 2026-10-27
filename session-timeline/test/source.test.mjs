// Copyright (c) Microsoft Corporation. Licensed under the MIT license.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { TimelineSource } from '../com.github.copilot/extensions/session-timeline/source.mjs';

const event = (id, type = 'user.message', data = { content: id }) => ({ id, type, data, timestamp: '2026-10-21T12:00:00Z', parentId: null });

function fixture(history) {
	let handler;
	const logs = [];
	const session = {
		sessionId: 'fixture-session',
		getEvents: async () => history,
		on(callback) { handler = callback; return () => { handler = undefined; }; },
		log: async message => { logs.push(message); },
	};
	const source = new TimelineSource(session);
	return { source, session, logs, emit: record => handler?.(record), subscribed: () => !!handler };
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
