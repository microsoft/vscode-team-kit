// Copyright (c) Microsoft Corporation. Licensed under the MIT license.

import { createCanvas, CanvasError, joinSession } from '@github/copilot-sdk/extension';
import { categories } from './model.mjs';
import { TimelineSource } from './source.mjs';
import { createTimelineServer } from './server.mjs';

const instances = new Map();
let source;
let starting;
let stopping;
let session;

async function getSource() {
	if (stopping) {
		await stopping;
	}
	if (!starting) {
		const next = new TimelineSource(session);
		source = next;
		starting = next.start().then(() => next).catch(async error => {
			await next.dispose();
			if (source === next) {
				source = undefined;
				starting = undefined;
			}
			throw new CanvasError('HISTORY_UNAVAILABLE', `Failed to load session history: ${error.message}`);
		});
	}
	return starting;
}

async function instance(instanceId) {
	const pending = instances.get(instanceId);
	if (!pending) {
		throw new CanvasError('NOT_OPEN', 'Open the session timeline first.');
	}
	return pending;
}

session = await joinSession({
	canvases: [createCanvas({
		id: 'vscode-session-timeline',
		displayName: 'Session timeline',
		description: 'Inspect the current session as a live timeline of prompts, responses, tools, and subagents.',
		async open({ instanceId }) {
			if (!instances.has(instanceId)) {
				const pending = getSource().then(createTimelineServer).catch(error => {
					instances.delete(instanceId);
					throw error instanceof CanvasError ? error : new CanvasError('OPEN_FAILED', error.message);
				});
				instances.set(instanceId, pending);
			}
			return { url: (await instances.get(instanceId)).url };
		},
		actions: [
			{
				name: 'getStatus',
				description: 'Return timeline event counts, current tool count, and any loading errors.',
				async handler({ instanceId }) {
					await instance(instanceId);
					const snapshot = source.snapshot();
					return {
						sessionId: snapshot.sessionId, totalRecords: snapshot.totalRecords, visibleEvents: snapshot.events.length, error: snapshot.error, persistenceError: snapshot.persistenceError,
						currentTools: snapshot.tools?.length ?? null, toolsError: snapshot.toolsError,
					};
				},
			},
			{
				name: 'setFilter',
				description: 'Set the Find text or visible event categories without changing session history.',
				inputSchema: {
					type: 'object', additionalProperties: false,
					properties: { query: { type: 'string', maxLength: 2000 }, categories: { type: 'array', maxItems: 5, items: { type: 'string', enum: categories } } },
				},
				async handler({ instanceId, input }) {
					try {
						return (await instance(instanceId)).setFilter(input);
					} catch (error) {
						throw error instanceof CanvasError ? error : new CanvasError('INVALID_FILTER', error.message);
					}
				},
			},
			{
				name: 'refresh',
				description: 'Reload SDK session history, preserving timeline view state.',
				async handler({ instanceId }) {
					await instance(instanceId);
					try {
						await source.refresh();
						return { totalRecords: source.snapshot().totalRecords };
					} catch (error) {
						throw new CanvasError('HISTORY_UNAVAILABLE', error.message);
					}
				},
			},
		],
		async onClose({ instanceId }) {
			const pending = instances.get(instanceId);
			instances.delete(instanceId);
			if (pending) {
				await (await pending).close();
			}
			if (!instances.size) {
				const closing = source;
				source = undefined;
				starting = undefined;
				stopping = closing?.dispose();
				try {
					await stopping;
				} finally {
					stopping = undefined;
				}
			}
		},
	})],
});
