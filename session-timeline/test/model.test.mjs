// Copyright (c) Microsoft Corporation. Licensed under the MIT license.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTimelineModel, selectEvents, sectionOutlines } from '../com.github.copilot/extensions/session-timeline/model.mjs';

export function record(id, type, data, agentId) {
	return { id, type, data, parentId: null, timestamp: '2026-10-21T12:00:00.000Z', ...(agentId ? { agentId } : {}) };
}

test('groups turns and pairs tool results by semantic ownership, retaining raw data', () => {
	const records = [
		record('u', 'user.message', { content: 'Request', transformedContent: 'Transformed', attachments: [{ path: '/test' }] }),
		record('s', 'system.message', { content: 'System' }),
		record('a', 'assistant.message', { content: 'Response', reasoningText: 'Reasoning', toolRequests: [{ toolCallId: 'call', name: 'read' }] }),
		record('t', 'tool.execution_start', { toolCallId: 'call', toolName: 'read', arguments: { path: '/test' } }),
		{ ...record('c', 'tool.execution_complete', { toolCallId: 'call', success: true, result: { content: 'Result' } }), timestamp: '2026-10-21T12:00:01.250Z' },
	];
	const model = createTimelineModel(records);
	assert.deepEqual({
		total: model.totalRecords,
		events: model.events.map(({ id, parentEventId, category, title, summary, status, duration, rawRecords }) => ({ id, parentEventId, category, title, summary, status, duration, rawIds: rawRecords.map(r => r.id) })),
		reasoning: model.events[2].sections.find(s => s.label === 'Reasoning').content,
	}, {
		total: 5,
		events: [
			{ id: 'u', parentEventId: undefined, category: 'user', title: 'User', summary: 'Request', status: '', duration: undefined, rawIds: ['u'] },
			{ id: 's', parentEventId: 'u', category: 'system', title: 'System', summary: 'System', status: '', duration: undefined, rawIds: ['s'] },
			{ id: 'a', parentEventId: 's', category: 'assistant', title: 'Assistant', summary: 'Response', status: '', duration: undefined, rawIds: ['a'] },
			{ id: 't', parentEventId: 'a', category: 'tool', title: 'read', summary: 'path: /test', status: 'Completed', duration: 1250, rawIds: ['t', 'c'] },
		],
		reasoning: 'Reasoning',
	});
});

test('correlates concurrent subagent calls without mixing completions', () => {
	const model = createTimelineModel([
		record('u', 'user.message', { content: 'Request' }),
		record('a', 'assistant.message', { content: 'Start agents' }),
		record('spawn', 'tool.execution_start', { toolCallId: 'spawn-call', toolName: 'task' }),
		record('sub', 'subagent.started', { toolCallId: 'spawn-call', agentDisplayName: 'Explorer' }),
		record('ca', 'assistant.message', { content: 'Child', parentToolCallId: 'spawn-call' }, 'child'),
		record('ct', 'tool.execution_start', { toolCallId: 'duplicate', toolName: 'read', parentToolCallId: 'spawn-call' }, 'child'),
		record('ot', 'tool.execution_start', { toolCallId: 'duplicate', toolName: 'read' }, 'other-child'),
		record('cc', 'tool.execution_complete', { toolCallId: 'duplicate', success: false, error: { message: 'failed' } }, 'child'),
		record('oc', 'tool.execution_complete', { toolCallId: 'duplicate', success: true, result: 'passed' }, 'other-child'),
		record('sc', 'subagent.completed', { toolCallId: 'spawn-call' }),
	]);
	assert.deepEqual(model.events.filter(e => ['sub', 'ca', 'ct', 'ot'].includes(e.id)).map(e => ({
		id: e.id, parent: e.parentEventId, status: e.status, raw: e.rawRecords.map(r => r.id),
	})), [
		{ id: 'sub', parent: 'spawn', status: 'Completed', raw: ['sub', 'sc'] },
		{ id: 'ca', parent: 'spawn', status: '', raw: ['ca'] },
		{ id: 'ct', parent: 'spawn', status: 'Failed', raw: ['ct', 'cc'] },
		{ id: 'ot', parent: undefined, status: 'Completed', raw: ['ot', 'oc'] },
	]);
});

