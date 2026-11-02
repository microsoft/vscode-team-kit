// Copyright (c) Microsoft Corporation. Licensed under the MIT license.

import { createTimelineModel, validateEvent } from './model.mjs';
import { RequestToolsStore, validateTools } from './request-tools.mjs';

export class TimelineSource {
	constructor(session) {
		this.session = session;
		this.records = new Map();
		this.requestTools = new Map();
		this.store = new RequestToolsStore(session);
		this.persistenceError = '';
		this.storageLoaded = false;
		this.revision = 0;
		this.error = '';
		this.tools = null;
		this.toolsError = '';
		this.toolsUpdatedAt = '';
		this.buffer = [];
		this.loading = false;
		this.disposed = false;
		this.model = { totalRecords: 0, events: [] };
	}

	async start() {
		this.unsubscribe = this.session.on(event => {
			try {
				validateEvent(event);
				if (event.type === 'session.tools_updated' && !event.agentId) {
					this.toolsDirty = true;
					clearTimeout(this.toolsTimer);
					this.toolsTimer = setTimeout(() => void this.refreshTools(), 100);
				}
				if (event.ephemeral) {
					return;
				}
				if (event.type === 'user.message' && !event.agentId && !this.requestTools.has(event.id)) {
					void this.captureRequestTools(event.id);
				}
				if (this.loading) {
					this.buffer.push(event);
				} else {
					this.records.set(event.id, event);
					this.scheduleBuild();
				}
				if (['session.truncation', 'session.context_cleared'].includes(event.type)) {
					clearTimeout(this.refreshTimer);
					this.refreshTimer = setTimeout(() => void this.refresh().catch(error => this.fail(error)), 100);
				}
			} catch (error) {
				this.fail(error);
			}
		});
		await this.refresh();
	}

	fail(error, field = 'error') {
		const message = error instanceof Error ? error.message : String(error);
		if (this[field] === message) {
			return;
		}
		this[field] = message;
		this.revision++;
		this.logFailure(message);
	}

	logFailure(message) {
		void this.session.log(`Session timeline: ${message}`, { level: 'error', ephemeral: true }).catch(logError => {
			process.stderr.write(`Session timeline logging failed: ${String(logError)}\n`);
		});
	}

	async readTools() {
		if (typeof this.session.rpc?.tools?.getCurrentMetadata !== 'function') {
			throw new Error('Current tool inventory is unavailable: this host does not support session.tools.getCurrentMetadata.');
		}
		const { tools } = await this.session.rpc.tools.getCurrentMetadata();
		return validateTools(tools);
	}

	restoreRequestTools() {
		if (!this.pendingRestore) {
			this.pendingRestore = this.store.load().then(snapshots => {
				if (this.disposed) {
					return;
				}
				for (const [id, snapshot] of snapshots) {
					if (!this.requestTools.has(id)) {
						this.requestTools.set(id, snapshot);
					}
				}
				this.storageLoaded = true;
				this.persistenceError = '';
			}).catch(error => {
				this.pendingRestore = undefined;
				if (!this.disposed) {
					this.fail(`Request tool snapshot storage: ${error instanceof Error ? error.message : String(error)}`, 'persistenceError');
				}
			});
		}
		return this.pendingRestore;
	}

	persistRequestTools() {
		this.pendingSave = (this.pendingSave ?? Promise.resolve()).then(async () => {
			await this.restoreRequestTools();
			if (!this.storageLoaded) {
				return;
			}
			await this.store.save(this.requestTools);
			if (this.persistenceError) {
				this.persistenceError = '';
				this.revision++;
			}
		}).catch(error => {
			this.fail(`Request tool snapshot storage: ${error instanceof Error ? error.message : String(error)}`, 'persistenceError');
		});
		return this.pendingSave;
	}

