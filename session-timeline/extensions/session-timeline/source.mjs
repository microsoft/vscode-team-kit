// Copyright (c) Microsoft Corporation. Licensed under the MIT license.

import { createTimelineModel, validateEvent } from './model.mjs';

export class TimelineSource {
	constructor(session) {
		this.session = session;
		this.records = new Map();
		this.revision = 0;
		this.error = '';
		this.buffer = [];
		this.loading = false;
		this.disposed = false;
		this.model = { totalRecords: 0, events: [] };
	}

	async start() {
		this.unsubscribe = this.session.on(event => {
			try {
				validateEvent(event);
				if (event.ephemeral) {
					return;
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

	fail(error) {
		const message = error instanceof Error ? error.message : String(error);
		if (this.error === message) {
			return;
		}
		this.error = message;
		this.revision++;
		void this.session.log(`Session timeline: ${this.error}`, { level: 'error', ephemeral: true }).catch(logError => {
			process.stderr.write(`Session timeline logging failed: ${String(logError)}\n`);
		});
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
		this.model = createTimelineModel([...this.records.values()]);
		this.revision++;
	}

	refresh() {
		if (this.pendingRefresh) {
			return this.pendingRefresh;
		}
		this.pendingRefresh = this.load().finally(() => { this.pendingRefresh = undefined; });
		return this.pendingRefresh;
	}

	async load() {
		this.loading = true;
		this.buffer = [];
		try {
			const events = await this.session.getEvents();
			if (this.disposed) {
				return;
			}
			const records = new Map(events.map(event => [validateEvent(event).id, event]));
			for (const event of this.buffer) {
				records.set(event.id, event);
			}
			this.records = records;
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
		return { sessionId: this.session.sessionId, revision: this.revision, loading: this.loading, error: this.error, ...this.model };
	}

	raw() {
		return [...this.records.values()].map(record => JSON.stringify(record)).join('\n') + '\n';
	}

	dispose() {
		this.disposed = true;
		this.unsubscribe?.();
		clearTimeout(this.buildTimer);
		clearTimeout(this.refreshTimer);
	}
}
