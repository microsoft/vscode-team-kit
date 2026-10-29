// Copyright (c) Microsoft Corporation. Licensed under the MIT license.

export const requestToolsFile = 'session-timeline-request-tools.json';

export function validateTools(tools) {
	if (tools !== null && (!Array.isArray(tools) || tools.some(tool => !tool
		|| typeof tool.name !== 'string' || typeof tool.description !== 'string'
		|| (tool.deferLoading !== undefined && typeof tool.deferLoading !== 'boolean')))) {
		throw new Error('The SDK returned an invalid current tool inventory.');
	}
	return tools;
}

export class RequestToolsStore {
	constructor(session) {
		this.session = session;
	}

	workspace() {
		const workspace = this.session.rpc?.workspaces;
		if (!['ensure', 'listFiles', 'readFile', 'createFile'].every(method => typeof workspace?.[method] === 'function')) {
			throw new Error('This host does not support session-workspace storage.');
		}
		return workspace;
	}

	async load() {
		const workspace = this.workspace();
		await workspace.ensure({});
		const { files } = await workspace.listFiles();
		if (!files.includes(requestToolsFile)) {
			return new Map();
		}
		const { content } = await workspace.readFile({ path: requestToolsFile });
		const data = JSON.parse(content);
		if (!data || data.version !== 1 || data.sessionId !== this.session.sessionId || !Array.isArray(data.requests)) {
			throw new Error('Invalid request tool snapshot file version, session, or format.');
		}
		const snapshots = new Map();
		for (const entry of data.requests) {
			if (!Array.isArray(entry) || entry.length !== 2) {
				throw new Error('Invalid request tool snapshot entry.');
			}
			const [id, snapshot] = entry;
			if (typeof id !== 'string' || !id || snapshots.has(id) || !snapshot
				|| !['ready', 'uninitialized', 'error'].includes(snapshot.status)
				|| typeof snapshot.capturedAt !== 'string' || typeof snapshot.error !== 'string'
				|| (snapshot.status !== 'error' && Number.isNaN(Date.parse(snapshot.capturedAt)))
				|| (snapshot.status === 'ready' ? !Array.isArray(snapshot.tools) : snapshot.tools !== null)) {
				throw new Error('Invalid request tool snapshot entry.');
			}
			validateTools(snapshot.tools);
			snapshots.set(id, snapshot);
		}
		return snapshots;
	}

	async save(snapshots) {
		await this.workspace().createFile({
			path: requestToolsFile,
			content: JSON.stringify({
				version: 1, sessionId: this.session.sessionId,
				requests: [...snapshots].filter(([, snapshot]) => snapshot.status !== 'loading'),
			}),
		});
	}
}