	async captureRequestTools(id) {
		const snapshot = { status: 'loading', tools: null, capturedAt: '', error: '' };
		this.requestTools.set(id, snapshot);
		try {
			// Read independently: an in-flight sidebar refresh may belong to an earlier request.
			const tools = await this.readTools();
			if (this.disposed || this.requestTools.get(id) !== snapshot) {
				return;
			}
			snapshot.tools = structuredClone(tools);
			snapshot.capturedAt = new Date().toISOString();
			snapshot.status = tools === null ? 'uninitialized' : 'ready';
		} catch (error) {
			if (this.disposed || this.requestTools.get(id) !== snapshot) {
				return;
			}
			snapshot.status = 'error';
			snapshot.error = error instanceof Error ? error.message : String(error);
			this.logFailure(`Request tool snapshot: ${snapshot.error}`);
		}
		this.scheduleBuild();
		void this.persistRequestTools();
	}

	scheduleBuild() {
		if (!this.buildTimer) {
			this.buildTimer = setTimeout(() => {
				this.buildTimer = undefined;
				try {
					this.build();
				} catch (error) {
					this.fail(error);
				}
			}, 100);
		}
	}

	build() {
		this.model = createTimelineModel([...this.records.values()], this.requestTools);
		this.revision++;
	}

	refresh() {
		if (this.pendingRefresh) {
			return this.pendingRefresh;
		}
		this.pendingRefresh = Promise.all([this.load(), this.refreshTools()]).finally(() => { this.pendingRefresh = undefined; });
		return this.pendingRefresh;
	}

	refreshTools() {
		if (this.disposed) {
			return;
		}
		if (!this.pendingTools) {
			this.pendingTools = this.loadTools().finally(() => { this.pendingTools = undefined; });
		}
		return this.pendingTools;
	}

	async loadTools() {
		do {
			this.toolsDirty = false;
			try {
				const tools = await this.readTools();
				if (this.disposed) {
					return;
				}
				this.tools = tools;
				this.toolsError = '';
				this.toolsUpdatedAt = new Date().toISOString();
				this.revision++;
			} catch (error) {
				if (this.disposed) {
					return;
				}
				this.tools = null;
				this.toolsUpdatedAt = '';
				this.fail(error, 'toolsError');
			}
			// An invalidation during the RPC must not leave the older snapshot displayed.
		} while (this.toolsDirty && !this.disposed);
	}

	async load() {
		this.loading = true;
		this.buffer = [];
		try {
			const [events] = await Promise.all([this.session.getEvents(), this.restoreRequestTools()]);
			if (this.disposed) {
				return;
			}
			const records = new Map(events.map(event => [validateEvent(event).id, event]));
			for (const event of this.buffer) {
				records.set(event.id, event);
			}
			this.records = records;
			let pruned = false;
			for (const id of this.requestTools.keys()) {
				const record = records.get(id);
				if (record?.type !== 'user.message' || record.agentId) {
					this.requestTools.delete(id);
					pruned = true;
				}
			}
			if (pruned) {
				void this.persistRequestTools();
			}
			this.error = '';
			this.build();
		} catch (error) {
			for (const event of this.buffer) {
				this.records.set(event.id, event);
			}
			this.build();
			this.fail(error);
			throw error;
		} finally {
			this.loading = false;
			this.buffer = [];
		}
	}

	snapshot() {
		return {
			sessionId: this.session.sessionId, revision: this.revision, loading: this.loading, error: this.error, persistenceError: this.persistenceError,
			tools: this.tools, toolsError: this.toolsError, toolsUpdatedAt: this.toolsUpdatedAt, ...this.model,
		};
	}

	raw() {
		return [...this.records.values()].map(record => JSON.stringify(record)).join('\n') + '\n';
	}

	async dispose() {
		this.disposed = true;
		this.unsubscribe?.();
		clearTimeout(this.buildTimer);
		clearTimeout(this.refreshTimer);
		clearTimeout(this.toolsTimer);
		await this.pendingSave;
	}
}