test('pairs external tools, reports failures and preserves unmatched completions', () => {
	const model = createTimelineModel([
		record('x', 'external_tool.requested', { requestId: 'r', toolName: 'external', arguments: { query: 'needle' } }),
		record('y', 'external_tool.completed', { requestId: 'r', success: false, error: 'broken' }),
		record('z', 'subagent.failed', { toolCallId: 'unknown', error: 'stopped' }),
	]);
	assert.deepEqual(model.events.map(e => [e.title, e.status, e.sections.at(-1).content]), [
		['external', 'Failed', 'broken'],
		['Subagent failed', '', '{\n  "toolCallId": "unknown",\n  "error": "stopped"\n}'],
	]);
});

test('summarizes tool arguments with readable paths and descriptions instead of collapsed JSON', () => {
	const model = createTimelineModel([
		record('t', 'tool.execution_start', {
			toolCallId: 'call', toolName: 'view',
			arguments: { description: 'Inspect the component', path: '/src/component.ts', content: 'large content' },
		}),
	]);
	assert.equal(model.events[0].summary, 'description: Inspect the component · path: /src/component.ts');
});

test('omits placeholder tool previews while preserving full arguments', () => {
	const args = { title: 'New chat title', automatic: true };
	const { events } = createTimelineModel([
		record('t', 'tool.execution_start', { toolCallId: 'call', toolName: 'rename_chat', arguments: args }),
	]);
	assert.equal(events[0].summary, '');
	assert.deepEqual(JSON.parse(events[0].sections[0].content), args);
});

test('extracts prompt capabilities and top-level instructions without treating tool tags as instructions', () => {
	const content = '<available_skills><skill><name>review</name></skill></available_skills><tools><bash>Run commands</bash><rg>Search files</rg></tools><code_change_instructions><rules>Be precise</rules></code_change_instructions>';
	const model = createTimelineModel([record('s', 'system.message', { content })]);
	assert.deepEqual(model.events[0].sections.map(s => s.label), [
		'Advertised skills', 'Tool guidance: bash', 'Tool guidance: rg', 'Instruction: code change instructions', 'Content',
	]);
});

test('search and categories retain context ancestors, and empty categories show nothing', () => {
	const model = createTimelineModel([
		record('u', 'user.message', { content: 'Request' }),
		record('a', 'assistant.message', { content: 'Response' }),
		record('t', 'tool.execution_start', { toolCallId: 'call', toolName: 'read', arguments: { path: 'Needle' } }),
	]);
	assert.deepEqual([
		selectEvents(model.events, 'NEEDLE', ['tool']).map(e => e.id),
		selectEvents(model.events, '', []).map(e => e.id),
		selectEvents(model.events, 'absent', ['tool']).map(e => e.id),
	], [['u', 'a', 't'], [], []]);
});

test('rejects invalid event envelopes explicitly', () => {
	assert.throws(() => createTimelineModel([{ type: 'user.message', data: {} }]), /invalid session event/);
});

test('section pills group prompt sections and link to the first section in each group', () => {
	const outlines = sectionOutlines([
		{ label: 'Advertised skills', content: 'one\ntwo' },
		{ label: 'Tool guidance: bash', content: 'Run commands' },
		{ label: 'Tool guidance: view', content: 'Read files' },
		{ label: 'Instruction: first', content: 'First rule' },
		{ label: 'Instruction: second', content: 'Second rule' },
		{ label: 'Content', content: 'a'.repeat(1500) },
	]);
	assert.deepEqual(outlines.map(({ text, index }) => [text, index]), [
		['Advertised skills 2', 0], ['Tool guidance 2', 1], ['Instructions 2', 3],
		[`Content ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(1.5)}kB`, 5],
	]);
});

test('assistant pills show actual tool count, model name, and UTF-8 response size', () => {
	const { events } = createTimelineModel([record('a', 'assistant.message', {
		content: '\u00e9', model: 'example-model',
		toolRequests: [{ toolCallId: 'one', name: 'view' }, { toolCallId: 'two', name: 'bash' }],
	})]);
	assert.deepEqual(sectionOutlines(events[0].sections).map(item => item.text), [
		'Response 2B', 'Tool requests 2', 'example-model',
	]);
	const toolsOnly = createTimelineModel([record('b', 'assistant.message', { toolRequests: [{ toolCallId: 'one', name: 'view' }] })]);
	assert.equal(toolsOnly.events[0].summary, '');
});
